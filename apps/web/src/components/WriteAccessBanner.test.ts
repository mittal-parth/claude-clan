import { describe, expect, it } from "vitest";
import {
  DEFAULT_WRITE_ACCESS_MESSAGE,
  formatWriteAccessMessage,
} from "./WriteAccessBanner";

describe("WriteAccessBanner", () => {
  it("formats write access message correctly with fallback", () => {
    expect(formatWriteAccessMessage()).toBe(DEFAULT_WRITE_ACCESS_MESSAGE);
    expect(formatWriteAccessMessage("")).toBe(DEFAULT_WRITE_ACCESS_MESSAGE);
    expect(formatWriteAccessMessage("   ")).toBe(DEFAULT_WRITE_ACCESS_MESSAGE);
  });

  it("preserves custom error messages when provided", () => {
    const custom = "Permission denied: unable to push to master branch.";
    expect(formatWriteAccessMessage(custom)).toBe(custom);
    expect(formatWriteAccessMessage(`  ${custom}  `)).toBe(custom);
  });
});
