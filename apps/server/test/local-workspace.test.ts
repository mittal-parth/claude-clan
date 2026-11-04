import { mkdir, mkdtemp, stat, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { WorkspaceManager } from "../src/workspaces.js";

const silentLog = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  debug: () => undefined,
  trace: () => undefined,
  fatal: () => undefined,
  child: () => silentLog,
} as never;

const noSink = {
  onEvent: () => undefined,
  onSessionChanged: () => undefined,
  onCitiesChanged: () => undefined,
  onIssuesChanged: () => undefined,
};

async function scratchRepo(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "cc-local-"));
  await mkdir(join(dir, "src"), { recursive: true });
  await writeFile(join(dir, "src", "index.ts"), "export const x = 1;\n");
  return dir;
}

describe("local workspaces", () => {
  it("survives eviction with its directory intact", async () => {
    const dir = await scratchRepo();
    const cloneRoot = await mkdtemp(join(tmpdir(), "cc-clones-"));
    const manager = new WorkspaceManager({
      log: silentLog,
      cloneRoot,
      budgetPolicy: { kind: "local-subscription" },
      sink: noSink,
    });

    try {
      const workspace = await manager.openLocalFolder({ path: dir });
      expect(workspace.deletable).toBe(false);

      await (manager as unknown as { evict: (key: string) => Promise<void> })
        .evict(workspace.key);

      await expect(stat(dir)).resolves.toBeTruthy();
      await expect(stat(join(dir, "src", "index.ts"))).resolves.toBeTruthy();
    } finally {
      await manager.disposeAll();
      await rm(dir, { recursive: true, force: true });
      await rm(cloneRoot, { recursive: true, force: true });
    }
  });

  it("reports a subscription budget with no ceilings", async () => {
    const manager = new WorkspaceManager({
      log: silentLog,
      cloneRoot: await mkdtemp(join(tmpdir(), "cc-clones-")),
      budgetPolicy: { kind: "local-subscription" },
      sink: noSink,
    });

    expect(manager.budgetInfo(undefined)).toEqual({
      mode: "subscription",
      spentUsd: 0,
      fiveHourLimit: {
        status: "allowed",
        utilization: undefined,
        resetsAt: undefined,
      },
      weeklyLimit: {
        status: "allowed",
        utilization: undefined,
        resetsAt: undefined,
      },
    });
    await manager.disposeAll();
  });
});
