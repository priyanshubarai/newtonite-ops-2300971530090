/**
 * Persistent bearer-token store using localStorage.
 *
 * The token is stored in localStorage so it survives page reloads. This is
 * necessary for a usable authentication experience. Security considerations:
 * - The token is a short-lived JWT (default 24h) signed with HS256.
 * - localStorage is accessible via XSS; this is an accepted trade-off for the
 *   current architecture which uses stateless bearer tokens.
 * - On logout or confirmed expiry, the token is cleared from localStorage.
 * - A confirmed invalid/expired/revoked session is handled consistently.
 *
 * A tiny external store keeps React in sync without pulling in a state library.
 */

const STORAGE_KEY = "newtonite_auth_token";

let token: string | null = null;
const listeners = new Set<() => void>();

/** Read the token from localStorage on first load. */
function readStoredToken(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    // localStorage may be unavailable (private browsing, disabled, etc.)
    return null;
  }
}

/** Initialize in-memory token from localStorage. */
export function initializeToken(): void {
  const stored = readStoredToken();
  if (stored !== token) {
    token = stored;
    for (const listener of listeners) listener();
  }
}

export function getToken(): string | null {
  return token;
}

export function setToken(next: string | null): void {
  if (next === token) return;
  token = next;
  try {
    if (next === null) {
      localStorage.removeItem(STORAGE_KEY);
    } else {
      localStorage.setItem(STORAGE_KEY, next);
    }
  } catch {
    // Ignore localStorage errors (quota, private mode, etc.)
  }
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
