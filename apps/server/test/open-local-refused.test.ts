import { describe, expect, it } from "vitest";
import { MayorCommandSchema } from "@sudo-city/protocol";
import { isLocalMode } from "../src/local-mode.js";

describe("repo.openLocal", () => {
  it("parses as a command while leaving the server as the gate", () => {
    expect(MayorCommandSchema.safeParse({
      type: "repo.openLocal",
      path: "/Users/me/project",
    }).success).toBe(true);
  });

  it("is off by default, including production", () => {
    expect(isLocalMode({})).toBe(false);
    expect(isLocalMode({ NODE_ENV: "production" })).toBe(false);
  });
});
