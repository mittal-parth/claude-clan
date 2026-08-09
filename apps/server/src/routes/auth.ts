import { authorizeUrl, installUrl, signState, verifyState } from "@sudo-city/cities";
import type { FastifyInstance } from "fastify";
import type { AuthContext } from "../auth-context.js";
import { bearerToken, resolveSession } from "../auth-context.js";
import { sealSession, type Session } from "../session.js";

export function registerAuthRoutes(app: FastifyInstance, auth: AuthContext): void {
  // Login: always the plain OAuth authorize endpoint, whether or not the
  // App is already installed for this account -- see authorizeUrl's doc.
  app.get("/auth/github/start", async (_request, reply) => {
    const state = signState(auth.stateSecret, new Date());
    await reply.redirect(authorizeUrl(auth.clientId, state));
  });

  // Granting/expanding repo access: the installations/new picker, used from
  // the repo picker's "grant access" link, not from the login button.
  app.get("/auth/github/install", async (_request, reply) => {
    const state = signState(auth.stateSecret, new Date());
    await reply.redirect(installUrl(auth.appSlug, state));
  });

  app.get<{ Querystring: { code?: string; state?: string } }>(
    "/auth/github/callback",
    async (request, reply) => {
      const { code, state } = request.query;
      if (!code) {
        await reply.code(400).send({ error: "Missing code" });
        return;
      }
      // `state` is best-effort here -- GitHub has historically dropped it
      // across the installations/new -> automatic-authorize redirect chain
      // (unlike the plain /login/oauth/authorize flow, where it's
      // reliable). This is a fresh-login endpoint, not account linking into
      // an existing session, so a missing/invalid state degrades to "treat
      // this as an unverified fresh login" rather than a hard failure.
      if (state && !verifyState(state, auth.stateSecret, new Date())) {
        await reply.code(400).send({ error: "Invalid or expired state" });
        return;
      }

      try {
        const tokens = await auth.githubAuth.exchangeCode(code);
        const viewer = await auth.githubAuth.viewer(tokens.accessToken);
        const now = new Date();
        const session: Session = {
          userId: viewer.id,
          login: viewer.login,
          avatarUrl: viewer.avatarUrl,
          tokens,
          issuedAt: now.toISOString(),
          expiresAt: tokens.expiresAt,
        };
        const sealed = sealSession(session, auth.sessionKey);
        await reply.redirect(`${auth.webOrigin}/#session=${sealed}`);
      } catch (error) {
        app.log.error({ error }, "GitHub login callback failed");
        await reply.redirect(`${auth.webOrigin}/#session-error=1`);
      }
    },
  );

  app.get("/api/auth/session", async (request, reply) => {
    const token = bearerToken(request);
    if (!token) {
      return { authenticated: false as const, mode: "anonymous" as const };
    }
    const resolved = await resolveSession(token, auth, new Date());
    if (!resolved) {
      return { authenticated: false as const, mode: "anonymous" as const };
    }
    if (resolved.refreshedToken) {
      reply.header("x-session-token", resolved.refreshedToken);
    }
    return {
      authenticated: true as const,
      mode: "user" as const,
      user: {
        id: resolved.session.userId,
        login: resolved.session.login,
        avatarUrl: resolved.session.avatarUrl,
      },
    };
  });

  app.post("/api/auth/logout", async (request, reply) => {
    const token = bearerToken(request);
    if (token) {
      const session = await resolveSession(token, auth, new Date());
      if (session) {
        // Best-effort: the client discards its bearer token regardless of
        // whether this call succeeds, since there is no server-side session
        // to invalidate either way.
        await fetch(
          `https://api.github.com/applications/${auth.clientId}/token`,
          {
            method: "DELETE",
            headers: {
              accept: "application/vnd.github+json",
              "content-type": "application/json",
              authorization: `Basic ${Buffer.from(`${auth.clientId}:${auth.clientSecret}`).toString("base64")}`,
              "user-agent": "sudo-city",
            },
            body: JSON.stringify({ access_token: session.session.tokens.accessToken }),
          },
        ).catch((error: unknown) => {
          app.log.warn({ error }, "Failed to revoke GitHub token on logout");
        });
      }
    }
    await reply.code(204).send();
  });
}
