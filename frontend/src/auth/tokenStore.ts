/**
 * In-memory bearer-token store.
 *
 * The approved design does not call for persistent browser storage of
 * credentials, so the token lives only in this module for the lifetime of the
 * page. Consequences (documented as a known limitation):
 * - a full page reload signs the user out;
 * - logout is therefore purely client-side (the backend issues stateless JWTs
 *   and exposes no revocation endpoint), and only this client-held state is
 *   cleared.
 *
 * A tiny external store keeps React in sync without pulling in a state library.
 */

let token: string | null = null;
const listeners = new Set<() => void>();

export function getToken(): string | null {
  return token;
}

export function setToken(next: string | null): void {
  if (next === token) return;
  token = next;
  for (const listener of listeners) listener();
}

export function clearToken(): void {
  setToken(null);
}

/** Subscribe to token changes. Returns an unsubscribe function. */
export function subscribeToken(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
