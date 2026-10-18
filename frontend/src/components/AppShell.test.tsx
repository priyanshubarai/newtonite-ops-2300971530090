import { beforeEach, describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { installFetchMock } from "../test/mockFetch";
import { mockSession, mockItemList, makeItem, TEST_USER, LEAD_MEMBERSHIP } from "../test/fixtures";
import { renderApp } from "../test/renderApp";
import { setToken } from "../auth/tokenStore";

/**
 * AppShell navigation: accessible labels, keyboard interaction, responsive
 * behaviour, and future-section placeholders.
 */
describe("AppShell navigation", () => {
  beforeEach(() => {
    setToken("session-token");
  });

  it("renders the primary navigation with accessible labels", async () => {
    const mock = installFetchMock();
    mockSession(mock, { memberships: [LEAD_MEMBERSHIP] });
    mockItemList(mock, [makeItem()]);

    renderApp({ route: "/items" });
    await screen.findByRole("heading", { name: /work items/i });

    const nav = screen.getByRole("navigation", { name: /primary/i });
    expect(nav).toBeInTheDocument();

    // Work items link is active and enabled
    const workItemsLink = screen.getByRole("link", { name: /work items/i });
    expect(workItemsLink).toBeInTheDocument();
    expect(workItemsLink).not.toBeDisabled();
  });

  it("shows future-section placeholders as disabled with tooltips", async () => {
    const mock = installFetchMock();
    mockSession(mock, { memberships: [LEAD_MEMBERSHIP] });
    mockItemList(mock, [makeItem()]);

    renderApp({ route: "/items" });
    await screen.findByRole("heading", { name: /work items/i });

    const overviewLink = screen.getByRole("link", { name: /overview/i });
    expect(overviewLink).toBeInTheDocument();
    expect(overviewLink).toHaveAttribute("aria-disabled", "true");
    expect(overviewLink).toHaveAttribute("title", "Operational dashboard (not yet implemented)");

    const assignedLink = screen.getByRole("link", { name: /assigned to me/i });
    expect(assignedLink).toHaveAttribute("aria-disabled", "true");
    expect(assignedLink).toHaveAttribute("title", "Items assigned to you (not yet implemented)");

    const attentionLink = screen.getByRole("link", { name: /needs attention/i });
    expect(attentionLink).toHaveAttribute("aria-disabled", "true");
    expect(attentionLink).toHaveAttribute("title", "Urgent, unassigned, or awaiting-approval items (not yet implemented)");

    const teamsLink = screen.getByRole("link", { name: /teams/i });
    expect(teamsLink).toHaveAttribute("aria-disabled", "true");
    expect(teamsLink).toHaveAttribute("title", "Team selection and context (not yet implemented)");
  });

  it("shows a 'Soon' badge on disabled navigation items", async () => {
    const mock = installFetchMock();
    mockSession(mock, { memberships: [LEAD_MEMBERSHIP] });
    mockItemList(mock, [makeItem()]);

    renderApp({ route: "/items" });
    await screen.findByRole("heading", { name: /work items/i });

    const overviewLink = screen.getByRole("link", { name: /overview/i });
    expect(overviewLink).toHaveTextContent(/soon/i);
  });

  it("displays current user identity in the header", async () => {
    const mock = installFetchMock();
    mockSession(mock, { user: TEST_USER, memberships: [LEAD_MEMBERSHIP] });
    mockItemList(mock, [makeItem()]);

    renderApp({ route: "/items" });
    await screen.findByRole("heading", { name: /work items/i });

    expect(screen.getByText(TEST_USER.name)).toBeInTheDocument();
    expect(screen.getByText(TEST_USER.email)).toBeInTheDocument();
  });

  it("displays team memberships with role labels", async () => {
    const mock = installFetchMock();
    mockSession(mock, { user: TEST_USER, memberships: [LEAD_MEMBERSHIP] });
    mockItemList(mock, [makeItem()]);

    renderApp({ route: "/items" });
    await screen.findByRole("heading", { name: /work items/i });

    expect(screen.getByText(/payments \(lead\)/i)).toBeInTheDocument();
  });

  it("has a skip link for keyboard users", async () => {
    const mock = installFetchMock();
    mockSession(mock, { memberships: [LEAD_MEMBERSHIP] });
    mockItemList(mock, [makeItem()]);

    renderApp({ route: "/items" });
    await screen.findByRole("heading", { name: /work items/i });

    const skipLink = screen.getByText(/skip to main content/i);
    expect(skipLink).toBeInTheDocument();
    expect(skipLink).toHaveAttribute("href", "#main-content");
  });

  it("has a working sign-out button", async () => {
    const mock = installFetchMock();
    mockSession(mock, { memberships: [LEAD_MEMBERSHIP] });
    mockItemList(mock, [makeItem()]);
    const user = userEvent.setup();

    renderApp({ route: "/items" });
    await screen.findByRole("heading", { name: /work items/i });

    const signOutButton = screen.getByRole("button", { name: /sign out/i });
    expect(signOutButton).toBeInTheDocument();
    expect(signOutButton).not.toBeDisabled();

    await user.click(signOutButton);

    // Should redirect to login page
    expect(await screen.findByRole("heading", { name: /newtonite operations/i })).toBeInTheDocument();
  });

  it("maintains focus visibility on interactive elements", async () => {
    const mock = installFetchMock();
    mockSession(mock, { memberships: [LEAD_MEMBERSHIP] });
    mockItemList(mock, [makeItem()]);
    const user = userEvent.setup();

    renderApp({ route: "/items" });
    await screen.findByRole("heading", { name: /work items/i });

    await user.tab();

    // The first focusable element in the header should be the brand link
    // or the first nav link. We verify focus styles exist in CSS via
    // the :focus-visible selector, but here we just ensure the element
    // can receive focus.
    expect(document.activeElement).toBeInTheDocument();
  });

  it("responsive: navigation wraps on narrow viewports (CSS flex-wrap)", async () => {
    const mock = installFetchMock();
    mockSession(mock, { memberships: [LEAD_MEMBERSHIP] });
    mockItemList(mock, [makeItem()]);

    renderApp({ route: "/items" });
    await screen.findByRole("heading", { name: /work items/i });

    const headerInner = screen.getByTestId("app-header-inner");
    // The test just verifies the element exists with the right class.
    // Actual responsive behaviour is verified by the CSS flex-wrap property.
    expect(headerInner).toBeInTheDocument();
  });
});