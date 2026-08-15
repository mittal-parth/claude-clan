import { randomBytes } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import {
  ALWAYS_IGNORED,
  UPLOAD_MAX_BYTES,
  UPLOAD_MAX_FILE_BYTES,
  UPLOAD_MAX_FILES,
  createUploadFilter,
  sanitiseUploadPath,
} from "@sudo-city/protocol";
import type { FastifyBaseLogger } from "fastify";

export interface PendingUpload {
  uploadId: string;
  dir: string;        // <uploadRoot>/<uploadId>
  repoDir: string;    // <uploadRoot>/<uploadId>/<rootName>
  rootName: string;   // sanitised folder name — the city's name comes from this
  bytes: number;
  files: number;
  createdAt: number;
  lastSeenAt: number;
  finalised: boolean;
}

export interface UploadStoreOptions {
  uploadRoot?: string;
  log?: FastifyBaseLogger;
  idleTtlMs?: number;
  graceTtlMs?: number;
}

export class UploadStore {
  private readonly uploads = new Map<string, PendingUpload>();
  private readonly graceTimers = new Map<string, NodeJS.Timeout>();
  private readonly uploadRoot: string;
  private readonly log?: FastifyBaseLogger;
  private readonly idleTtlMs: number;
  private readonly graceTtlMs: number;
  private readonly sweepInterval: NodeJS.Timeout;
  private readonly serverFilter = createUploadFilter();

  constructor(options: UploadStoreOptions = {}) {
    this.uploadRoot =
      options.uploadRoot ??
      process.env.SUDO_CITY_UPLOAD_ROOT ??
      join(tmpdir(), "sudocity-uploads");
    this.log = options.log;
    this.idleTtlMs = options.idleTtlMs ?? 30 * 60 * 1000; // 30 mins
    this.graceTtlMs = options.graceTtlMs ?? 60 * 1000; // 60s
    this.sweepInterval = setInterval(() => this.sweepIdle(), 60 * 1000);
    this.sweepInterval.unref();
  }

  get(uploadId: string): PendingUpload | undefined {
    return this.uploads.get(uploadId);
  }

  touch(uploadId: string): void {
    const upload = this.uploads.get(uploadId);
    if (upload) {
      upload.lastSeenAt = Date.now();
    }
  }

  async createUpload(rawRootName?: string): Promise<{ uploadId: string; rootName: string }> {
    const uploadId = randomBytes(32).toString("hex");
    const sanitizedRoot =
      (rawRootName ?? "upload")
        .replace(/[^a-zA-Z0-9._-]/g, "_")
        .replace(/^\.+/, "")
        .slice(0, 80) || "upload";

    const dir = join(this.uploadRoot, uploadId);
    const repoDir = join(dir, sanitizedRoot);
    await mkdir(repoDir, { recursive: true });

    const upload: PendingUpload = {
      uploadId,
      dir,
      repoDir,
      rootName: sanitizedRoot,
      bytes: 0,
      files: 0,
      createdAt: Date.now(),
      lastSeenAt: Date.now(),
      finalised: false,
    };

    this.uploads.set(uploadId, upload);
    return { uploadId, rootName: sanitizedRoot };
  }

