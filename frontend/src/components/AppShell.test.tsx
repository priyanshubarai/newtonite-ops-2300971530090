import { beforeEach, describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { installFetchMock } from "../test/mockFetch";
import { mockSession, mockItemList, makeItem, TEST_USER, LEAD_MEMBERSHIP } from "../test/fixtures";
import { renderApp } from "../test/renderApp";
import { setToken } from "../auth/tokenStore";

/**
 * AppShell navigation: accessible labels, keyboard interaction, responsive
 * behaviour, and sidebar navigation.
 */
describe("AppShell navigation", () => {
  beforeEach(() => {
    setToken("session-token");
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

  it("displays current user identity in the header", async () => {
    const mock = installFetchMock();
    mockSession(mock, { user: TEST_USER, memberships: [LEAD_MEMBERSHIP] });
    mockItemList(mock, [makeItem()]);

    renderApp({ route: "/overview" });
    await screen.findByText("Overview");

    expect(screen.getByText(TEST_USER.name)).toBeInTheDocument();
    expect(screen.getByText(TEST_USER.email)).toBeInTheDocument();
  });

  it("displays team memberships with role labels in header", async () => {
    const mock = installFetchMock();
    mockSession(mock, { user: TEST_USER, memberships: [LEAD_MEMBERSHIP] });
    mockItemList(mock, [makeItem()]);

    renderApp({ route: "/overview" });
    await screen.findByText("Overview");

    expect(screen.getByText(/payments \(lead\)/i)).toBeInTheDocument();
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

  it("has a working sign-out button", async () => {
    const mock = installFetchMock();
    mockSession(mock, { user: TEST_USER, memberships: [LEAD_MEMBERSHIP] });
    mockItemList(mock, [makeItem()]);

    renderApp({ route: "/overview" });
    await screen.findByText("Overview");

    const signOutButton = screen.getByRole("button", { name: /sign out/i });
    expect(signOutButton).toBeInTheDocument();
  });

  it("shows team navigation sections with expandable team views", async () => {
    const mock = installFetchMock();
    mockSession(mock, { memberships: [LEAD_MEMBERSHIP] });
    mockItemList(mock, [makeItem()]);

    renderApp({ route: "/overview" });
    await screen.findByText("Overview");

    // Teams section header
    expect(screen.getByText(/teams/i)).toBeInTheDocument();

    // Team name appears
    expect(screen.getByText(/payments/i)).toBeInTheDocument();
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

    // Sub-navigation items should be visible
    expect(screen.getByRole("link", { name: /all items/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /assigned to me/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /unassigned urgent/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /awaiting approval/i })).toBeInTheDocument();
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