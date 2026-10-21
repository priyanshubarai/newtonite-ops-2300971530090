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
 *
 * The token is hydrated from localStorage synchronously when `tokenStore` is
 * first evaluated, so a reload with a stored session is authenticated on the
 * very first render and never flashes the login screen.
 */
export function RequireAuth() {
  const { status, reloadSession, signOut } = useAuth();
  const location = useLocation();

  // Loading is checked BEFORE anonymous. The token is hydrated synchronously at
  // module load, so "anonymous" now only means "there is definitely no token" —
  // but keeping this order means a future change that introduces an async
  // hydration step cannot silently reintroduce the login flash on reload.
  if (status === "loading") {
    return <LoadingState message="Loading your workspace…" fullPage />;
  }

  if (status === "anonymous") {
    const from = `${location.pathname}${location.search}`;
    return <Navigate to="/login" replace state={{ from }} />;
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
