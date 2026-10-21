import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { AuthUser } from '../api/types';

/**
 * Authenticated-user panel that lives at the bottom of the sidebar.
 *
 * Renders real session data (`user`) rather than a hardcoded identity. The
 * account popover is portalled to `document.body` on purpose: inside the
 * sidebar it inherited the sidebar's 280px/64px box, so at collapsed width the
 * menu was ~32px wide and wrapped every word onto its own line. A portal makes
 * the popover independent of the sidebar's width AND its containing block, so
 * it is neither squashed nor clipped by an ancestor's overflow.
 */

interface SidebarProfileProps {
  user: AuthUser | null;
  collapsed: boolean;
  onSignOut: () => void;
}

/** Popover width (px). Within the 240-300px range the design system calls for. */
const MENU_WIDTH = 280;
/** Minimum gap kept between the popover and the viewport edges, per side. */
const VIEWPORT_GUTTER = 8;
/** Gap between the trigger and the popover. */
const TRIGGER_GAP = 8;

/** "Avery Chen" -> "AC"; single word -> first letter; no name -> "?". */
function initialsOf(name: string | undefined | null): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const first = parts[0][0];
  const last = parts.length > 1 ? parts[parts.length - 1][0] : '';
  return (first + last).toUpperCase();
}

interface MenuPosition {
  top: number;
  left: number;
  /** Opens to the right of the trigger, or flipped to its left. */
  side: 'right' | 'left';
}

