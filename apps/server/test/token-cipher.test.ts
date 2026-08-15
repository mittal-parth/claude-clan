import { describe, expect, it } from "vitest";
import { TokenCipher } from "../src/token-cipher.js";

const cipher = new TokenCipher("test-key-not-a-real-secret");

describe("TokenCipher", () => {
  it("round-trips a token", () => {
    const token = "ghu_abcdefghijklmnopqrstuvwxyz0123456789";

    const encrypted = cipher.encrypt(token);

    expect(encrypted).not.toContain(token);
    expect(cipher.decrypt(encrypted)).toBe(token);
  });

  it("produces a different ciphertext every time, so equal tokens don't look equal", () => {
    const token = "ghu_same_token";

    const first = cipher.encrypt(token);
    const second = cipher.encrypt(token);

    expect(first).not.toBe(second);
    expect(cipher.decrypt(first)).toBe(token);
    expect(cipher.decrypt(second)).toBe(token);
  });

  it("refuses a ciphertext edited in the database", () => {
    const encrypted = cipher.encrypt("ghu_tampered");
    const [version, iv, tag, body] = encrypted.split(".");
    // Flip the last character of the ciphertext, leaving the shape intact.
    const flipped = body!.slice(0, -1) + (body!.endsWith("A") ? "B" : "A");

    expect(() =>
      cipher.decrypt([version, iv, tag, flipped].join(".")),
    ).toThrow();
  });

  it("refuses a ciphertext from a different key", () => {
    const encrypted = new TokenCipher("a-different-secret").encrypt("ghu_x");

    expect(() => cipher.decrypt(encrypted)).toThrow();
  });

  // No plaintext fallback: anything this cipher didn't write is rejected, so
  // a row an attacker could write is never read back as a usable token.
  it("refuses a plaintext token instead of passing it through", () => {
    expect(() => cipher.decrypt("ghu_written_before_encryption")).toThrow();
    expect(cipher.isEncrypted("ghu_written_before_encryption")).toBe(false);
  });

  it("marks its own output as encrypted", () => {
    expect(cipher.isEncrypted(cipher.encrypt("ghu_x"))).toBe(true);
  });

  it("handles an empty token and a long one", () => {
    expect(cipher.decrypt(cipher.encrypt(""))).toBe("");
    const long = "g".repeat(4096);
    expect(cipher.decrypt(cipher.encrypt(long))).toBe(long);
  });

  it("rejects an empty secret rather than deriving a guessable key", () => {
    expect(() => new TokenCipher("")).toThrow();
  });
});
