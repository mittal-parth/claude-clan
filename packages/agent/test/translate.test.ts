import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  previewInput,
  toolTarget,
  translateMessage,
  turnOutcomeFor,
} from "../src/index.js";

describe("agent translation", () => {
  it("maps SDK terminal subtypes without inspecting assistant prose", () => {
    expect(turnOutcomeFor({ subtype: "success" })).toBe("success");
    expect(turnOutcomeFor({ subtype: "error_max_turns" })).toBe("max-turns");
    expect(turnOutcomeFor({ subtype: "error_max_budget_usd" })).toBe("budget-exhausted");
    expect(turnOutcomeFor({ subtype: "interrupted" })).toBe("interrupted");
    expect(turnOutcomeFor({ subtype: "some_future_failure" })).toBe("error");
  });

  it("truncates only long string input fields", () => {
    const preview = previewInput({
      short: "value",
      long: "x".repeat(2_100),
      count: 42,
      nested: { keep: true },
    });

    expect(preview?.short).toBe("value");
    expect(String(preview?.long).length).toBe(2_001);
    expect(preview?.count).toBe(42);
    expect(preview?.nested).toEqual({ keep: true });
  });

  it("makes absolute file targets repository-relative and normalises separators", () => {
    const target = toolTarget({ file_path: `${join("/repo", "src", "index.ts")}` }, "/repo");
    expect(target).toBe("src/index.ts");
  });

  it("translates thinking, redacted thinking, and readable text", () => {
    const events = translateMessage({
      type: "assistant",
      uuid: "assistant-1",
      message: {
        content: [
          { type: "text", text: "answer" },
          { type: "thinking", thinking: "private reasoning" },
          { type: "redacted_thinking", data: "encrypted payload" },
        ],
      },
    }, "turn-1");

    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "session.message", kind: "text", text: "answer" }),
      expect.objectContaining({ type: "session.message", kind: "thinking", text: "private reasoning" }),
      expect.objectContaining({ type: "session.message", kind: "thinking" }),
    ]));
    expect(JSON.stringify(events)).not.toContain("encrypted payload");
  });

  it("shares stable messageId across stream chunks and matches final assistant message", () => {
    const stableMessageId = "msg_011CeVKL7iwyLEUSK3vPKYsd";

    // 1. Thinking delta chunk 1 (random frame uuid)
    const chunk1 = translateMessage({
      type: "stream_event",
      uuid: "random-uuid-1",
      event: {
        type: "content_block_delta",
        index: 0,
        delta: { type: "thinking_delta", thinking: "The user wants " },
      },
    }, "turn-1", stableMessageId);

    // 2. Thinking delta chunk 2 (different random frame uuid)
    const chunk2 = translateMessage({
      type: "stream_event",
      uuid: "random-uuid-2",
      event: {
        type: "content_block_delta",
        index: 0,
        delta: { type: "thinking_delta", thinking: "to edit README." },
      },
    }, "turn-1", stableMessageId);

    // Both chunks must share the EXACT SAME messageId so the client accumulates them in one box
    expect(chunk1).toEqual([
      {
        type: "session.delta",
        messageId: `${stableMessageId}:thinking`,
        turnId: "turn-1",
        kind: "thinking",
        text: "The user wants ",
      },
    ]);
    expect(chunk2).toEqual([
      {
        type: "session.delta",
        messageId: `${stableMessageId}:thinking`,
        turnId: "turn-1",
        kind: "thinking",
        text: "to edit README.",
      },
    ]);

    // 3. Final assistant message arrives
    const assistant = translateMessage({
      type: "assistant",
      uuid: "assistant-random-uuid",
      message: {
        id: stableMessageId,
        content: [
          { type: "thinking", thinking: "The user wants to edit README." },
          { type: "text", text: "Done!" },
        ],
      },
    }, "turn-1", stableMessageId);

    // The thinking messageId must match the delta stream messageId exactly so it clears and replaces it
    expect(assistant).toEqual([
      {
        type: "session.message",
        messageId: `${stableMessageId}:thinking`,
        turnId: "turn-1",
        role: "agent",
        kind: "thinking",
        text: "The user wants to edit README.",
        contextPaths: [],
      },
      {
        type: "session.message",
        messageId: stableMessageId,
        turnId: "turn-1",
        role: "agent",
        kind: "text",
        text: "Done!",
        contextPaths: [],
      },
    ]);
  });
});
