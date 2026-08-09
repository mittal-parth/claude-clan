import { repoKeyFor } from "@sudo-city/cities";
import type { RepoSummary } from "@sudo-city/protocol";
import type { FastifyInstance, FastifyReply } from "fastify";
import type { AuthContext } from "../auth-context.js";
import { bearerToken, resolveSession } from "../auth-context.js";
import type { DbSession } from "../db.js";
import type { WorkspaceManager } from "../workspaces.js";

async function requireSession(
  request: { headers: { authorization?: string } },
  reply: FastifyReply,
  auth: AuthContext,
): Promise<DbSession | undefined> {
  const token = bearerToken(request as never);
  if (!token) {
    await reply.code(401).send({ error: "Not signed in" });
    return undefined;
  }
  const session = await resolveSession(token, auth, new Date());
  if (!session) {
    await reply.code(401).send({ error: "Session expired" });
    return undefined;
  }
  return session;
}

export function registerRepoRoutes(
  app: FastifyInstance,
  auth: AuthContext,
  workspaces: WorkspaceManager,
  broadcastRepoStatus: (
    userId: number,
    repoKey: string,
    phase: "cloning" | "scanning" | "ready" | "failed",
    message?: string,
  ) => void,
): void {
  app.get("/api/repos", async (request, reply) => {
    const session = await requireSession(request, reply, auth);
    if (!session) {
      return;
    }
    // Persisted in Postgres, not just workspaces' in-memory map -- so a
    // repo still shows SWITCH instead of IMPORT even after a server
    // restart, as long as its clone is still on disk.
    const imported = await auth.db.importedRepoKeys(session.userId);
    const repos = await auth.githubAuth.accessibleRepos(session.tokens.accessToken);
    const summaries: RepoSummary[] = repos.map((repo) => {
      const key = repoKeyFor(repo.fullName);
      return {
        key,
        fullName: repo.fullName,
        owner: repo.owner,
        name: repo.name,
        private: repo.private,
        defaultBranch: repo.defaultBranch,
        imported: imported.has(key),
      };
    });
    return { repos: summaries };
  });

  app.post<{ Body: { fullName?: string } }>(
    "/api/repos/import",
    async (request, reply) => {
      const session = await requireSession(request, reply, auth);
      if (!session) {
        return;
      }
      const { fullName } = request.body ?? {};
      if (!fullName?.includes("/")) {
        await reply.code(400).send({ error: "fullName must be owner/name" });
        return;
      }
      const [owner, name] = fullName.split("/") as [string, string];
      const repoKey = repoKeyFor(fullName);
      try {
        const workspace = await workspaces.openUserRepo({
          userId: session.userId,
          owner,
          name,
          repoKey,
          githubToken: session.tokens.accessToken,
          onProgress: (message) =>
            broadcastRepoStatus(session.userId, repoKey, "cloning", message),
        });
        await auth.db.markRepoImported({
          userId: session.userId,
          repoKey,
          owner,
          name,
          clonePath: workspace.repoPath,
        });
        broadcastRepoStatus(session.userId, repoKey, "ready");
        return { workspaceKey: workspace.key };
      } catch (error) {
        broadcastRepoStatus(
          session.userId,
          repoKey,
          "failed",
          error instanceof Error ? error.message : "Import failed",
        );
        await reply.code(502).send({
          error: error instanceof Error ? error.message : "Import failed",
        });
      }
    },
  );
}
