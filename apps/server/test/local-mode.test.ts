import { homedir, tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { creditMode, isLocalMode, localAgentEnvironment, localCapUsd, shouldLoadRepositoryEnv } from "../src/local-mode.js";
import { validateLocalPath } from "../src/local-path.js";

describe("isLocalMode", () => {
  it("is off when unset and for malformed values", () => {
    expect(isLocalMode({})).toBe(false);


describe("local credential boundaries", () => {
  it("never loads a dropped repository .env in local mode", () => {
    expect(shouldLoadRepositoryEnv({ SUDO_CITY_LOCAL: "1" })).toBe(false);
    expect(shouldLoadRepositoryEnv({ SUDO_CITY_LOCAL: "1", ANTHROPIC_API_KEY: "inherited" })).toBe(false);
    expect(shouldLoadRepositoryEnv({})).toBe(true);
  });

  it("scrubs inherited API keys from subscription sessions", () => {
    expect(localAgentEnvironment({
      SUDO_CITY_LOCAL: "1",
      SUDO_CITY_CREDIT_MODE: "subscription",
      ANTHROPIC_API_KEY: "must-not-leak",
    })).toBeUndefined();
  });

  it("passes only the BYOK key to API-key sessions", () => {
    expect(localAgentEnvironment({
      SUDO_CITY_LOCAL: "1",
      SUDO_CITY_CREDIT_MODE: "api-key",
      ANTHROPIC_API_KEY: "user-key",
    })).toEqual({ ANTHROPIC_API_KEY: "user-key" });
    expect(localAgentEnvironment({ SUDO_CITY_LOCAL: "1", SUDO_CITY_CREDIT_MODE: "api-key" })).toBeUndefined();
  });
});
    for (const value of ["", " ", "0", "false", "no", "maybe"]) {
      expect(isLocalMode({ SUDO_CITY_LOCAL: value })).toBe(false);
    }
  });

  it("is on only for explicit values", () => {
    for (const value of ["1", "true", "TRUE", "yes"]) {
      expect(isLocalMode({ SUDO_CITY_LOCAL: value })).toBe(true);
    }
  });
});

describe("creditMode", () => {
  it("is api-key on the hosted server regardless of the env override", () => {
    expect(creditMode({ SUDO_CITY_CREDIT_MODE: "subscription" })).toBe("api-key");
  });

  it("defaults to subscription in local mode and honors BYOK", () => {
    expect(creditMode({ SUDO_CITY_LOCAL: "1" })).toBe("subscription");
    expect(creditMode({
      SUDO_CITY_LOCAL: "1",
      SUDO_CITY_CREDIT_MODE: "api-key",
    })).toBe("api-key");
  });
});

describe("localCapUsd", () => {
  it("is only active for local BYOK mode", () => {
    expect(localCapUsd({ SUDO_CITY_LOCAL_CAP_USD: "5" })).toBeUndefined();
    expect(localCapUsd({ SUDO_CITY_LOCAL: "1", SUDO_CITY_LOCAL_CAP_USD: "5" })).toBeUndefined();
    expect(localCapUsd({
      SUDO_CITY_LOCAL: "1",
      SUDO_CITY_CREDIT_MODE: "api-key",
      SUDO_CITY_LOCAL_CAP_USD: "5",
    })).toBe(5);
  });

  it("treats zero, negative, and invalid caps as unset", () => {
    const base = { SUDO_CITY_LOCAL: "1", SUDO_CITY_CREDIT_MODE: "api-key" };
    for (const value of ["0", "-1", "abc", ""]) {
      expect(localCapUsd({ ...base, SUDO_CITY_LOCAL_CAP_USD: value })).toBeUndefined();
    }
  });
});

describe("validateLocalPath", () => {
  it("rejects relative paths and forbidden roots", async () => {
    expect(await validateLocalPath("./somewhere")).toEqual({ rejected: "not-absolute" });
    for (const path of [homedir(), "/", "/System", "/etc"]) {
      expect(await validateLocalPath(path)).toEqual({ rejected: "forbidden" });
    }
  });

  it("rejects missing paths", async () => {
    expect(await validateLocalPath("/definitely/not/here/at/all")).toEqual({
      rejected: "not-found",
    });
  });

  it("accepts real directories and reports git status", async () => {
    expect(await validateLocalPath(resolve(process.cwd(), "../.."))).toMatchObject({ isGitRepo: true });
    expect(await validateLocalPath(tmpdir())).toMatchObject({ isGitRepo: false });
  });
});
