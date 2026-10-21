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

/** Read the token from localStorage. */
function readStoredToken(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    // localStorage may be unavailable (private browsing, disabled, etc.)
    return null;
  }
}

/**
 * The in-memory token, hydrated from localStorage *synchronously at module
 * load*.
 *
 * This ordering matters. The route guard decides between "redirect to /login"
 * and "render the app" during render, and `useSyncExternalStore` reads this
 * value on the very first render. If hydration happened later (e.g. in a
 * `useEffect`), the first render of a reloaded page would report "no token",
 * `RequireAuth` would redirect a perfectly valid session to /login, and only
 * the next render would send the user back. That produced a visible login flash
 * on every hard page load. Reading storage here means a reload with a stored
 * token is authenticated from the first paint.
 *
 * `readStoredToken` is total (it catches storage failures and returns null), so
 * this cannot throw during module evaluation.
 */
let token: string | null = readStoredToken();
const listeners = new Set<() => void>();

/**
 * Re-read the token from localStorage.
 *
 * Kept as a no-op-on-match reconciliation step: storage can change outside this
 * module (another tab, or a test manipulating localStorage directly), and
 * calling this resyncs the in-memory value.
 */
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
