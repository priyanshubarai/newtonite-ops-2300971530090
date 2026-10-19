import jwt from "jsonwebtoken";
import type { Algorithm } from "jsonwebtoken";
import { env } from "../config/env.js";

/**
 * Auth tokens are signed HS256 JWTs carrying only the user's
 * subject id. Roles and memberships are deliberately NOT embedded here - they
 * are loaded from the database on every request so that role changes and
 * membership revocations take effect immediately rather than waiting for a
 * token to expire. Token lifetime is configurable via JWT_EXPIRES_IN (default 24h).
 */

// Pin the allowed algorithm so a token signed with `none` or a different
// asymmetric algorithm can never be accepted (algorithm-confusion defence).
const ALLOWED_ALGORITHMS: Algorithm[] = ["HS256"];

export interface TokenPayload {
  sub: string;
}

/** Issue a signed token whose `sub` claim is the user's UUID. */
export function signAuthToken(userId: string): string {
  const payload: TokenPayload = { sub: userId };
  return jwt.sign(payload, env.JWT_SECRET, {
    algorithm: "HS256",
    expiresIn: env.JWT_EXPIRES_IN,
    issuer: "newtonite",
    audience: "newtonite-api",
  });
}

/**
 * Verify a token's signature, algorithm, issuer, audience, and expiration.
 * Returns the subject (user id) on success, or `null` on any failure. Never
 * throws - callers map a `null` result to a 401.
 */
export function verifyAuthToken(token: string): string | null {
  try {
    const decoded = jwt.verify(token, env.JWT_SECRET, {
      algorithms: ALLOWED_ALGORITHMS,
      issuer: "newtonite",
      audience: "newtonite-api",
    });

    // `jwt.verify` can return a string if the token payload was a bare string.
    if (typeof decoded === "string") return null;

    const sub = decoded.sub;
    if (typeof sub !== "string" || sub.length === 0) return null;
    return sub;
  } catch {
    // Covers expiry, bad signature, wrong algorithm, malformed token.
    return null;
  }
}
