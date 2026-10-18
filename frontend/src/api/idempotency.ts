import { useRef } from "react";

/**
 * Idempotency-key handling for mutations.
 *
 * The backend treats `Idempotency-Key` as scoped to (user, endpoint) and stores
 * a fingerprint of the request body. Replaying the *same* key with the *same*
 * body returns the original result; reusing the key with a *different* body is
 * rejected with 409 `IDEMPOTENCY_KEY_REUSED`.
 *
 * Rules the UI must therefore follow:
 * - generate a key per logical mutation, not per HTTP attempt;
 * - reuse that key when retrying the same request;
 * - generate a fresh key once the request body actually changes.
 *
 * `useStableIdempotencyKey` implements exactly that by keying the generated
 * value off a caller-supplied fingerprint (a stable serialisation of the body).
 */

/** Generate a new opaque idempotency key (UUID when available). */
export function newIdempotencyKey(): string {
  const cryptoObj = globalThis.crypto;
  if (cryptoObj && typeof cryptoObj.randomUUID === "function") {
    return cryptoObj.randomUUID();
  }
  // Fallback for environments without crypto.randomUUID.
  return `k-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

/**
 * Return a stable idempotency key for `fingerprint`, regenerating it whenever
 * the fingerprint changes. Retries of an unchanged request reuse the same key.
 */
export function useStableIdempotencyKey(fingerprint: string): string {
  const ref = useRef<{ fingerprint: string; key: string } | null>(null);
  if (ref.current === null || ref.current.fingerprint !== fingerprint) {
    ref.current = { fingerprint, key: newIdempotencyKey() };
  }
  return ref.current.key;
}
