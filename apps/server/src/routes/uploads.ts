import type { FastifyInstance } from "fastify";
import type { UploadStore } from "../upload-store.js";
import type { WorkspaceManager } from "../workspaces.js";

export function registerUploadRoutes(
  app: FastifyInstance,
  uploads: UploadStore,
  workspaces: WorkspaceManager,
): void {
  // 1. Create upload session
  app.post<{ Body: { rootName?: string } }>("/api/uploads", async (request, reply) => {
    const { rootName } = request.body ?? {};
    const { uploadId, rootName: cleanRootName } = await uploads.createUpload(rootName);
    return { uploadId, rootName: cleanRootName };
  });

  // 2. Upload file batch
  app.post<{ Params: { id: string } }>("/api/uploads/:id/files", async (request, reply) => {
    const uploadId = request.params.id;
    const upload = uploads.get(uploadId);
    if (!upload) {
      return reply.code(404).send({ error: "Upload session not found or expired" });
    }

    const files: Array<{ path: string; buffer: Buffer }> = [];

    // Parse multipart stream
    const parts = request.parts();
    for await (const part of parts) {
      if (part.type === "file") {
        const buffer = await part.toBuffer();
        const path = part.filename || part.fieldname;
        if (path) {
          files.push({ path, buffer });
        }
      }
    }

    try {
      const result = await uploads.addFiles(uploadId, files);
      return result;
    } catch (error) {
      return reply.code(413).send({
        error: error instanceof Error ? error.message : "Failed to add files",
      });
    }
  });

  // 3. Finalise upload
  app.post<{ Params: { id: string } }>("/api/uploads/:id/finalise", async (request, reply) => {
    const uploadId = request.params.id;
    try {
      const { repoKey, name, repoDir } = await uploads.finaliseUpload(uploadId);
      // Pre-warm / open the workspace
      await workspaces.openUpload(uploadId, repoDir);
      return { repoKey, name };
    } catch (error) {
      return reply.code(404).send({
        error: error instanceof Error ? error.message : "Failed to finalise upload",
      });
    }
  });

  // 4. Discard upload (used on cancel, pagehide beacon, etc.)
  app.post<{ Params: { id: string } }>("/api/uploads/:id/discard", async (request, reply) => {
    const uploadId = request.params.id;
    await uploads.discardUpload(uploadId, async (key) => {
      await workspaces.evict(key);
    });
    return reply.code(204).send();
  });
}
