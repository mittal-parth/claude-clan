import type { SessionSummary } from "@sudo-city/protocol";
import { describe, expect, it } from "vitest";
import { filterArchivedSessions } from "./ArchivedSessionsModal";

const sampleSessions: SessionSummary[] = [
  {
    sessionId: "sess-alpha-001",
    cityId: "main",
    title: "Add dark mode toggle to navigation",
    autoTitled: false,
    status: "closed",
    model: "sonnet",
    effort: "high",
    permissionMode: "default",
    createdAt: "2026-08-28T10:00:00.000Z",
    updatedAt: "2026-08-28T10:30:00.000Z",
    turnCount: 5,
    costUsd: 0.12,
    pendingPermitCount: 0,
    queuedCount: 0,
    live: false,
    readOnly: true,
    lastSequence: 10,
    activityLine: "Refactored theme tokens",
  },
  {
    sessionId: "sess-beta-002",
    cityId: "pr-42",
    title: "Fix broken database connection retry",
    autoTitled: true,
    status: "closed",
    model: "opus",
    effort: "xhigh",
    permissionMode: "auto",
    createdAt: "2026-08-28T11:00:00.000Z",
    updatedAt: "2026-08-28T11:45:00.000Z",
    turnCount: 8,
    costUsd: 0.45,
    pendingPermitCount: 0,
    queuedCount: 0,
    live: false,
    readOnly: true,
    lastSequence: 20,
  },
  {
    sessionId: "sess-gamma-003",
    cityId: "feature-airport",
    title: "Implement runway flight path coordinates",
    autoTitled: false,
    status: "closed",
    model: "haiku",
    effort: "low",
    permissionMode: "default",
    createdAt: "2026-08-28T12:00:00.000Z",
    updatedAt: "2026-08-28T12:15:00.000Z",
    turnCount: 2,
    costUsd: 0.03,
    pendingPermitCount: 0,
    queuedCount: 0,
    live: false,
    readOnly: true,
    lastSequence: 4,
    activityLine: "Plotted runway points",
  },
];

describe("ArchivedSessionsModal session filtering", () => {
  it("returns all sessions when query is empty or whitespace", () => {
    expect(filterArchivedSessions(sampleSessions, "")).toHaveLength(3);
    expect(filterArchivedSessions(sampleSessions, "   ")).toHaveLength(3);
  });

  it("filters sessions by title case-insensitively", () => {
    const results = filterArchivedSessions(sampleSessions, "DARK MODE");
    expect(results).toHaveLength(1);
    expect(results[0]?.sessionId).toBe("sess-alpha-001");
  });

  it("filters sessions by partial title match", () => {
    const results = filterArchivedSessions(sampleSessions, "database");
    expect(results).toHaveLength(1);
    expect(results[0]?.sessionId).toBe("sess-beta-002");
  });

  it("filters sessions by cityId", () => {
    const results = filterArchivedSessions(sampleSessions, "pr-42");
    expect(results).toHaveLength(1);
    expect(results[0]?.sessionId).toBe("sess-beta-002");
  });

  it("filters sessions by sessionId substring", () => {
    const results = filterArchivedSessions(sampleSessions, "gamma");
    expect(results).toHaveLength(1);
    expect(results[0]?.sessionId).toBe("sess-gamma-003");
  });

  it("filters sessions by model name", () => {
    const results = filterArchivedSessions(sampleSessions, "haiku");
    expect(results).toHaveLength(1);
    expect(results[0]?.sessionId).toBe("sess-gamma-003");
  });

  it("filters sessions by crew catalog name", () => {
    const resultsWorker = filterArchivedSessions(sampleSessions, "worker");
    expect(resultsWorker).toHaveLength(1);
    expect(resultsWorker[0]?.sessionId).toBe("sess-alpha-001");

    const resultsArchitect = filterArchivedSessions(sampleSessions, "architect");
    expect(resultsArchitect).toHaveLength(1);
    expect(resultsArchitect[0]?.sessionId).toBe("sess-beta-002");
  });

  it("filters sessions by activityLine", () => {
    const results = filterArchivedSessions(sampleSessions, "theme tokens");
    expect(results).toHaveLength(1);
    expect(results[0]?.sessionId).toBe("sess-alpha-001");
  });

  it("returns empty array when query does not match any session", () => {
    const results = filterArchivedSessions(sampleSessions, "nonexistent-query-xyz");
    expect(results).toHaveLength(0);
  });
});
