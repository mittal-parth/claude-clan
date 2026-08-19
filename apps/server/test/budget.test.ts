import { describe, expect, it, vi } from "vitest";
import type { FastifyBaseLogger } from "fastify";
import { WorkspaceManager, type UserSpendStore } from "../src/workspaces.js";

const mockLog = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
} as unknown as FastifyBaseLogger;

describe("WorkspaceManager budgetInfo", () => {
  it("returns global budget info for unauthenticated / demo users", () => {
    const workspaces = new WorkspaceManager({
      log: mockLog,
      cloneRoot: "/tmp/sudocity",
      globalMaxBudgetUsd: 1,
      perUserMaxBudgetUsd: 10,
      sink: {
        onEvent: vi.fn(),
        onCitiesChanged: vi.fn(),
        onIssuesChanged: vi.fn(),
      },
    });

    const info = workspaces.budgetInfo(undefined);
    expect(info).toEqual({
      totalBudgetUsd: 1,
      spentUsd: 0,
      remainingBudgetUsd: 1,
    });
  });

  it("loads and returns per-user budget info for authenticated users", async () => {
    let storedSpend = 3.5;
    const spendStore: UserSpendStore = {
      spentUsd: async (_userId: number) => storedSpend,
      addSpend: async (_userId: number, amount: number) => {
        storedSpend += amount;
        return storedSpend;
      },
    };

    const workspaces = new WorkspaceManager({
      log: mockLog,
      cloneRoot: "/tmp/sudocity",
      globalMaxBudgetUsd: 5,
      perUserMaxBudgetUsd: 10,
      spendStore,
      sink: {
        onEvent: vi.fn(),
        onCitiesChanged: vi.fn(),
        onIssuesChanged: vi.fn(),
      },
    });

    await workspaces.ensureUserSpendLoaded(42);
    const info = workspaces.budgetInfo(42);
    expect(info).toEqual({
      totalBudgetUsd: 10,
      spentUsd: 3.5,
      remainingBudgetUsd: 5, // capped by globalMaxBudgetUsd (5 < (10 - 3.5 = 6.5))
    });
  });

  it("caps user remaining budget when user allowance is smaller than global budget", async () => {
    const spendStore: UserSpendStore = {
      spentUsd: async (_userId: number) => 8.5,
      addSpend: async () => 8.5,
    };

    const workspaces = new WorkspaceManager({
      log: mockLog,
      cloneRoot: "/tmp/sudocity",
      globalMaxBudgetUsd: 5,
      perUserMaxBudgetUsd: 10,
      spendStore,
      sink: {
        onEvent: vi.fn(),
        onCitiesChanged: vi.fn(),
        onIssuesChanged: vi.fn(),
      },
    });

    await workspaces.ensureUserSpendLoaded(42);
    const info = workspaces.budgetInfo(42);
    expect(info).toEqual({
      totalBudgetUsd: 10,
      spentUsd: 8.5,
      remainingBudgetUsd: 1.5, // 10 - 8.5 = 1.5 (< 5)
    });
  });
});
