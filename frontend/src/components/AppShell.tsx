import { Link, NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { ROLE_LABELS } from "../lib/constants";

/**
 * Authenticated application shell: skip link, header, primary navigation, and
 * the signed-in identity with a client-side sign-out action.
 */
export function AppShell() {
  const { user, memberships, signOut } = useAuth();

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>
      <header className="app-header">
        <div className="app-header__inner">
          <Link to="/items" className="app-header__brand">
            Newtonite <span className="app-header__brand-sub">Operations</span>
          </Link>

          <nav className="app-nav" aria-label="Primary">
            <NavLink
              to="/items"
              className={({ isActive }) => (isActive ? "app-nav__link app-nav__link--active" : "app-nav__link")}
            >
              Work items
            </NavLink>
          </nav>

          <div className="app-header__user">
            <span className="app-header__identity">
              <span className="app-header__name">{user?.name ?? "Signed in"}</span>
              {user?.email && <span className="app-header__email">{user.email}</span>}
            </span>
            <button type="button" className="button button--ghost" onClick={signOut}>
              Sign out
            </button>
          </div>
        </div>

        {memberships.length > 0 && (
          <p className="app-header__teams">
            <span className="visually-hidden">Your team roles: </span>
            {memberships.map((m) => `${m.teamName} (${ROLE_LABELS[m.role]})`).join(" · ")}
          </p>
        )}
      </header>

      <main id="main-content" className="app-main">
        <Outlet />
      </main>
    </div>
  );
}