export function SidebarProfile({ user, collapsed, onSignOut }: SidebarProfileProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [position, setPosition] = useState<MenuPosition | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const sidebarRef = useRef<HTMLElement | null>(null);
  const menuId = useId();

  const displayName = user?.name ?? 'Signed in';
  const initials = initialsOf(user?.name);

  // Resolve the sidebar once on mount: it is this component's positioning
  // ancestor and is rendered by the shell, not passed down as a prop.
  useEffect(() => {
    sidebarRef.current = containerRef.current?.closest('aside.app-sidebar') as HTMLElement | null;
  }, []);

  /**
   * Place the popover next to the sidebar: prefer opening to the right of it,
   * flip left when that would leave the viewport, then clamp to the gutters.
   * Measured from live rects so it is correct at any viewport width and in both
   * sidebar states.
   */
  const reposition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;

    const rect = trigger.getBoundingClientRect();
    const menuHeight = menuRef.current?.offsetHeight ?? 0;
    const sidebar = sidebarRef.current;
    const sidebarRect = sidebar?.getBoundingClientRect();

    // `position: fixed` resolves against the viewport, but every value here is
    // taken from getBoundingClientRect() — the SAME space `fixed` uses — so the
    // two agree even when the page is scaled or the viewport tool resizes a
    // frame. Deriving the limits from those rects rather than only from
    // window.innerWidth keeps the flip correct in both spaces.
    const viewportWidth = Math.max(
      window.innerWidth,
      document.documentElement.clientWidth,
      rect.right,
    );
    const viewportHeight = Math.max(
      window.innerHeight,
      document.documentElement.clientHeight,
      rect.bottom,
    );

    // Anchor to the sidebar's right edge, not the trigger's: collapsed, the
    // avatar sits mid-rail, so anchoring to it would put the popover over the
    // rail. Falls back to the trigger when there is no sidebar ancestor.
    const anchorRight = sidebarRect ? Math.max(rect.right, sidebarRect.right) : rect.right;

    const fitsRight = anchorRight + TRIGGER_GAP + MENU_WIDTH <= viewportWidth - VIEWPORT_GUTTER;
    const side: MenuPosition['side'] = fitsRight ? 'right' : 'left';

    // Flip left: open to the LEFT of the sidebar (not the trigger) so the
    // popover never lands on top of the rail it belongs to.
    const leftEdge = sidebarRect ? Math.min(rect.left, sidebarRect.left) : rect.left;
    const preferredLeft = side === 'right' ? anchorRight + TRIGGER_GAP : leftEdge - TRIGGER_GAP - MENU_WIDTH;
    const maxLeft = Math.max(VIEWPORT_GUTTER, viewportWidth - MENU_WIDTH - VIEWPORT_GUTTER);
    const left = Math.max(VIEWPORT_GUTTER, Math.min(preferredLeft, maxLeft));

    // Bottom-align to the trigger (the profile is at the sidebar's foot), then
    // lift it if that would push the popover past the viewport bottom.
    const maxTop = Math.max(VIEWPORT_GUTTER, viewportHeight - menuHeight - VIEWPORT_GUTTER);
    const top = Math.max(VIEWPORT_GUTTER, Math.min(rect.bottom - menuHeight, maxTop));

    setPosition({ top, left, side });
  }, []);

  // Measure before paint so the first frame is already in place (no flicker at
  // 0,0), then keep it anchored. `resize` alone is not enough: the sidebar's
  // width animates (and the mobile drawer slides in) without a window resize, so
  // a ResizeObserver on the sidebar plus a short rAF settle pass covers both.
  useLayoutEffect(() => {
    if (!menuOpen) {
      setPosition(null);
      return;
    }
    reposition();

    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    window.visualViewport?.addEventListener('resize', reposition);

    // `ResizeObserver` is absent in some non-browser environments (jsdom, older
    // embedded webviews). Guard it: the window listeners and the rAF settle pass
    // below still keep the popover anchored where it is unavailable.
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(reposition) : null;
    observer?.observe(sidebarRef.current ?? triggerRef.current!);
    if (menuRef.current) observer?.observe(menuRef.current);

    // A short settle pass for transitions that do not emit either event.
    let frames = 0;
    let raf = requestAnimationFrame(function tick() {
      reposition();
      if (++frames < 30) raf = requestAnimationFrame(tick);
    });

    return () => {
      cancelAnimationFrame(raf);
      observer?.disconnect();
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
      window.visualViewport?.removeEventListener('resize', reposition);
    };
  }, [menuOpen, reposition]);

  // Escape closes the menu; so does a pointer press anywhere outside it.
  // Registered only while open so a closed menu costs no global listeners.
  useEffect(() => {
    if (!menuOpen) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMenuOpen(false);
        triggerRef.current?.focus();
      }
    };
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      // The menu lives in a portal, so it is NOT a DOM descendant of this
      // component — check it separately or every click inside would close it.
      if (containerRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      setMenuOpen(false);
    };

    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('mousedown', onPointerDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('mousedown', onPointerDown);
    };
  }, [menuOpen]);

  const handleSignOut = () => {
    setMenuOpen(false);
    onSignOut();
  };

  const menu = menuOpen && (
    <div
      id={menuId}
      ref={menuRef}
      role='menu'
      className='account-menu'
      data-testid='account-menu'
      aria-label={displayName + ' account menu'}
      style={{
        top: position ? position.top : 0,
        left: position ? position.left : 0,
        width: `min(${MENU_WIDTH}px, calc(100vw - ${VIEWPORT_GUTTER * 2}px))`,
        // Hidden for the pre-measure frame; `visibility` (not `display`) keeps
        // the node measurable so the real height is known before first paint.
        visibility: position ? 'visible' : 'hidden',
      }}
    >
      <div className='account-menu__header'>
        <span className='account-menu__avatar' aria-hidden='true'>
          {initials}
        </span>
        <span className='account-menu__identity'>
          <span className='account-menu__name'>{displayName}</span>
          {user?.email && <span className='account-menu__email'>{user.email}</span>}
        </span>
      </div>

      {/* Divider: account information is separated from the action below. */}
      <div className='account-menu__divider' role='separator' />

      <button type='button' role='menuitem' className='account-menu__signout' onClick={handleSignOut}>
        <LogOutIcon width='16' height='16' aria-hidden='true' />
        Sign out
      </button>
    </div>
  );

  return (
    <div className='sidebar-profile' ref={containerRef} data-testid='sidebar-profile'>
      <div className={'sidebar-profile__row' + (collapsed ? ' sidebar-profile__row--collapsed' : '')}>
        {/* Collapsed: the avatar IS the trigger, so there is no second control
            competing for room in the 64px rail. Expanded: the avatar is
            decorative and the three-dot button opens the menu. */}
        <button
          ref={triggerRef}
          type='button'
          className={
            'sidebar-profile__avatar' + (collapsed ? ' sidebar-profile__avatar--trigger' : '')
          }
          onClick={collapsed ? () => setMenuOpen((open) => !open) : undefined}
          aria-haspopup='menu'
          aria-expanded={menuOpen}
          aria-controls={menuOpen ? menuId : undefined}
          aria-label={collapsed ? 'Open account menu' : undefined}
          aria-hidden={collapsed ? undefined : true}
          tabIndex={collapsed ? undefined : -1}
          title={collapsed ? displayName : undefined}
        >
          {initials}
        </button>

        {!collapsed && (
          <>
            <span className='sidebar-profile__identity'>
              <span className='sidebar-profile__name' title={displayName}>
                {displayName}
              </span>
              {user?.email && (
                <span className='sidebar-profile__email' title={user.email}>
                  {user.email}
                </span>
              )}
            </span>

            <button
              type='button'
              className='sidebar-profile__menu-button'
              onClick={() => setMenuOpen((open) => !open)}
              aria-label='Open account menu'
              aria-haspopup='menu'
              aria-expanded={menuOpen}
              aria-controls={menuOpen ? menuId : undefined}
              title='Open account menu'
            >
              <MoreIcon width='18' height='18' aria-hidden='true' />
            </button>
          </>
        )}
      </div>

      {menu && createPortal(menu, document.body)}
    </div>
  );
}

function MoreIcon({ ...props }: React.SVGProps<SVGSVGElement>) {
  return (
    <svg width='18' height='18' viewBox='0 0 24 24' fill='currentColor' {...props}>
      <circle cx='12' cy='5' r='1.75' />
      <circle cx='12' cy='12' r='1.75' />
      <circle cx='12' cy='19' r='1.75' />
    </svg>
  );
}

function LogOutIcon({ ...props }: React.SVGProps<SVGSVGElement>) {
  return (
    <svg width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2' strokeLinecap='round' strokeLinejoin='round' {...props}>
      <path d='M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4' />
      <polyline points='16 17 21 12 16 7' />
      <line x1='21' y1='12' x2='9' y2='12' />
    </svg>
  );
}

export default SidebarProfile;
