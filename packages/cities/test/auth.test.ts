import { describe, expect, it } from "vitest";
import {
  installUrl,
  needsRefresh,
  parseInstallationsJson,
  parseRepoListJson,
  parseUserReposJson,
  parseTokenResponse,
  parseViewerJson,
  repoKeyFor,
  signState,
  verifyState,
} from "../src/auth.js";

const now = new Date("2026-08-09T12:00:00.000Z");

describe("parseTokenResponse", () => {
  it("parses expires_in/refresh_token_expires_in into absolute timestamps", () => {
    const tokens = parseTokenResponse(
      {
        access_token: "ghu_abc",
        refresh_token: "ghr_abc",
        expires_in: 28_800,
        refresh_token_expires_in: 15_897_600,
        token_type: "bearer",
      },
      now,
    );
    expect(tokens).toEqual({
      accessToken: "ghu_abc",
      refreshToken: "ghr_abc",
      expiresAt: new Date(now.getTime() + 28_800_000).toISOString(),
      refreshTokenExpiresAt: new Date(now.getTime() + 15_897_600_000).toISOString(),
    });
  });

  it("throws on a GitHub error response", () => {
    expect(() =>
      parseTokenResponse(
        { error: "bad_verification_code", error_description: "expired" },
        now,
      ),
    ).toThrow(/expired/);
  });

  it("throws when expiring tokens aren't enabled", () => {
    expect(() =>
      parseTokenResponse({ access_token: "ghu_abc" }, now),
    ).toThrow();
  });
});

describe("needsRefresh", () => {
  const tokens = {
    accessToken: "x",
    expiresAt: new Date(now.getTime() + 90_000).toISOString(),
  };

  it("is false with more than 60s of life left", () => {
    expect(needsRefresh(tokens, now)).toBe(false);
  });

  it("is true with fewer than 60s of life left", () => {
    expect(needsRefresh(tokens, new Date(now.getTime() + 40_000))).toBe(true);
  });

  it("is true once already expired", () => {
    expect(needsRefresh(tokens, new Date(now.getTime() + 200_000))).toBe(true);
  });
});

describe("parseInstallationsJson", () => {
  it("prefers account.login, falls back to slug", () => {
    const installations = parseInstallationsJson({
      installations: [
        { id: 1, account: { login: "octocat" } },
        { id: 2, account: { slug: "octo-org" } },
      ],
    });
    expect(installations).toEqual([
      { id: 1, account: "octocat" },
      { id: 2, account: "octo-org" },
    ]);
  });
});

describe("parseRepoListJson", () => {
  it("maps GitHub's repo shape", () => {
    const repos = parseRepoListJson({
      repositories: [
        {
          full_name: "octocat/hello-world",
          owner: { login: "octocat" },
          name: "hello-world",
          private: false,
          default_branch: "main",
        },
      ],
    });
    expect(repos).toEqual([
      {
        fullName: "octocat/hello-world",
        owner: "octocat",
        name: "hello-world",
        private: false,
        defaultBranch: "main",
      },
    ]);
  });
});

describe("parseUserReposJson", () => {
  it("maps GitHub's array repo shape", () => {
    const repos = parseUserReposJson([
      {
        full_name: "octocat/hello-world",
        owner: { login: "octocat" },
        name: "hello-world",
        private: false,
        default_branch: "main",
      },
    ]);
    expect(repos).toEqual([
      {
        fullName: "octocat/hello-world",
        owner: "octocat",
        name: "hello-world",
        private: false,
        defaultBranch: "main",
      },
    ]);
  });
});

describe("parseViewerJson", () => {
  it("maps /user's response", () => {
    expect(
      parseViewerJson({
        id: 42,
        login: "octocat",
        avatar_url: "https://avatars.githubusercontent.com/u/42",
      }),
    ).toEqual({
      id: 42,
      login: "octocat",
      avatarUrl: "https://avatars.githubusercontent.com/u/42",
    });
  });
});

describe("installUrl", () => {
  it("builds an installations/new URL carrying state", () => {
    const url = installUrl("sudo-city", "abc.def");
    expect(url).toBe(
      "https://github.com/apps/sudo-city/installations/new?state=abc.def",
    );
  });
});

describe("repoKeyFor", () => {
  it("lowercases the full name", () => {
    expect(repoKeyFor("Octocat/Hello-World")).toBe("octocat/hello-world");
  });
});

describe("state signing", () => {
  const secret = "test-secret";

  it("verifies a freshly signed state", () => {
    const state = signState(secret, now);
    expect(verifyState(state, secret, now)).toBe(true);
  });

  it("rejects a state past its 10-minute TTL", () => {
    const state = signState(secret, now);
    const later = new Date(now.getTime() + 11 * 60 * 1000);
    expect(verifyState(state, secret, later)).toBe(false);
  });

  it("rejects a state signed with a different secret", () => {
    const state = signState("other-secret", now);
    expect(verifyState(state, secret, now)).toBe(false);
  });

  it("rejects malformed state", () => {
    expect(verifyState("garbage", secret, now)).toBe(false);
    expect(verifyState("", secret, now)).toBe(false);
  });
});
