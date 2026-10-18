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
import { clearToken, getToken, setToken, subscribeToken } from "./tokenStore";

/**
 * Session state for the whole app.
 *
 * The token itself lives in `tokenStore` (in-memory only). This provider
 * derives the current user + memberships from `GET /auth/me` whenever a token
 * is present, and wires the API client's 401 handler to drop the session so an
 * expired token sends the user back to the login screen.
 */

export type SessionStatus = "anonymous" | "loading" | "authenticated" | "error";

export interface AuthContextValue {
  status: SessionStatus;
  user: AuthUser | null;
  memberships: Membership[];
  /** Store a token obtained from `/auth/login`. */
  signIn: (token: string) => void;
  /** Clear client-held session state. */
  signOut: () => void;
  /** Retry loading the session after a transient failure. */
  reloadSession: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const token = useSyncExternalStore(subscribeToken, getToken, getToken);
  const queryClient = useQueryClient();

  // Any authenticated request answered with 401 means the session is no longer
  // valid: clear the token and drop cached server state.
  useEffect(() => {
    setUnauthorizedHandler(() => {
      clearToken();
      queryClient.clear();
    });
    return () => setUnauthorizedHandler(null);
  }, [queryClient]);

  const meQuery = useQuery({
    queryKey: ["me"],
    queryFn: ({ signal }) => fetchMe(signal),
    enabled: token !== null,
    retry: false,
    staleTime: 30_000,
  });

  const { isPending, isError, data, refetch } = meQuery;

  const signIn = useCallback((next: string) => {
    setToken(next);
  }, []);

  const signOut = useCallback(() => {
    clearToken();
    queryClient.clear();
  }, [queryClient]);

  const reloadSession = useCallback(() => {
    void refetch();
  }, [refetch]);

  const value = useMemo<AuthContextValue>(() => {
    let status: SessionStatus;
    if (!token) status = "anonymous";
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
  }, [token, isPending, isError, data, signIn, signOut, reloadSession]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
