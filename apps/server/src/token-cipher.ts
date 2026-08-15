import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
} from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;
const KEY_BYTES = 32;
/**
 * Prefix on every ciphertext, so a stored value can be told apart from a
 * legacy plaintext GitHub token without a schema column or a migration flag.
 * GitHub's tokens are `gh?_...`, so they can never collide with this.
 */
const VERSION = "v1";

/**
 * Encrypts the GitHub access and refresh tokens that back a session row.
 *
 * These are live credentials for a user's repositories, and until now they sat
 * in Postgres as readable text -- anyone with a SELECT on `sessions` (a leaked
 * connection string, a database backup, a support query) could act as any
 * signed-in user. Encrypting at rest means the database alone is not enough;
 * you also need the key, which lives only in the server's environment.
 *
 * AES-256-GCM rather than a plain cipher because it authenticates: a row
 * someone edited in the database fails to decrypt instead of silently
 * decrypting to something else.
 */
export class TokenCipher {
  private readonly key: Buffer;

  constructor(secret: string) {
    if (!secret) {
      throw new Error("TokenCipher requires a non-empty secret");
    }
    // The env var is an arbitrary-length passphrase, not 32 raw bytes. HKDF
    // stretches it to a proper key, and the `info` label keeps this key
    // distinct from anything else derived from the same secret later.
    this.key = Buffer.from(
      hkdfSync("sha256", secret, "sudo-city/token", "github-tokens", KEY_BYTES),
    );
  }

  encrypt(plaintext: string): string {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, this.key, iv);
    const ciphertext = Buffer.concat([
      cipher.update(plaintext, "utf8"),
      cipher.final(),
    ]);
    return [
      VERSION,
      iv.toString("base64url"),
      cipher.getAuthTag().toString("base64url"),
      ciphertext.toString("base64url"),
    ].join(".");
  }

  /**
   * Throws on anything this cipher didn't write -- a token from before
   * encryption, a row from a different key, an edited value. There is
   * deliberately no plaintext fallback: a silent passthrough would mean an
   * attacker who can write to the table can also choose what gets read back.
   * Callers treat the failure as an invalid session, so the user signs in
   * again and the row is replaced with an encrypted one.
   */
  decrypt(value: string): string {
    if (!this.isEncrypted(value)) {
      throw new Error("Token is not encrypted with this key");
    }
    const parts = value.split(".");
    const [, iv, authTag, ciphertext] = parts;
    // Checked for presence rather than truthiness: an empty string is a valid
    // ciphertext (it is what encrypting an empty token produces), while a
    // missing segment is a malformed row.
    if (parts.length !== 4 || !iv || !authTag || ciphertext === undefined) {
      throw new Error("Malformed encrypted token");
    }
    const decipher = createDecipheriv(
      ALGORITHM,
      this.key,
      Buffer.from(iv, "base64url"),
    );
    decipher.setAuthTag(Buffer.from(authTag, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertext, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  }

  isEncrypted(value: string): boolean {
    return value.startsWith(`${VERSION}.`);
  }
}
