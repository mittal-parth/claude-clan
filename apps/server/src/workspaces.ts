import { access, rm } from "node:fs/promises";
import { join } from "node:path";
import type { CityId, GameEvent } from "@sudo-city/protocol";
import type { FastifyBaseLogger } from "fastify";
import { cloneRepo } from "./clone.js";
import { Workspace } from "./workspace.js";

const DEMO_KEY = "demo";
const GLOBAL_WORKSPACE_CAP = 80;
const PER_USER_WORKSPACE_CAP = 4;

export interface WorkspaceEventSink {
  onEvent: (workspaceKey: string, cityId: CityId, event: GameEvent) => void;
  onCitiesChanged: (workspaceKey: string) => void;
  onIssuesChanged: (workspaceKey: string) => void;
}

/**
 * Owns every open Workspace for the process. The demo workspace (the repo
 * the server itself is running from) is opened once at boot, shared by every
 * anonymous visitor, and never evicted -- it must keep working with zero
 * configured credentials. Everything else is a per-user clone under
 * cloneRoot, LRU-evicted once the process holds too many of them open at
 * once (Render's disk and memory are both finite, and each open Workspace
 * holds a live SQLite handle and at least one AgentSessionManager).
 */
export class WorkspaceManager {
  private readonly workspaces = new Map<string, Workspace>();
  private readonly pendingOpens = new Map<string, Promise<Workspace>>();
  private readonly log: FastifyBaseLogger;
  private readonly cloneRoot: string;
  private readonly globalMaxBudgetUsd: number;
  private readonly sink: WorkspaceEventSink;
  private demoWorkspace: Workspace | undefined;

  constructor(options: {
    log: FastifyBaseLogger;
    cloneRoot: string;
    globalMaxBudgetUsd: number;
    sink: WorkspaceEventSink;
  }) {
    this.log = options.log;
    this.cloneRoot = options.cloneRoot;
    this.globalMaxBudgetUsd = options.globalMaxBudgetUsd;
    this.sink = options.sink;
  }

  /** Rationed across every open workspace's spend, not per-workspace -- see workspace.ts's WorkspaceOptions.remainingBudget doc. */
  remainingBudget(): number {
    const spent = [...this.workspaces.values()].reduce(
      (total, workspace) => total + workspace.spentUsd(),
      0,
    );
    return Math.max(0, this.globalMaxBudgetUsd - spent);
  }

  async openDemo(repoPath: string): Promise<Workspace> {
    if (this.demoWorkspace) {
      return this.demoWorkspace;
    }
    const workspace = await this.buildWorkspace(DEMO_KEY, repoPath, undefined);
    this.demoWorkspace = workspace;
    this.workspaces.set(DEMO_KEY, workspace);
    return workspace;
  }

  getDemo(): Workspace {
    if (!this.demoWorkspace) {
      throw new Error("Demo workspace has not been opened yet");
    }
    return this.demoWorkspace;
  }

  private repoCloneDir(userId: number, owner: string, name: string): string {
    return join(this.cloneRoot, String(userId), owner, name);
  }

  /**
   * Opens (or reuses) the workspace for this user's repo. A second call
   * while a clone is already in flight for the same key reuses the same
   * promise, so a doubled-up repo.select doesn't start two clones racing
   * into the same directory.
   */
  async openUserRepo(options: {
    userId: number;
    owner: string;
    name: string;
    repoKey: string;
    githubToken: string;
    onProgress?: (message: string) => void;
  }): Promise<Workspace> {
    const key = `${options.userId}:${options.repoKey}`;
    const existing = this.workspaces.get(key);
    if (existing) {
      existing.touch();
      return existing;
    }
    const pending = this.pendingOpens.get(key);
    if (pending) {
      return pending;
    }

    const opening = (async () => {
      this.evictIfNeeded(options.userId);
      const repoPath = this.repoCloneDir(options.userId, options.owner, options.name);
      // A restart (the in-memory `workspaces` map above is gone, hence
      // reaching this branch at all) doesn't touch a clone already sitting
      // on disk -- only Render's ephemeral /tmp wipes those, not a process
      // restart. Re-cloning unconditionally would rm -rf a perfectly good
      // multi-minute-old checkout and pay that cost again for nothing.
      const alreadyCloned = await access(join(repoPath, ".git"))
        .then(() => true)
        .catch(() => false);
      if (alreadyCloned) {
        options.onProgress?.("reusing existing clone");
      } else {
        await cloneRepo({
          owner: options.owner,
          name: options.name,
          destination: repoPath,
          githubToken: options.githubToken,
          onProgress: options.onProgress,
        });
      }
      const workspace = await this.buildWorkspace(key, repoPath, options.githubToken);
      this.workspaces.set(key, workspace);
      return workspace;
    })().finally(() => {
      this.pendingOpens.delete(key);
    });
    this.pendingOpens.set(key, opening);
    return opening;
  }

  private async buildWorkspace(
    key: string,
    repoPath: string,
    githubToken: string | undefined,
  ): Promise<Workspace> {
    return Workspace.open({
      key,
      repoPath,
      githubToken,
      log: this.log,
      remainingBudget: () => this.remainingBudget(),
      onEvent: (cityId, event) => this.sink.onEvent(key, cityId, event),
      onCitiesChanged: () => this.sink.onCitiesChanged(key),
      onIssuesChanged: () => this.sink.onIssuesChanged(key),
    });
  }

  get(key: string): Workspace | undefined {
    const workspace = this.workspaces.get(key);
    workspace?.touch();
    return workspace;
  }

  workspaceKeysForUser(userId: number): string[] {
    const prefix = `${userId}:`;
    return [...this.workspaces.keys()].filter((key) => key.startsWith(prefix));
  }

  /**
   * Evicts the least-recently-used non-demo, non-running workspace once this
   * user is at their per-user cap or the process is at its global cap --
   * checked before opening a new one, not on a timer, so the cap is a hard
   * ceiling rather than a best-effort cleanup.
   */
  private evictIfNeeded(userId: number): void {
    const userKeys = this.workspaceKeysForUser(userId);
    if (userKeys.length >= PER_USER_WORKSPACE_CAP) {
      this.evictLru(userKeys);
    }
    const nonDemoCount = this.workspaces.size - (this.demoWorkspace ? 1 : 0);
    if (nonDemoCount >= GLOBAL_WORKSPACE_CAP) {
      const allNonDemoKeys = [...this.workspaces.keys()].filter(
        (key) => key !== DEMO_KEY,
      );
      this.evictLru(allNonDemoKeys);
    }
  }

  private evictLru(candidateKeys: readonly string[]): void {
    let victim: Workspace | undefined;
    for (const key of candidateKeys) {
      const workspace = this.workspaces.get(key);
      if (!workspace || workspace.hasRunningAgent()) {
        continue;
      }
      if (!victim || workspace.lastUsedAt < victim.lastUsedAt) {
        victim = workspace;
      }
    }
    if (victim) {
      void this.evict(victim.key);
    }
  }

  private async evict(key: string): Promise<void> {
    const workspace = this.workspaces.get(key);
    if (!workspace || key === DEMO_KEY) {
      return;
    }
    this.workspaces.delete(key);
    await workspace.dispose();
    await rm(workspace.repoPath, { recursive: true, force: true }).catch((error: unknown) => {
      this.log.warn({ error, key }, "Failed to remove an evicted workspace's clone");
    });
  }

  async disposeAll(): Promise<void> {
    await Promise.all(
      [...this.workspaces.values()].map((workspace) => workspace.dispose()),
    );
  }
}
