import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { ROLE_LABELS } from "../lib/constants";
import { useState } from "react";

interface NavItem {
  to: string;
  label: string;
  icon?: React.ReactNode;
}

interface TeamNavSectionProps {
  memberships: Array<{ teamId: string; teamName: string; role: string }>;
}

function TeamNavSection({ memberships }: TeamNavSectionProps) {
  const location = useLocation();
  const [expandedTeams, setExpandedTeams] = useState<Set<string>>(new Set());

  const toggleTeam = (teamId: string) => {
    setExpandedTeams((prev) => {
      const next = new Set(prev);
      if (next.has(teamId)) {
        next.delete(teamId);
      } else {
        next.add(teamId);
      }
      return next;
    });
  };

  const teamItems = memberships.map((m) => ({
    teamId: m.teamId,
    teamName: m.teamName,
    role: m.role,
    roleLabel: ROLE_LABELS[m.role],
    isActive: location.pathname.startsWith(`/teams/${m.teamId}`),
    isExpanded: expandedTeams.has(m.teamId),
  }));

  if (teamItems.length === 0) {
    return null;
  }

  return (
    <nav className="sidebar-section" aria-label="Teams">
      <div className="sidebar-section__header">
        <h3 className="sidebar-section__title">Teams</h3>
      </div>
      <ul className="sidebar-nav" role="list">
        {teamItems.map((team) => (
          <li key={team.teamId} className="sidebar-team">
            <button
              type="button"
              className={`sidebar-team__toggle ${team.isExpanded ? "sidebar-team__toggle--expanded" : ""}`}
              onClick={() => toggleTeam(team.teamId)}
              aria-expanded={team.isExpanded}
              aria-controls={`team-${team.teamId}-subnav`}
              aria-label={`${team.isExpanded ? "Collapse" : "Expand"} ${team.teamName}`}
            >
              <span className="sidebar-team__name">{team.teamName}</span>
              <span className="sidebar-team__role">{team.roleLabel}</span>
              <svg className="sidebar-team__chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>
            <ul id={`team-${team.teamId}-subnav`} className={`sidebar-subnav ${team.isExpanded ? "sidebar-subnav--open" : ""}`} role="list">
              <li>
                <NavLink
                  to={`/teams/${team.teamId}`}
                  className={({ isActive }) =>
                    `sidebar-subnav__link ${isActive && team.isActive ? "sidebar-subnav__link--active" : ""}`
                  }
                >
                  <svg className="sidebar-subnav__icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                    <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                    <line x1="9" y1="9" x2="15" y2="15" />
                    <line x1="15" y1="9" x2="9" y2="15" />
                  </svg>
                  All items
                </NavLink>
              </li>
              <li>
                <NavLink
                  to={`/teams/${team.teamId}`}
                  className={({ isActive }) =>
                    `sidebar-subnav__link ${isActive && team.isActive ? "sidebar-subnav__link--active" : ""}`
                  }
                  onClick={() => window.location.href = `/teams/${team.teamId}?preset=assigned`}
                >
                  <svg className="sidebar-subnav__icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                    <circle cx="12" cy="7" r="4" />
                  </svg>
                  Assigned to me
                </NavLink>
              </li>
              <li>
                <NavLink
                  to={`/teams/${team.teamId}`}
                  className={({ isActive }) =>
                    `sidebar-subnav__link ${isActive && team.isActive ? "sidebar-subnav__link--active" : ""}`
                  }
                  onClick={() => window.location.href = `/teams/${team.teamId}?preset=unassigned_urgent`}
                >
                  <svg className="sidebar-subnav__icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                    <line x1="12" y1="9" x2="12" y2="13" />
                    <line x1="12" y1="17" x2="12.01" y2="17" />
                  </svg>
                  Unassigned urgent
                </NavLink>
              </li>
              {["LEAD", "ADMIN"].includes(team.role) && (
                <li>
                  <NavLink
                    to={`/teams/${team.teamId}`}
                    className={({ isActive }) =>
                      `sidebar-subnav__link ${isActive && team.isActive ? "sidebar-subnav__link--active" : ""}`
                    }
                    onClick={() => window.location.href = `/teams/${team.teamId}?preset=awaiting_approval`}
                  >
                    <svg className="sidebar-subnav__icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                      <polyline points="22 4 12 14.01 9 11.01" />
                    </svg>
                    Awaiting approval
                  </NavLink>
                </li>
              )}
            </ul>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export function AppShell() {
  const { user, memberships, signOut } = useAuth();
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const mainNavItems: NavItem[] = [
    { to: "/overview", label: "Overview", icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <rect x="3" y="3" width="7" height="7" rx="1" />
        <rect x="14" y="3" width="7" height="7" rx="1" />
        <rect x="3" y="14" width="7" height="7" rx="1" />
        <rect x="14" y="14" width="7" height="7" rx="1" />
      </svg>
    ) },
    { to: "/assigned", label: "My work", icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
        <circle cx="12" cy="7" r="4" />
      </svg>
    ) },
    { to: "/attention", label: "Needs attention", icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
        <line x1="12" y1="9" x2="12" y2="13" />
        <line x1="12" y1="17" x2="12.01" y2="17" />
      </svg>
    ) },
    { to: "/approval", label: "Awaiting approval", icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
        <polyline points="22 4 12 14.01 9 11.01" />
      </svg>
    ) },
    { to: "/items", label: "All work items", icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
        <line x1="9" y1="9" x2="15" y2="15" />
        <line x1="15" y1="9" x2="9" y2="15" />
      </svg>
    ) },
  ];

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>

      {sidebarOpen && (
        <div className="app-sidebar-overlay" onClick={() => setSidebarOpen(false)} aria-hidden="true" />
      )}

      <aside className={`app-sidebar ${sidebarOpen ? "app-sidebar--open" : ""}`} aria-label="Main navigation">
        <div className="app-sidebar__inner">
          <div className="app-sidebar__header">
            <Link to="/overview" className="app-sidebar__brand">
              Newtonite <span className="app-sidebar__brand-sub">Operations</span>
            </Link>
            <button
              type="button"
              className="app-sidebar__close"
              onClick={() => setSidebarOpen(false)}
              aria-label="Close navigation"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>

          <nav className="sidebar-nav-main" aria-label="Main navigation">
            <ul className="sidebar-nav" role="list">
              {mainNavItems.map((item) => (
                <li key={item.to}>
                  <NavLink
                    to={item.to}
                    className={({ isActive }) =>
                      `sidebar-nav__link ${isActive ? "sidebar-nav__link--active" : ""}`
                    }
                    onClick={() => setSidebarOpen(false)}
                  >
                    {item.icon && <span className="sidebar-nav__icon" aria-hidden="true">{item.icon}</span>}
                    <span className="sidebar-nav__label">{item.label}</span>
                  </NavLink>
                </li>
              ))}
            </ul>
          </nav>

          <TeamNavSection memberships={memberships} />
        </div>
      </aside>

      <header className="app-header">
        <div className="app-header__inner">
          <button
            type="button"
            className="app-header__menu"
            onClick={() => setSidebarOpen(true)}
            aria-label="Open navigation"
            aria-expanded={sidebarOpen}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <line x1="3" y1="6" x2="21" y2="6" />
              <line x1="3" y1="12" x2="21" y2="12" />
              <line x1="3" y1="18" x2="21" y2="18" />
            </svg>
          </button>

          <Link to="/overview" className="app-header__brand">
            Newtonite <span className="app-header__brand-sub">Operations</span>
          </Link>

          <div className="app-header__search" role="search">
            <label htmlFor="global-search" className="visually-hidden">Search work items</label>
            <svg className="app-header__search-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              type="search"
              id="global-search"
              className="app-header__search-input"
              placeholder="Search work items…"
              onClick={() => window.location.href = "/items"}
              readOnly
            />
          </div>

          <div className="app-header__actions">
            {memberships.some((m) => ["MEMBER", "LEAD", "ADMIN"].includes(m.role)) && (
              <Link to="/items/new" className="button button--primary app-header__new-item">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
                New work item
              </Link>
            )}

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
        </div>

        </header>

      <main id="main-content" className="app-main">
        <Outlet />
      </main>
    </div>
  );
}