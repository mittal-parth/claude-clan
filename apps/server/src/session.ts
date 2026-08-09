import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from "node:crypto";

export interface GitHubTokens {
  accessToken: string;
  refreshToken?: string;
  /** ISO timestamp; GitHub App user tokens expire in 8h. */
  expiresAt: string;
  /** ISO timestamp; absent when the App hasn't opted into token expiry. */
  refreshTokenExpiresAt?: string;
}

export interface Session {
  userId: number;
  login: string;
  avatarUrl: string;
  tokens: GitHubTokens;
  issuedAt: string;
  expiresAt: string;
}

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;

/**
 * No server-side session store at all: the token itself is the only place
 * this state lives, so it survives a Render restart and would survive
 * multiple instances without any shared cache. SESSION_SECRET must be
 * exactly 32 bytes once decoded -- AES-256 has no shorter/longer key.
 */
export function deriveSessionKey(secret: string): Buffer {
  const key = Buffer.from(secret, "base64url");
  if (key.length !== 32) {
    throw new Error(
      `SESSION_SECRET must decode to 32 bytes (got ${key.length}); generate one with "openssl rand -base64url 32"`,
    );
  }
  return key;
}

export function sealSession(session: Session, key: Buffer): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const plaintext = Buffer.from(JSON.stringify(session), "utf8");
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, ciphertext]).toString("base64url");
}

function isSession(value: unknown): value is Session {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  if (
    typeof record.userId !== "number" ||
    typeof record.login !== "string" ||
    typeof record.avatarUrl !== "string" ||
    typeof record.issuedAt !== "string" ||
    typeof record.expiresAt !== "string" ||
    typeof record.tokens !== "object" ||
    record.tokens === null
  ) {
    return false;
  }
  const tokens = record.tokens as Record<string, unknown>;
  return (
    typeof tokens.accessToken === "string" &&
    typeof tokens.expiresAt === "string"
  );
}

/**
 * Returns undefined on any failure to open (tampered token, wrong key,
 * malformed payload) or on an expired session -- callers always treat this
 * as "not authenticated", never distinguishing why.
 */
export function openSession(
  token: string,
  key: Buffer,
  now: Date,
): Session | undefined {
  let raw: Buffer;
  try {
    raw = Buffer.from(token, "base64url");
  } catch {
    return undefined;
  }
  if (raw.length < IV_LENGTH + 16) {
    return undefined;
  }

  const iv = raw.subarray(0, IV_LENGTH);
  const authTag = raw.subarray(IV_LENGTH, IV_LENGTH + 16);
  const ciphertext = raw.subarray(IV_LENGTH + 16);

  try {
    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);
    const plaintext = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]);
    const parsed: unknown = JSON.parse(plaintext.toString("utf8"));
    if (!isSession(parsed)) {
      return undefined;
    }
    if (new Date(parsed.expiresAt).getTime() <= now.getTime()) {
      return undefined;
    }
    return parsed;
  } catch {
    return undefined;
  }
}
