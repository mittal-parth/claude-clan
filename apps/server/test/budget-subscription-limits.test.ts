import { describe, expect, it, vi } from "vitest";
import type { FastifyBaseLogger } from "fastify";
import { WorkspaceManager } from "../src/workspaces.js";

const mockLog = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
} as unknown as FastifyBaseLogger;

describe("WorkspaceManager subscription rate limits", () => {
  it("provides 5-hour and weekly limit windows in subscription mode", () => {
    const onBudgetChanged = vi.fn();
    const workspaces = new WorkspaceManager({
      log: mockLog,
      cloneRoot: "/tmp/sudocity",
      budgetPolicy: { kind: "local-subscription" },
      sink: {
        onEvent: vi.fn(),
        onSessionChanged: vi.fn(),
        onCitiesChanged: vi.fn(),
        onIssuesChanged: vi.fn(),
        onBudgetChanged,
      },
    });

    // Before any SDK events, status is allowed and unmetered
    const initial = workspaces.budgetInfo(undefined);
    expect(initial.mode).toBe("subscription");
    expect(initial.fiveHourLimit?.status).toBe("allowed");
    expect(initial.weeklyLimit?.status).toBe("allowed");

    // Update with 5-hour rate limit event
    workspaces.updateRateLimit({
      rateLimitType: "five_hour",
      status: "allowed",
      utilization: 32,
      resetsAt: "2026-08-29T23:00:00.000Z",
    });

    expect(onBudgetChanged).toHaveBeenCalledTimes(1);

    // Update with weekly rate limit event
    workspaces.updateRateLimit({
      rateLimitType: "seven_day",
      status: "allowed_warning",
      utilization: 84,
      resetsAt: "2026-08-31T00:00:00.000Z",
    });

    expect(onBudgetChanged).toHaveBeenCalledTimes(2);

    const updated = workspaces.budgetInfo(undefined);
    expect(updated.mode).toBe("subscription");
    expect(updated.fiveHourLimit?.utilization).toBe(32);
    expect(updated.fiveHourLimit?.resetsAt).toBe("2026-08-29T23:00:00.000Z");
    expect(updated.fiveHourLimit?.status).toBe("allowed");

    expect(updated.weeklyLimit?.utilization).toBe(84);
    expect(updated.weeklyLimit?.resetsAt).toBe("2026-08-31T00:00:00.000Z");
    expect(updated.weeklyLimit?.status).toBe("allowed_warning");
  });
});
