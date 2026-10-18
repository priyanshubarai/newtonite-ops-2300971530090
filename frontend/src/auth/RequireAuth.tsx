import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "./AuthContext";
import { ErrorState, LoadingState } from "../components/StateViews";

/**
 * Route guard for the authenticated area.
 *
 * - no token            -> redirect to /login (remembering where we came from)
 * - token, /me loading  -> full-page loading state
 * - token, /me failed   -> recoverable error with retry (or sign out)
 * - authenticated       -> render the protected routes
 *
 * A 401 from `/auth/me` never reaches the "error" branch: the API client clears
 * the token first, which flips the state to "anonymous" and redirects.
 */
export function RequireAuth() {
  const { status, reloadSession, signOut } = useAuth();
  const location = useLocation();

  if (status === "anonymous") {
    const from = `${location.pathname}${location.search}`;
    return <Navigate to="/login" replace state={{ from }} />;
  }

  if (status === "loading") {
    return <LoadingState message="Loading your workspace…" fullPage />;
  }

  if (status === "error") {
    return (
      <ErrorState
        title="We couldn't load your session"
        message="There was a problem contacting the server. Check your connection and try again."
        onRetry={reloadSession}
        secondaryAction={{ label: "Sign out", onClick: signOut }}
        fullPage
      />
    );
  }

  return <Outlet />;
}
