import { access, rm } from "node:fs/promises";
import { join } from "node:path";
import type { SandboxSettings } from "@sudo-city/agent";
import type { BudgetInfo, CityId, GameEvent } from "@sudo-city/protocol";
import type { FastifyBaseLogger } from "fastify";
import { cloneRepo } from "./clone.js";
import { chooseEvictionVictim } from "./eviction.js";
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
 * The durable half of the budget ledger. In-process spend is lost whenever a
 * workspace is LRU-evicted or the server restarts, so a per-user cap that only
 * counted memory would quietly reset on every deploy. Absent (no GitHub App
 * configured) means nobody can sign in, so there is no per-user cap to apply.
 */
export interface UserSpendStore {
  spentUsd: (userId: number) => Promise<number>;
  addSpend: (userId: number, amountUsd: number) => Promise<number>;
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
  private readonly perUserMaxBudgetUsd: number;
  private readonly sandboxFor: ((repoPath: string) => SandboxSettings | undefined) | undefined;
  private readonly spendStore: UserSpendStore | undefined;
  /** Lifetime spend per signed-in user, read through from spendStore on first open and written back after every run. */
  private readonly userSpend = new Map<number, number>();
  private readonly sink: WorkspaceEventSink;
  private demoWorkspace: Workspace | undefined;

  constructor(options: {
    log: FastifyBaseLogger;
    cloneRoot: string;
    globalMaxBudgetUsd: number;
    perUserMaxBudgetUsd: number;
    spendStore?: UserSpendStore;
    sandboxFor?: (repoPath: string) => SandboxSettings | undefined;
    sink: WorkspaceEventSink;
  }) {
    this.log = options.log;
    this.cloneRoot = options.cloneRoot;
    this.globalMaxBudgetUsd = options.globalMaxBudgetUsd;
    this.perUserMaxBudgetUsd = options.perUserMaxBudgetUsd;
    this.sandboxFor = options.sandboxFor;
    this.spendStore = options.spendStore;
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

  /** What this user has left of their own lifetime cap, independent of the shared ceiling. */
  remainingUserBudget(userId: number): number {
    return Math.max(
      0,
      this.perUserMaxBudgetUsd - (this.userSpend.get(userId) ?? 0),
    );
  }

  userSpentUsd(userId: number): number {
    return this.userSpend.get(userId) ?? 0;
  }

  budgetInfo(userId: number | undefined): BudgetInfo {
    if (userId === undefined) {
      const spent = [...this.workspaces.values()].reduce(
        (total, workspace) => total + workspace.spentUsd(),
        0,
      );
      const remaining = Math.max(0, this.globalMaxBudgetUsd - spent);
      return {
        totalBudgetUsd: this.globalMaxBudgetUsd,
        spentUsd: spent,
        remainingBudgetUsd: remaining,
      };
    }

    const spent = this.userSpentUsd(userId);
    const remaining = this.remainingBudgetFor(userId);
    return {
      totalBudgetUsd: this.perUserMaxBudgetUsd,
      spentUsd: spent,
      remainingBudgetUsd: remaining,
    };
  }

  /**
   * A signed-in user's order is capped by whichever runs out first: the shared
   * ceiling that funds the whole server, or their own lifetime allowance.
   */
  private remainingBudgetFor(userId: number | undefined): number {
    if (userId === undefined) {
      return this.remainingBudget();
    }
    return Math.min(this.remainingBudget(), this.remainingUserBudget(userId));
  }

  private recordSpend(userId: number, amountUsd: number): void {
    if (amountUsd <= 0) {
      return;
    }
    // Update the in-memory figure first so a second order started before the
    // write lands is still capped against the new total.
    this.userSpend.set(userId, (this.userSpend.get(userId) ?? 0) + amountUsd);
    void this.spendStore
      ?.addSpend(userId, amountUsd)
      .then((total) => {
        // The database is authoritative: it also carries spend from other
        // instances and from workspaces this process has already evicted.
        this.userSpend.set(userId, total);
      })
      .catch((error: unknown) => {
        this.log.error(
          { error, userId, amountUsd },
          "Failed to persist a user's spend; their cap is now enforced from memory only until the next reload",
        );
      });
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

  /**
   * Pulls the user's lifetime spend into memory before their first workspace
   * opens, so the cap starts from what they have actually spent rather than
   * from zero after a restart or an eviction. A read failure is left to the
   * caller's error path rather than defaulting to zero -- treating a database
   * blip as "no spend yet" would hand out a fresh allowance every time.
   */
  async ensureUserSpendLoaded(userId: number): Promise<void> {
    if (!this.spendStore || this.userSpend.has(userId)) {
      return;
    }
    this.userSpend.set(userId, await this.spendStore.spentUsd(userId));
  }

  private async loadUserSpend(userId: number): Promise<void> {
    await this.ensureUserSpendLoaded(userId);
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
      await this.evictIfNeeded(options.userId);
      await this.loadUserSpend(options.userId);
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
      const workspace = await this.buildWorkspace(
        key,
        repoPath,
        options.githubToken,
        options.userId,
      );
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
    userId?: number,
  ): Promise<Workspace> {
    return Workspace.open({
      key,
      repoPath,
      githubToken,
      log: this.log,
      sandbox: this.sandboxFor?.(repoPath),
      remainingBudget: () => this.remainingBudgetFor(userId),
      onSpend:
        userId === undefined
          ? undefined
          : (amountUsd) => this.recordSpend(userId, amountUsd),
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
  private async evictIfNeeded(userId: number): Promise<void> {
    const userKeys = this.workspaceKeysForUser(userId);
    if (userKeys.length >= PER_USER_WORKSPACE_CAP) {
      await this.evictLru(userKeys);
    }
    const nonDemoCount = this.workspaces.size - (this.demoWorkspace ? 1 : 0);
    if (nonDemoCount >= GLOBAL_WORKSPACE_CAP) {
      const allNonDemoKeys = [...this.workspaces.keys()].filter(
        (key) => key !== DEMO_KEY,
      );
      await this.evictLru(allNonDemoKeys);
    }
  }

  private async evictLru(candidateKeys: readonly string[]): Promise<void> {
    const candidates = candidateKeys
      .map((key) => this.workspaces.get(key))
      .filter(
        (workspace): workspace is Workspace =>
          workspace !== undefined && !workspace.hasRunningAgent(),
      )
      .map((workspace) => ({ key: workspace.key, lastUsedAt: workspace.lastUsedAt, workspace }));

    const chosen = await chooseEvictionVictim(candidates, (candidate) =>
      candidate.workspace.hasUncommittedChanges(),
    );
    if (!chosen) {
      return;
    }
    if (chosen.dirty) {
      // Every candidate had uncommitted work and the cap still has to be
      // honoured, so this deletes edits that exist nowhere else. Logged loudly
      // because it is the one path that loses a user's work silently.
      this.log.warn(
        { key: chosen.victim.key },
        "Evicting a workspace with uncommitted changes; its working tree is being deleted",
      );
    }
    await this.evict(chosen.victim.key);
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
