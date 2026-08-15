import { mkdtemp, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UploadStore } from "../src/upload-store";
import { WorkspaceManager } from "../src/workspaces";

describe("UploadStore", () => {
  let tempRoot: string;
  let uploadStore: UploadStore;

  beforeEach(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "sudocity-test-uploads-"));
    uploadStore = new UploadStore({
      uploadRoot: tempRoot,
      idleTtlMs: 500,
      graceTtlMs: 100,
    });
  });

  afterEach(async () => {
    await uploadStore.disposeAll();
  });

  it("creates upload directory and saves files", async () => {
    const { uploadId, rootName } = await uploadStore.createUpload("my cool project!");
    expect(uploadId).toHaveLength(64);
    expect(rootName).toBe("my_cool_project_");

    const result = await uploadStore.addFiles(uploadId, [
      { path: "src/index.ts", buffer: Buffer.from("console.log('hello');") },
      { path: "README.md", buffer: Buffer.from("# Title") },
    ]);

    expect(result.added).toBe(2);
    expect(result.totalFiles).toBe(2);
    expect(result.totalBytes).toBe(Buffer.from("console.log('hello');").length + Buffer.from("# Title").length);

    const pending = uploadStore.get(uploadId);
    expect(pending).toBeDefined();
    expect(pending?.finalised).toBe(false);

    const finalised = await uploadStore.finaliseUpload(uploadId);
    expect(finalised.repoKey).toBe(`upload:${uploadId}`);
    expect(finalised.name).toBe("my_cool_project_");
  });

  it("enforces cap limits mid-stream and aborts cleanly", async () => {
    const { uploadId } = await uploadStore.createUpload("large-project");
    const hugeBuffer = Buffer.alloc(8 * 1024 * 1024); // 8MB

    // Add multiple batches until cap is hit
    let failed = false;
    try {
      for (let i = 0; i < 25; i++) {
        await uploadStore.addFiles(uploadId, [{ path: `file${i}.dat`, buffer: hugeBuffer }]);
      }
    } catch {
      failed = true;
    }

    expect(failed).toBe(true);
    // Should have deleted the upload immediately on overflow
    expect(uploadStore.get(uploadId)).toBeUndefined();
  });

  it("deletes folder on discard", async () => {
    const { uploadId } = await uploadStore.createUpload("to-delete");
    await uploadStore.addFiles(uploadId, [
      { path: "a.txt", buffer: Buffer.from("data") },
    ]);
    const upload = uploadStore.get(uploadId);
    expect(upload).toBeDefined();
    const dir = upload!.dir;

    const dirExistsBefore = await stat(dir).then(() => true).catch(() => false);
    expect(dirExistsBefore).toBe(true);

    await uploadStore.discardUpload(uploadId);
    expect(uploadStore.get(uploadId)).toBeUndefined();

    const dirExistsAfter = await stat(dir).then(() => true).catch(() => false);
    expect(dirExistsAfter).toBe(false);
  });

  it("schedules grace deletion that survives a reconnect / cancellation", async () => {
    const { uploadId } = await uploadStore.createUpload("grace-test");
    const evicted: string[] = [];

    uploadStore.scheduleGraceDeletion(uploadId, async (key) => {
      evicted.push(key);
    });

    // Cancel before grace period ends
    const cancelled = uploadStore.cancelGraceDeletion(uploadId);
    expect(cancelled).toBe(true);

    // Wait past grace period
    await new Promise((r) => setTimeout(r, 150));
    expect(evicted).toHaveLength(0);
    expect(uploadStore.get(uploadId)).toBeDefined();
  });
});

describe("Workspace eviction safety", () => {
  it("never deletes a local workspace folder on evict", async () => {
    const localDir = await mkdtemp(join(tmpdir(), "sudocity-user-real-repo-"));
    const dummyFile = join(localDir, "user-code.ts");
    await writeFile(dummyFile, "export const myCode = 123;");

    const mockLog = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      trace: vi.fn(),
      fatal: vi.fn(),
      child: () => mockLog,
    };

    const manager = new WorkspaceManager({
      log: mockLog as any,
      cloneRoot: join(tmpdir(), "sudocity-clones"),
      globalMaxBudgetUsd: 1,
      sink: {
        onEvent: () => {},
        onCitiesChanged: () => {},
        onIssuesChanged: () => {},
      },
    });

    const workspace = await manager.openLocal(localDir);
    expect(workspace.key).toMatch(/^local:/);

    // Evict the workspace
    await manager.evict(workspace.key);

    // Critical assertion: user file and directory must still exist!
    const fileExists = await stat(dummyFile).then(() => true).catch(() => false);
    expect(fileExists).toBe(true);
  });
});
