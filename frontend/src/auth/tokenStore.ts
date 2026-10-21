/**
 * Session state tracking (token is now in HttpOnly cookie).
 *
 * The token is stored in an HttpOnly cookie so it's not accessible via JavaScript.
 * This module now only tracks whether we have a valid session (for UI purposes),
 * not the actual token value.
 */

const SESSION_KEY = "newtonite_has_session";

/** Read the session flag from localStorage. */
function readSessionFlag(): boolean {
  try {
    return localStorage.getItem(SESSION_KEY) === "true";
  } catch {
    return false;
  }
}

/**
 * The in-memory session flag, hydrated from localStorage at module load.
 */
let hasSession: boolean = readSessionFlag();
const listeners = new Set<() => void>();

/**
 * Re-read the session flag from localStorage.
 */
export function initializeToken(): void {
  const stored = readSessionFlag();
  if (stored !== hasSession) {
    hasSession = stored;
    for (const listener of listeners) listener();
  }
}

export function hasValidSession(): boolean {
  return hasSession;
}

export function setSession(active: boolean): void {
  if (active === hasSession) return;
  hasSession = active;
  try {
    if (active) {
      localStorage.setItem(SESSION_KEY, "true");
    } else {
      localStorage.removeItem(SESSION_KEY);
    }
  } catch {
    // Ignore localStorage errors
  }
  for (const listener of listeners) listener();
}

export function clearSession(): void {
  setSession(false);
}

/** Subscribe to session changes. Returns an unsubscribe function. */
export function subscribeToken(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
