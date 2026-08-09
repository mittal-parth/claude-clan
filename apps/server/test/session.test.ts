import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  deriveSessionKey,
  openSession,
  sealSession,
  type Session,
} from "../src/session.js";

function fixtureSession(overrides: Partial<Session> = {}): Session {
  const now = new Date("2026-08-09T12:00:00.000Z");
  return {
    userId: 42,
    login: "octocat",
    avatarUrl: "https://avatars.githubusercontent.com/u/42",
    tokens: {
      accessToken: "ghu_test",
      refreshToken: "ghr_test",
      expiresAt: new Date(now.getTime() + 8 * 60 * 60 * 1000).toISOString(),
    },
    issuedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 8 * 60 * 60 * 1000).toISOString(),
    ...overrides,
  };
}

describe("session sealing", () => {
  const key = randomBytes(32);

  it("round-trips a sealed session", () => {
    const session = fixtureSession();
    const token = sealSession(session, key);
    const opened = openSession(token, key, new Date("2026-08-09T13:00:00.000Z"));
    expect(opened).toEqual(session);
  });

  it("rejects a token sealed with a different key", () => {
    const token = sealSession(fixtureSession(), key);
    const opened = openSession(
      token,
      randomBytes(32),
      new Date("2026-08-09T13:00:00.000Z"),
    );
    expect(opened).toBeUndefined();
  });

  it("rejects a tampered token", () => {
    const token = sealSession(fixtureSession(), key);
    const bytes = Buffer.from(token, "base64url");
    bytes[bytes.length - 1] = (bytes[bytes.length - 1]! + 1) % 256;
    const tampered = bytes.toString("base64url");
    const opened = openSession(
      tampered,
      key,
      new Date("2026-08-09T13:00:00.000Z"),
    );
    expect(opened).toBeUndefined();
  });

  it("rejects an expired session", () => {
    const token = sealSession(fixtureSession(), key);
    const opened = openSession(
      token,
      key,
      new Date("2026-08-10T00:00:00.000Z"),
    );
    expect(opened).toBeUndefined();
  });

  it("rejects garbage input", () => {
    expect(openSession("not-a-token", key, new Date())).toBeUndefined();
    expect(openSession("", key, new Date())).toBeUndefined();
  });
});

describe("deriveSessionKey", () => {
  it("accepts a base64url-encoded 32-byte secret", () => {
    const secret = randomBytes(32).toString("base64url");
    expect(deriveSessionKey(secret)).toHaveLength(32);
  });

  it("rejects a secret that isn't 32 bytes", () => {
    expect(() => deriveSessionKey(randomBytes(16).toString("base64url"))).toThrow();
  });
});
