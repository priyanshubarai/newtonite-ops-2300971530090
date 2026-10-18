import { Link, NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { ROLE_LABELS } from "../lib/constants";

/**
 * Authenticated application shell: skip link, header, primary navigation, and
 * the signed-in identity with a client-side sign-out action.
 *
 * Navigation placeholders for future sections are included but disabled with
 * aria-disabled and visually hidden text, per the UI plan. They are not clickable
 * until the corresponding backend endpoints and pages exist.
 */
export function AppShell() {
  const { user, memberships, signOut } = useAuth();

  const navItems: Array<{
    to: string;
    label: string;
    disabled: boolean;
    description?: string;
  }> = [
    { to: "/items", label: "Work items", disabled: false },
    {
      to: "/overview",
      label: "Overview",
      disabled: true,
      description: "Operational dashboard (not yet implemented)",
    },
    {
      to: "/assigned",
      label: "Assigned to me",
      disabled: true,
      description: "Items assigned to you (not yet implemented)",
    },
    {
      to: "/attention",
      label: "Needs attention",
      disabled: true,
      description: "Urgent, unassigned, or awaiting-approval items (not yet implemented)",
    },
    {
      to: "/teams",
      label: "Teams",
      disabled: true,
      description: "Team selection and context (not yet implemented)",
    },
  ];

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>
      <header className="app-header">
        <div className="app-header__inner" data-testid="app-header-inner">
          <Link to="/items" className="app-header__brand">
            Newtonite <span className="app-header__brand-sub">Operations</span>
          </Link>

          <nav className="app-nav" aria-label="Primary">
            {navItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  [
                    "app-nav__link",
                    isActive && !item.disabled && "app-nav__link--active",
                    item.disabled && "app-nav__link--disabled",
                  ]
                    .filter(Boolean)
                    .join(" ")
                }
                aria-disabled={item.disabled}
                tabIndex={item.disabled ? -1 : undefined}
                onClick={(e) => {
                  if (item.disabled) e.preventDefault();
                }}
              >
                {item.label}
                {item.disabled && (
                  <>
                    <span className="visually-hidden"> (not yet implemented)</span>
                    <span className="app-nav__badge" aria-hidden="true">
                      Soon
                    </span>
                  </>
                )}
              </NavLink>
            ))}
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
