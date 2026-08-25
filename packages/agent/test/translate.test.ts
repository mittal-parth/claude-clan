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
});
