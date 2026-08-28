import { describe, expect, it } from "vitest";
import {
  MAX_RUNNING_SESSIONS_PER_WORKSPACE,
  SessionRegistry,
  autoTitle,
  type SessionState,
} from "../src/sessions.js";

function session(
  sessionId: string,
  cityId: "main" | "pr-51" = "main",
  status: SessionState["status"] = "idle",
  updatedAt = "2026-08-08T00:00:00.000Z",
): SessionState {
  return {
    sessionId,
    cityId,
    readOnly: cityId !== "main",
    title: sessionId,
    autoTitled: true,
    model: "sonnet",
    effort: "high",
    permissionMode: "default",
    status,
    sequence: 0,
    turnCount: 0,
    costUsd: 0,
    pendingPermits: new Set(),
    createdAt: "2026-08-08T00:00:00.000Z",
    updatedAt,
    queued: [],
  };
}

describe("session registry", () => {
  it("auto-titles from the first line and clips at a word boundary", () => {
    expect(autoTitle("Fix the broken map\nwith more details")).toBe("Fix the broken map");
    expect(autoTitle("   ")).toBe("Untitled order");
    const title = autoTitle("A long order that should stop at a useful word rather than exposing the whole pasted ticket body");
    expect(title.endsWith("…")).toBe(true);
    expect(title.length).toBeLessThanOrEqual(61);
    expect(title).not.toContain("\n");
  });

  it("lists sessions newest first and filters by city", () => {
    const registry = new SessionRegistry();
    registry.add(session("old", "main", "idle", "2026-08-08T00:00:00.000Z"));
    registry.add(session("new", "main", "thinking", "2026-08-08T00:02:00.000Z"));
    registry.add(session("pr", "pr-51", "idle", "2026-08-08T00:03:00.000Z"));

    expect(registry.list().map((item) => item.sessionId)).toEqual(["pr", "new", "old"]);
    expect(registry.list("pr-51").map((item) => item.sessionId)).toEqual(["pr"]);
  });

  it("counts only statuses that consume a live runner", () => {
    const registry = new SessionRegistry();
    const statuses = [
      "starting",
      "thinking",
      "working",
      "compacting",
      "idle",
      "failed",
      "interrupted",
      "closed",
    ] as const;
    for (const [index, status] of statuses.entries()) {
      registry.add(session(`session-${index}`, "main", status, `2026-08-08T00:0${index}:00.000Z`));
    }

    expect(registry.runningCount()).toBe(MAX_RUNNING_SESSIONS_PER_WORKSPACE + 1);
  });
});