  async addFiles(
    uploadId: string,
    files: Array<{ path: string; buffer: Buffer }>,
  ): Promise<{ added: number; totalBytes: number; totalFiles: number }> {
    const upload = this.uploads.get(uploadId);
    if (!upload) {
      throw new Error(`Upload "${uploadId}" not found`);
    }
    if (upload.finalised) {
      throw new Error(`Upload "${uploadId}" is already finalised`);
    }

    upload.lastSeenAt = Date.now();
    let addedCount = 0;

    for (const file of files) {
      const cleanPath = sanitiseUploadPath(file.path);
      if (!cleanPath) {
        continue;
      }

      // Re-apply ALWAYS_IGNORED on server side
      if (this.serverFilter.shouldSkip(cleanPath, false)) {
        continue;
      }

      if (file.buffer.length > UPLOAD_MAX_FILE_BYTES) {
        continue;
      }

      // Check running caps mid-stream
      if (
        upload.bytes + file.buffer.length > UPLOAD_MAX_BYTES ||
        upload.files + 1 > UPLOAD_MAX_FILES
      ) {
        // Exceeded cap: abort upload and wipe directory immediately
        this.log?.warn(
          { uploadId, bytes: upload.bytes, files: upload.files },
          "Upload exceeded limits; discarding",
        );
        await this.discardUpload(uploadId);
        throw new Error(
          `Upload exceeds capacity (max ${Math.round(UPLOAD_MAX_BYTES / 1024 / 1024)}MB / ${UPLOAD_MAX_FILES} files)`,
        );
      }

      const destPath = resolve(upload.repoDir, cleanPath);
      // Traversal safety assert: destPath must strictly be inside upload.dir
      const resolvedDir = resolve(upload.dir);
      if (!destPath.startsWith(resolvedDir + "/") && destPath !== resolvedDir) {
        continue;
      }

      await mkdir(dirname(destPath), { recursive: true });
      await writeFile(destPath, file.buffer);

      upload.bytes += file.buffer.length;
      upload.files += 1;
      addedCount++;
    }

    return {
      added: addedCount,
      totalBytes: upload.bytes,
      totalFiles: upload.files,
    };
  }

  async finaliseUpload(uploadId: string): Promise<{ repoKey: string; name: string; repoDir: string }> {
    const upload = this.uploads.get(uploadId);
    if (!upload) {
      throw new Error(`Upload "${uploadId}" not found`);
    }

    upload.finalised = true;
    upload.lastSeenAt = Date.now();
    return {
      repoKey: `upload:${uploadId}`,
      name: upload.rootName,
      repoDir: upload.repoDir,
    };
  }

  async discardUpload(uploadId: string, onEvict?: (repoKey: string) => Promise<void>): Promise<void> {
    this.cancelGraceDeletion(uploadId);
    const upload = this.uploads.get(uploadId);
    this.uploads.delete(uploadId);

    if (upload) {
      if (onEvict) {
        await onEvict(`upload:${uploadId}`).catch((error: unknown) => {
          this.log?.warn({ error, uploadId }, "Failed to evict workspace on discard");
        });
      }
      await rm(upload.dir, { recursive: true, force: true }).catch((error: unknown) => {
        this.log?.warn({ error, dir: upload.dir }, "Failed to remove upload directory on discard");
      });
    }
  }

  scheduleGraceDeletion(
    uploadId: string,
    onEvictWorkspace: (repoKey: string) => Promise<void>,
  ): void {
    this.cancelGraceDeletion(uploadId);
    const timer = setTimeout(async () => {
      this.graceTimers.delete(uploadId);
      this.log?.info({ uploadId }, "Grace period elapsed; deleting upload");
      await this.discardUpload(uploadId, onEvictWorkspace);
    }, this.graceTtlMs);
    timer.unref();
    this.graceTimers.set(uploadId, timer);
  }

  cancelGraceDeletion(uploadId: string): boolean {
    const existing = this.graceTimers.get(uploadId);
    if (existing) {
      clearTimeout(existing);
      this.graceTimers.delete(uploadId);
      return true;
    }
    return false;
  }

  private async sweepIdle(onEvictWorkspace?: (repoKey: string) => Promise<void>): Promise<void> {
    const now = Date.now();
    for (const [uploadId, upload] of this.uploads) {
      if (now - upload.lastSeenAt > this.idleTtlMs) {
        this.log?.info({ uploadId }, "Idle TTL expired; deleting abandoned upload");
        void this.discardUpload(uploadId, onEvictWorkspace);
      }
    }
  }

  async disposeAll(onEvictWorkspace?: (repoKey: string) => Promise<void>): Promise<void> {
    clearInterval(this.sweepInterval);
    for (const timer of this.graceTimers.values()) {
      clearTimeout(timer);
    }
    this.graceTimers.clear();

    const ids = [...this.uploads.keys()];
    await Promise.all(ids.map((id) => this.discardUpload(id, onEvictWorkspace)));
  }
}
