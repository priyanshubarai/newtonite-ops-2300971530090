import { beforeEach, describe, expect, it } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { installFetchMock } from "../test/mockFetch";
import { mockSession, mockItemList, makeItem, TEST_USER, LEAD_MEMBERSHIP } from "../test/fixtures";
import { renderApp } from "../test/renderApp";
import { setSession } from "../auth/tokenStore";

/**
 * AppShell navigation: accessible labels, keyboard interaction, responsive
 * behaviour, and sidebar navigation.
 */
describe("AppShell navigation", () => {
  beforeEach(() => {
    setSession(true);
  });

  it("renders the sidebar navigation with accessible labels", async () => {
    const mock = installFetchMock();
    mockSession(mock, { memberships: [LEAD_MEMBERSHIP] });
    mockItemList(mock, [makeItem()]);

    renderApp({ route: "/overview" });
    await screen.findByText("Overview");

    // Main navigation is in the sidebar
    const nav = screen.getByRole("navigation", { name: /main navigation/i });
    expect(nav).toBeInTheDocument();

    // Overview link is active and enabled
    const overviewLink = screen.getByRole("link", { name: /overview/i });
    expect(overviewLink).toBeInTheDocument();
    expect(overviewLink).not.toBeDisabled();
    expect(overviewLink).toHaveClass("sidebar-nav__link--active");
  });

  it("shows all main navigation items in sidebar", async () => {
    const mock = installFetchMock();
    mockSession(mock, { memberships: [LEAD_MEMBERSHIP] });
    mockItemList(mock, [makeItem()]);

    renderApp({ route: "/overview" });
    await screen.findByText("Overview");

    const navItems = [
      "overview",
      "my work",
      "needs attention",
      "awaiting approval",
      "all work items",
    ];

    for (const item of navItems) {
      const link = screen.getByRole("link", { name: new RegExp(item, "i") });
      expect(link).toBeInTheDocument();
      expect(link).not.toBeDisabled();
    }
  });

  it("displays the current user identity in the sidebar profile", async () => {
    const mock = installFetchMock();
    mockSession(mock, { user: TEST_USER, memberships: [LEAD_MEMBERSHIP] });
    mockItemList(mock, [makeItem()]);

    renderApp({ route: "/overview" });
    await screen.findByText("Overview");

    const profile = screen.getByTestId("sidebar-profile");
    expect(within(profile).getByText(TEST_USER.name)).toBeInTheDocument();
    expect(within(profile).getByText(TEST_USER.email)).toBeInTheDocument();
    expect(within(profile).getByText(/^AS$/)).toBeInTheDocument();
  });

  it("does not duplicate the user identity in the main header", async () => {
    const mock = installFetchMock();
    mockSession(mock, { user: TEST_USER, memberships: [LEAD_MEMBERSHIP] });
    mockItemList(mock, [makeItem()]);

    renderApp({ route: "/overview" });
    await screen.findByText("Overview");

    const header = screen.getByRole("banner");
    expect(within(header).queryByText(TEST_USER.name)).not.toBeInTheDocument();
    expect(within(header).queryByText(TEST_USER.email)).not.toBeInTheDocument();
    expect(within(header).queryByRole("button", { name: /sign out/i })).not.toBeInTheDocument();
    // The workspace actions that belong there are preserved.
    expect(within(header).getByRole("link", { name: /new work item/i })).toBeInTheDocument();
  });

  it("keeps account information and team roles out of the header and the popover", async () => {
    const mock = installFetchMock();
    mockSession(mock, { user: TEST_USER, memberships: [LEAD_MEMBERSHIP] });
    mockItemList(mock, [makeItem()]);

    renderApp({ route: "/overview" });
    await screen.findByText("Overview");

    const header = screen.getByRole("banner");
    expect(within(header).queryByText(/payments \(lead\)/i)).not.toBeInTheDocument();

    // The popover shows the account and the sign-out action only. Team
    // memberships are deliberately not listed.
    await userEvent.click(screen.getByRole("button", { name: /open account menu/i }));
    const menu = screen.getByRole("menu", { name: new RegExp(TEST_USER.name, "i") });
    expect(within(menu).getByText(TEST_USER.name)).toBeInTheDocument();
    expect(within(menu).getByText(TEST_USER.email)).toBeInTheDocument();
    expect(within(menu).getByRole("menuitem", { name: /sign out/i })).toBeInTheDocument();
    expect(within(menu).queryByText(/payments/i)).not.toBeInTheDocument();
    expect(within(menu).queryByText(/lead/i)).not.toBeInTheDocument();
  });

  it("renders the account popover in a portal, outside the sidebar", async () => {
    const mock = installFetchMock();
    mockSession(mock, { user: TEST_USER, memberships: [LEAD_MEMBERSHIP] });
    mockItemList(mock, [makeItem()]);

    renderApp({ route: "/overview" });
    await screen.findByText("Overview");

    await userEvent.click(screen.getByRole("button", { name: /open account menu/i }));
    const menu = screen.getByRole("menu", { name: new RegExp(TEST_USER.name, "i") });

    // Portalled to <body>: the sidebar's width and overflow cannot constrain it.
    const sidebar = screen.getByRole("complementary", { name: /main navigation/i });
    expect(sidebar.contains(menu)).toBe(false);
    expect(document.body.contains(menu)).toBe(true);
  });

  it("has a skip link for keyboard users", async () => {
    const mock = installFetchMock();
    mockSession(mock, { memberships: [LEAD_MEMBERSHIP] });
    mockItemList(mock, [makeItem()]);

    renderApp({ route: "/overview" });
    await screen.findByText("Overview");

    const skipLink = screen.getByRole("link", { name: /skip to main content/i });
    expect(skipLink).toBeInTheDocument();
    expect(skipLink).toHaveAttribute("href", "#main-content");
  });

  it("signs out from the sidebar account menu", async () => {
    const mock = installFetchMock();
    mockSession(mock, { user: TEST_USER, memberships: [LEAD_MEMBERSHIP] });
    mockItemList(mock, [makeItem()]);

    renderApp({ route: "/overview" });
    await screen.findByText("Overview");

    await userEvent.click(screen.getByRole("button", { name: /open account menu/i }));
    const signOutButton = screen.getByRole("menuitem", { name: /sign out/i });
    expect(signOutButton).toBeInTheDocument();

    await userEvent.click(signOutButton);
    expect(await screen.findByRole("button", { name: /sign in/i })).toBeInTheDocument();
  });

  it("closes the account menu on Escape", async () => {
    const mock = installFetchMock();
    mockSession(mock, { user: TEST_USER, memberships: [LEAD_MEMBERSHIP] });
    mockItemList(mock, [makeItem()]);

    renderApp({ route: "/overview" });
    await screen.findByText("Overview");

    await userEvent.click(screen.getByRole("button", { name: /open account menu/i }));
    expect(screen.getByRole("menu")).toBeInTheDocument();

    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("shows team navigation sections with expandable team views", async () => {
    const mock = installFetchMock();
    mockSession(mock, { memberships: [LEAD_MEMBERSHIP] });
    mockItemList(mock, [makeItem()]);

    renderApp({ route: "/overview" });
    await screen.findByText("Overview");

    // Scope to the Teams nav: the team name also appears in the header's
    // membership summary, and this test is about the navigation section.
    const teamsNav = screen.getByRole("navigation", { name: /^teams$/i });

    // Teams section header
    expect(within(teamsNav).getByText(/teams/i)).toBeInTheDocument();

    // Team name appears inside the team navigation
    expect(within(teamsNav).getByText(/payments/i)).toBeInTheDocument();
  });

  it("moves the collapse control into the sidebar header", async () => {
    const mock = installFetchMock();
    mockSession(mock, { memberships: [LEAD_MEMBERSHIP] });
    mockItemList(mock, [makeItem()]);

    renderApp({ route: "/overview" });
    await screen.findByText("Overview");

    const collapseButton = screen.getByRole("button", { name: /collapse sidebar/i });
    // Beside the brand title, not floating at the bottom of the sidebar.
    const header = document.querySelector(".app-sidebar__header");
    expect(header).not.toBeNull();
    expect(within(header as HTMLElement).getByRole("button", { name: /collapse sidebar/i })).toBe(collapseButton);
  });

  it("shows a compact brand mark instead of a clipped title when collapsed", async () => {
    const mock = installFetchMock();
    mockSession(mock, { memberships: [LEAD_MEMBERSHIP] });
    mockItemList(mock, [makeItem()]);

    renderApp({ route: "/overview" });
    await screen.findByText("Overview");

    // Expanded: the full title is rendered.
    const sidebar = screen.getByRole("complementary", { name: /main navigation/i });
    expect(within(sidebar).getByText(/operations/i)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /collapse sidebar/i }));

    // Collapsed: the title text is removed (not merely clipped) and the brand
    // link keeps an accessible name.
    expect(within(sidebar).queryByText(/operations/i)).not.toBeInTheDocument();
    expect(sidebar.querySelector(".app-sidebar__brand--mark")).not.toBeNull();
    expect(within(sidebar).getByRole("link", { name: /newtonite operations/i })).toBeInTheDocument();
  });

  it("toggles the collapse control in both directions", async () => {
    const mock = installFetchMock();
    mockSession(mock, { memberships: [LEAD_MEMBERSHIP] });
    mockItemList(mock, [makeItem()]);

    renderApp({ route: "/overview" });
    await screen.findByText("Overview");

    await userEvent.click(screen.getByRole("button", { name: /collapse sidebar/i }));
    expect(screen.getByRole("button", { name: /expand sidebar/i })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /expand sidebar/i }));
    expect(screen.getByRole("button", { name: /collapse sidebar/i })).toBeInTheDocument();
  });

  it("keeps nav labels accessible and tooltips available when collapsed", async () => {
    const mock = installFetchMock();
    mockSession(mock, { memberships: [LEAD_MEMBERSHIP] });
    mockItemList(mock, [makeItem()]);

    renderApp({ route: "/overview" });
    await screen.findByText("Overview");

    await userEvent.click(screen.getByRole("button", { name: /collapse sidebar/i }));

    // Visible label text is gone; the accessible name and tooltip survive.
    const overviewLink = screen.getByRole("link", { name: /overview/i });
    expect(overviewLink).toHaveAttribute("title", "Overview");
    expect(overviewLink.querySelector(".sidebar-nav__label")).not.toBeNull();
  });

  it("keeps team navigation reachable when collapsed", async () => {
    const mock = installFetchMock();
    mockSession(mock, { memberships: [LEAD_MEMBERSHIP] });
    mockItemList(mock, [makeItem()]);

    renderApp({ route: "/overview" });
    await screen.findByText("Overview");

    await userEvent.click(screen.getByRole("button", { name: /collapse sidebar/i }));

    // The team row survives as an icon-only control with a real accessible name.
    const teamsNav = screen.getByRole("navigation", { name: /^teams$/i });
    const teamToggle = within(teamsNav).getByRole("button", { name: /expand payments/i });
    expect(teamToggle).toHaveAttribute("title", "Payments (Lead)");
  });

  it("shows only the avatar when collapsed, and keeps the account menu reachable", async () => {
    const mock = installFetchMock();
    mockSession(mock, { user: TEST_USER, memberships: [LEAD_MEMBERSHIP] });
    mockItemList(mock, [makeItem()]);

    renderApp({ route: "/overview" });
    await screen.findByText("Overview");

    const sidebar = screen.getByRole("complementary", { name: /main navigation/i });
    const profile = within(sidebar).getByTestId("sidebar-profile");
    expect(within(profile).getByText(TEST_USER.name)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /collapse sidebar/i }));

    // Avatar only: no name, email, team or role text anywhere in the profile.
    expect(within(profile).queryByText(TEST_USER.name)).not.toBeInTheDocument();
    expect(within(profile).queryByText(TEST_USER.email)).not.toBeInTheDocument();
    expect(within(profile).queryByText(/payments/i)).not.toBeInTheDocument();
    expect(within(profile).getByText("AS")).toBeInTheDocument();

    // The avatar itself is the trigger — no second control competing for room.
    const avatarTrigger = within(profile).getByRole("button", { name: /open account menu/i });
    expect(within(profile).queryAllByRole("button", { name: /open account menu/i })).toHaveLength(1);

    await userEvent.click(avatarTrigger);
    const menu = screen.getByRole("menu", { name: new RegExp(TEST_USER.name, "i") });
    expect(within(menu).getByText(TEST_USER.name)).toBeInTheDocument();
    expect(within(menu).getByText(TEST_USER.email)).toBeInTheDocument();
    expect(within(menu).getByRole("menuitem", { name: /sign out/i })).toBeInTheDocument();
  });

  it("toggles team expansion when clicking team header", async () => {
    const mock = installFetchMock();
    mockSession(mock, { memberships: [LEAD_MEMBERSHIP] });
    mockItemList(mock, [makeItem()]);

    renderApp({ route: "/overview" });
    await screen.findByText("Overview");

    // Find the team toggle button
    const teamToggle = screen.getByRole("button", { name: /expand payments/i });
    expect(teamToggle).toBeInTheDocument();
    expect(teamToggle).toHaveAttribute("aria-expanded", "false");

    // Click to expand
    await userEvent.click(teamToggle);
    expect(teamToggle).toHaveAttribute("aria-expanded", "true");

    // Sub-navigation items should be visible inside the Teams nav
    const teamsNav = screen.getByRole("navigation", { name: /^teams$/i });
    expect(within(teamsNav).getByRole("link", { name: /all items/i })).toBeInTheDocument();
    expect(within(teamsNav).getByRole("link", { name: /assigned to me/i })).toBeInTheDocument();
    expect(within(teamsNav).getByRole("link", { name: /unassigned urgent/i })).toBeInTheDocument();
    expect(within(teamsNav).getByRole("link", { name: /awaiting approval/i })).toBeInTheDocument();
  });

  it("shows mobile menu button and opens sidebar on click", async () => {
    const mock = installFetchMock();
    mockSession(mock, { memberships: [LEAD_MEMBERSHIP] });
    mockItemList(mock, [makeItem()]);

    // Render with narrow viewport by using a route that doesn't redirect
    renderApp({ route: "/overview" });
    await screen.findByText("Overview");

    // The mobile menu button should exist in the header
    const menuButton = screen.getByRole("button", { name: /open navigation/i });
    expect(menuButton).toBeInTheDocument();

    // Click to open sidebar
    await userEvent.click(menuButton);

    // Sidebar should be open (overlay appears)
    const overlay = screen.getByTestId("sidebar-overlay");
    expect(overlay).toBeInTheDocument();

    // Click overlay to close
    await userEvent.click(overlay);
  });
});