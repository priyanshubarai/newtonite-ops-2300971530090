import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { ROLE_LABELS } from '../lib/constants';
import { useEffect, useRef, useState } from 'react';
import { useToast } from './ui/Toast';
import { useDebouncedValue } from '../lib/useDebouncedValue';
import { SidebarProfile } from './SidebarProfile';

interface NavItem {
  to: string;
  label: string;
  icon: React.ReactNode;
}

interface TeamNavSectionProps {
  memberships: Array<{ teamId: string; teamName: string; role: string }>;
  /** Icon-only mode: team names move into tooltips/accessible names. */
  collapsed?: boolean;
}

function TeamNavSection({ memberships, collapsed = false }: TeamNavSectionProps) {
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
    roleLabel: ROLE_LABELS[m.role as keyof typeof ROLE_LABELS],
    isActive: location.pathname.startsWith('/teams/'),
    isExpanded: expandedTeams.has(m.teamId),
  }));

  if (teamItems.length === 0) {
    return null;
  }

  return (
    <nav className={'sidebar-section' + (collapsed ? ' sidebar-section--collapsed' : '')} aria-label='Teams'>
      {!collapsed && (
        <div className='sidebar-section__header'>
          <h3 className='sidebar-section__title'>Teams</h3>
        </div>
      )}
      <ul className='sidebar-nav' role='list'>
        {teamItems.map((team) => (
          <li key={team.teamId} className='sidebar-team'>
            <button
              type='button'
              className={'sidebar-team__toggle ' + (team.isExpanded ? 'sidebar-team__toggle--expanded' : '')}
              onClick={() => toggleTeam(team.teamId)}
              aria-expanded={team.isExpanded}
              aria-controls={'team-' + team.teamId + '-subnav'}
              aria-label={team.isExpanded ? 'Collapse ' + team.teamName : 'Expand ' + team.teamName}
              /* Icon-only when collapsed: the team name is the only label, so it
                 must stay reachable by pointer and by screen reader. */
              title={collapsed ? team.teamName + ' (' + team.roleLabel + ')' : undefined}
            >
              {collapsed ? (
                <span className='sidebar-team__mark' aria-hidden='true'>
                  {team.teamName.slice(0, 1).toUpperCase()}
                </span>
              ) : (
                <>
                  <span className='sidebar-team__name'>{team.teamName}</span>
                  <span className='sidebar-team__role'>{team.roleLabel}</span>
                </>
              )}
              {!collapsed && (
                <svg
                  className='sidebar-team__chevron'
                  width='16'
                  height='16'
                  viewBox='0 0 24 24'
                  fill='none'
                  stroke='currentColor'
                  strokeWidth='2'
                  aria-hidden='true'
                  style={{ transform: team.isExpanded ? 'rotate(180deg)' : 'rotate(0deg)' }}
                >
                  <polyline points='6 9 12 15 18 9' />
                </svg>
              )}
            </button>
            <ul
              id={'team-' + team.teamId + '-subnav'}
              className={'sidebar-subnav ' + (team.isExpanded ? 'sidebar-subnav--open' : '')}
              role='list'
              hidden={!team.isExpanded}
            >
                <li>
                  <NavLink
                    to={'/teams/' + team.teamId}
                    className={({ isActive }) =>
                      'sidebar-subnav__link ' + (isActive && team.isActive ? 'sidebar-subnav__link--active' : '')}
                  >
                    <svg className='sidebar-subnav__icon' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2' aria-hidden='true'>
                      <rect x='3' y='3' width='18' height='18' rx='2' ry='2' />
                      <line x1='9' y1='9' x2='15' y2='15' />
                      <line x1='15' y1='9' x2='9' y2='15' />
                    </svg>
                    All items
                  </NavLink>
                </li>
                <li>
                  <NavLink
                    to={'/teams/' + team.teamId + '?preset=assigned'}
                    className={({ isActive }) =>
                      'sidebar-subnav__link ' + (isActive && team.isActive ? 'sidebar-subnav__link--active' : '')}
                  >
                    <svg className='sidebar-subnav__icon' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2' aria-hidden='true'>
                      <path d='M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2' />
                      <circle cx='12' cy='7' r='4' />
                    </svg>
                    Assigned to me
                  </NavLink>
                </li>
                <li>
                  <NavLink
                    to={'/teams/' + team.teamId + '?preset=unassigned_urgent'}
                    className={({ isActive }) =>
                      'sidebar-subnav__link ' + (isActive && team.isActive ? 'sidebar-subnav__link--active' : '')}
                  >
                    <svg className='sidebar-subnav__icon' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2' aria-hidden='true'>
                      <path d='M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z' />
                      <line x1='12' y1='9' x2='12' y2='13' />
                      <line x1='12' y1='17' x2='12.01' y2='17' />
                    </svg>
                    Unassigned urgent
                  </NavLink>
                </li>
                {['LEAD', 'ADMIN'].includes(team.role) && (
                  <li>
                    <NavLink
                      to={'/teams/' + team.teamId + '?preset=awaiting_approval'}
                      className={({ isActive }) =>
                        'sidebar-subnav__link ' + (isActive && team.isActive ? 'sidebar-subnav__link--active' : '')}
                    >
                      <svg className='sidebar-subnav__icon' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2' aria-hidden='true'>
                        <path d='M22 11.08V12a10 10 0 1 1-5.93-9.14' />
                        <polyline points='22 4 12 14.01 9 11.01' />
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
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const { addToast } = useToast();
  const navigate = useNavigate();
  const location = useLocation();

  // Global search: the header field is a real input that routes to the work-item
  // list with the query in the URL, where the existing server-side search and its
  // loading / empty / error states already live. Keeping it in the URL means the
  // result set is shareable and the page owns the request, so the header holds no
  // fetched data and cannot go stale.
  const [searchText, setSearchText] = useState('');

  // The query the URL had the last time *this component* wrote it. Typing flows
  // field -> debounce -> URL, so the URL changing is normally our own echo. We
  // must not feed that echo back into the field (it would fight the user's
  // keystrokes, drop characters, and can oscillate), so the sync below only
  // adopts a URL query that we did not just write ourselves.
  const lastWrittenSearch = useRef<string | null>(null);

  const urlSearch = new URLSearchParams(location.search).get('search') ?? '';

  // Adopt the URL's query when it changes for a reason other than our own write:
  // first mount, a browser back/forward, or an incoming deep link such as
  // /items?search=… . This keeps the header honest about what is being filtered
  // without ever overwriting what the user is currently typing.
  useEffect(() => {
    if (lastWrittenSearch.current === urlSearch) return;
    lastWrittenSearch.current = urlSearch;
    setSearchText(urlSearch);
  }, [urlSearch]);

  const debouncedSearch = useDebouncedValue(searchText, 300);

  // Push the debounced query into the URL while the user is on the list page, so
  // typing filters as they go. Off the list page we wait for an explicit submit,
  // otherwise a stray keystroke would navigate them away from what they are doing.
  useEffect(() => {
    if (location.pathname !== '/items') return;
    const current = new URLSearchParams(location.search).get('search') ?? '';
    const next = debouncedSearch.trim();
    if (current === next) return;
    const params = new URLSearchParams(location.search);
    if (next) params.set('search', next);
    else params.delete('search');
    // A new query is a new result set, so start at the first page.
    params.delete('page');
    // Record what we are about to write so the sync effect treats the resulting
    // URL change as our own echo rather than an external edit.
    lastWrittenSearch.current = next;
    navigate({ pathname: '/items', search: params.toString() }, { replace: true });
  }, [debouncedSearch, location.pathname, location.search, navigate]);

  const handleSearchSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    // A real submit handler: without it the browser would perform a native form
    // submission and reload the whole app.
    event.preventDefault();
    const query = searchText.trim();
    lastWrittenSearch.current = query;
    navigate(query ? `/items?search=${encodeURIComponent(query)}` : '/items');
  };

  const mainNavItems: NavItem[] = [
    { to: '/overview', label: 'Overview', icon: <LayoutDashboardIcon /> },
    { to: '/assigned', label: 'My work', icon: <UserIcon /> },
    { to: '/attention', label: 'Needs attention', icon: <FlagIcon /> },
    { to: '/approval', label: 'Awaiting approval', icon: <ClockIcon /> },
    { to: '/items', label: 'All work items', icon: <FileTextIcon /> },
  ];

  const handleSignOut = () => {
    signOut();
    addToast({ title: 'Signed out', message: 'You have been signed out successfully', type: 'success' });
  };

  return (
    <div className={`app-shell${sidebarCollapsed ? ' app-shell--collapsed' : ''}`}>
      <a className='skip-link' href='#main-content'>
        Skip to main content
      </a>

      {sidebarOpen && (
        /* A real button, not a decorative div: it is the dismiss affordance for
           the mobile drawer, so it must be reachable by keyboard and named for
           assistive technology. `aria-hidden` on a clickable element leaves
           screen-reader users with no way to dismiss the drawer. */
        <button
          type='button'
          className='app-sidebar-overlay app-sidebar-overlay--visible'
          onClick={() => setSidebarOpen(false)}
          aria-label='Close navigation'
          data-testid='sidebar-overlay'
        />
      )}

      <aside
        className={'app-sidebar ' + (sidebarOpen ? 'app-sidebar--open' : '') + ' ' + (sidebarCollapsed ? 'app-sidebar--collapsed' : '')}
        aria-label='Main navigation'
        style={{ width: sidebarCollapsed ? 64 : 280 }}
      >
        {/* Sidebar header: brand on the left, collapse control on the right.
            The collapse button used to float at the bottom of the sidebar; it
            belongs with the branding it toggles. */}
        <div className='app-sidebar__header'>
          <Link
            to='/overview'
            className={'app-sidebar__brand' + (sidebarCollapsed ? ' app-sidebar__brand--mark' : '')}
            aria-label='Newtonite Operations'
            title={sidebarCollapsed ? 'Newtonite Operations' : undefined}
          >
            {sidebarCollapsed ? (
              <BrandMark />
            ) : (
              <>
                Newtonite <span className='app-sidebar__brand-sub'>Operations</span>
              </>
            )}
          </Link>

          <div className='app-sidebar__header-actions'>
            {/* Only meaningful while the sidebar is a drawer (<=1024px); CSS
                removes it above that breakpoint. */}
            <button
              type='button'
              className='app-sidebar__close'
              onClick={() => setSidebarOpen(false)}
              aria-label='Close navigation menu'
            >
              <XIcon width='20' height='20' aria-hidden='true' />
            </button>

            <button
              type='button'
              className='app-sidebar__collapse'
              onClick={() => setSidebarCollapsed((collapsed) => !collapsed)}
              aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              aria-expanded={!sidebarCollapsed}
              title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            >
              <PanelCollapseIcon
                width='20'
                height='20'
                aria-hidden='true'
                style={{ transform: sidebarCollapsed ? 'rotate(180deg)' : undefined }}
              />
            </button>
          </div>
        </div>

        {/* Middle region scrolls on its own so the header and the profile stay
            pinned no matter how many teams/nav rows are rendered. */}
        <div className='app-sidebar__scroll'>
          <nav className='sidebar-nav-main' aria-label='Main navigation'>
            <ul className='sidebar-nav' role='list'>
              {mainNavItems.map((item) => (
                <li key={item.to}>
                  <NavLink
                    to={item.to}
                    className={({ isActive }) =>
                      'sidebar-nav__link ' + (isActive ? 'sidebar-nav__link--active' : '')}
                    onClick={() => setSidebarOpen(false)}
                    title={sidebarCollapsed ? item.label : undefined}
                  >
                    <span className='sidebar-nav__icon' aria-hidden='true'>
                      {item.icon}
                    </span>
                    <span className='sidebar-nav__label'>{item.label}</span>
                  </NavLink>
                </li>
              ))}
            </ul>
          </nav>

          <TeamNavSection memberships={memberships} collapsed={sidebarCollapsed} />
        </div>

        <SidebarProfile
          user={user}
          collapsed={sidebarCollapsed}
          onSignOut={handleSignOut}
        />
      </aside>

      <header className='app-header'>
        <div className='app-header__inner'>
          <button
            type='button'
            className='app-header__menu'
            onClick={() => setSidebarOpen(true)}
            aria-label='Open navigation'
            aria-expanded={sidebarOpen}
          >
            <MenuIcon width='20' height='20' />
          </button>

          <Link to='/overview' className='app-header__brand'>
            Newtonite <span className='app-header__brand-sub'>Operations</span>
          </Link>

          <form className='app-header__search' role='search' onSubmit={handleSearchSubmit}>
            <label htmlFor='global-search' className='visually-hidden'>Search work items</label>
            <MagnifyingGlassIcon className='app-header__search-icon' width='18' height='18' />
            <input
              type='search'
              id='global-search'
              className='app-header__search-input'
              placeholder='Search work items...'
              value={searchText}
              onChange={(event) => setSearchText(event.target.value)}
              autoComplete='off'
            />
          </form>

          <div className='app-header__actions'>
            {memberships.some((m) => ['MEMBER', 'LEAD', 'ADMIN'].includes(m.role)) && (
              <Link to='/items/new' className='button button--primary app-header__new-item'>
                <PlusIcon width='16' height='16' className='button__icon' />
                <span className='button__label'>New work item</span>
              </Link>
            )}
          </div>
        </div>
      </header>

      <main id='main-content' className='app-main'>
        {/* No `.page` wrapper here: every page renders its own. Nesting them
            made the inner one shrink-to-fit inside the grid, so content was
            narrower than the padding box and misaligned with the header. */}
        <Outlet />
      </main>
    </div>
  );
}
function LayoutDashboardIcon({ ...props }: React.SVGProps<SVGSVGElement>) {
  return (
    <svg width='20' height='20' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2' strokeLinecap='round' strokeLinejoin='round' {...props}>
      <rect x='3' y='3' width='7' height='7' rx='1' />
      <rect x='14' y='3' width='7' height='7' rx='1' />
      <rect x='3' y='14' width='7' height='7' rx='1' />
      <rect x='14' y='14' width='7' height='7' rx='1' />
    </svg>
  );
}

function UserIcon({ ...props }: React.SVGProps<SVGSVGElement>) {
  return (
    <svg width='20' height='20' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2' strokeLinecap='round' strokeLinejoin='round' {...props}>
      <path d='M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2' />
      <circle cx='12' cy='7' r='4' />
    </svg>
  );
}

function FlagIcon({ ...props }: React.SVGProps<SVGSVGElement>) {
  return (
    <svg width='20' height='20' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2' strokeLinecap='round' strokeLinejoin='round' {...props}>
      <path d='M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z' />
      <line x1='12' y1='9' x2='12' y2='13' />
      <line x1='12' y1='17' x2='12.01' y2='17' />
    </svg>
  );
}

function ClockIcon({ ...props }: React.SVGProps<SVGSVGElement>) {
  return (
    <svg width='20' height='20' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2' strokeLinecap='round' strokeLinejoin='round' {...props}>
      <circle cx='12' cy='12' r='10' />
      <polyline points='12 6 12 12 16 14' />
    </svg>
  );
}

function FileTextIcon({ ...props }: React.SVGProps<SVGSVGElement>) {
  return (
    <svg width='20' height='20' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2' strokeLinecap='round' strokeLinejoin='round' {...props}>
      <path d='M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z' />
      <polyline points='14 2 14 8 20 8' />
      <line x1='16' y1='13' x2='8' y2='13' />
      <line x1='16' y1='17' x2='8' y2='17' />
      <line x1='10' y1='9' x2='8' y2='9' />
    </svg>
  );
}

/**
 * Compact brand mark for the collapsed sidebar. Drawn from the project's own
 * visual system (a rounded square on `--color-primary` with an "N" glyph)
 * so collapsing never needs a third-party or ad-hoc logo asset.
 */
function BrandMark({ ...props }: React.SVGProps<SVGSVGElement>) {
  return (
    <svg width='28' height='28' viewBox='0 0 28 28' fill='none' aria-hidden='true' {...props}>
      <rect x='0.5' y='0.5' width='27' height='27' rx='8' fill='var(--color-primary)' />
      <path
        d='M9 19.5V8.5L19 19.5V8.5'
        stroke='var(--color-primary-contrast)'
        strokeWidth='2.25'
        strokeLinecap='round'
        strokeLinejoin='round'
      />
    </svg>
  );
}

function PanelCollapseIcon({ ...props }: React.SVGProps<SVGSVGElement>) {
  return (
    <svg width='20' height='20' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2' strokeLinecap='round' strokeLinejoin='round' {...props}>
      <rect x='3' y='4' width='18' height='16' rx='2' />
      <line x1='9' y1='4' x2='9' y2='20' />
      <polyline points='16.5 9.5 13 12 16.5 14.5' />
    </svg>
  );
}

function MenuIcon({ ...props }: React.SVGProps<SVGSVGElement>) {
  return (
    <svg width='20' height='20' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2' strokeLinecap='round' strokeLinejoin='round' {...props}>
      <line x1='3' y1='6' x2='21' y2='6' />
      <line x1='3' y1='12' x2='21' y2='12' />
      <line x1='3' y1='18' x2='21' y2='18' />
    </svg>
  );
}

function XIcon({ ...props }: React.SVGProps<SVGSVGElement>) {
  return (
    <svg width='20' height='20' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2' strokeLinecap='round' strokeLinejoin='round' {...props}>
      <line x1='18' y1='6' x2='6' y2='18' />
      <line x1='6' y1='6' x2='18' y2='18' />
    </svg>
  );
}

function MagnifyingGlassIcon({ ...props }: React.SVGProps<SVGSVGElement>) {
  return (
    <svg width='18' height='18' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2' strokeLinecap='round' strokeLinejoin='round' {...props}>
      <circle cx='11' cy='11' r='8' />
      <line x1='21' y1='21' x2='16.65' y2='16.65' />
    </svg>
  );
}

function PlusIcon({ ...props }: React.SVGProps<SVGSVGElement>) {
  return (
    <svg width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2' strokeLinecap='round' strokeLinejoin='round' {...props}>
      <line x1='12' y1='5' x2='12' y2='19' />
      <line x1='5' y1='12' x2='19' y2='12' />
    </svg>
  );
}
