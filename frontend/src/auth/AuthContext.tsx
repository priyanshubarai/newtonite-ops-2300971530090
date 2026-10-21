import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchMe } from "../api/auth";
import { setUnauthorizedHandler } from "../api/client";
import type { AuthUser, Membership } from "../api/types";
import { clearSession, hasValidSession, initializeToken, setSession, subscribeToken } from "./tokenStore";

/**
 * Session state for the whole app.
 *
 * The token lives in an HttpOnly cookie (set by the backend). This provider
 * tracks whether we have a valid session via a localStorage flag and derives
 * the current user + memberships from `GET /auth/me` whenever a session flag
 * is present. The API client's 401 handler drops the session so an expired
 * token sends the user back to the login screen.
 */

export type SessionStatus = "anonymous" | "loading" | "authenticated" | "error";

export interface AuthContextValue {
  status: SessionStatus;
  user: AuthUser | null;
  memberships: Membership[];
  /** Mark the session as active (called after successful login). */
  signIn: () => void;
  /** Clear client-held session state. */
  signOut: () => void;
  /** Retry loading the session after a transient failure. */
  reloadSession: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const hasSession = useSyncExternalStore(subscribeToken, hasValidSession, hasValidSession);
  const queryClient = useQueryClient();

  // The session flag is hydrated synchronously by `tokenStore` at module load.
  useEffect(() => {
    initializeToken();
  }, []);

  // Any authenticated request answered with 401 means the session is no longer
  // valid: clear the session flag and drop cached server state.
  useEffect(() => {
    setUnauthorizedHandler(() => {
      clearSession();
      queryClient.clear();
    });
    return () => setUnauthorizedHandler(null);
  }, [queryClient]);

  const meQuery = useQuery({
    queryKey: ["me"],
    queryFn: ({ signal }) => fetchMe(signal),
    enabled: hasSession,
    retry: false,
    staleTime: 30_000,
  });

  const { isPending, isError, data, refetch } = meQuery;

  const signIn = useCallback(() => {
    setSession(true);
  }, []);

  const signOut = useCallback(() => {
    clearSession();
    queryClient.clear();
  }, [queryClient]);

  const reloadSession = useCallback(() => {
    void refetch();
  }, [refetch]);

  const value = useMemo<AuthContextValue>(() => {
    let status: SessionStatus;
    // Order matters. "anonymous" is a positive statement (there is definitely no
    // session), so it is decided only from `hasSession === false`. A session flag
    // being present but `/auth/me` still in flight is "loading", which the guard
    // renders as a loading state rather than a redirect — that is what stops a
    // valid session from being bounced to /login while its user is still being fetched.
    if (!hasSession) status = "anonymous";
    else if (isPending) status = "loading";
    else if (isError) status = "error";
    else status = "authenticated";

    return {
      status,
      user: data?.user ?? null,
      memberships: data?.memberships ?? [],
      signIn,
      signOut,
      reloadSession,
    };
  }, [hasSession, isPending, isError, data, signIn, signOut, reloadSession]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
