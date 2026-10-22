import { describe, expect, it } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { installFetchMock, type MockReply } from "../test/mockFetch";
import { LEAD_MEMBERSHIP, makeItem, mockItemList, mockSession, TEST_USER } from "../test/fixtures";
import { renderApp } from "../test/renderApp";
import { hasValidSession, setSession } from "./tokenStore";

/**
 * Session behaviour: how the app guards the authenticated area and reacts to a
 * missing, loading, invalid, or failing session. These are client-behaviour
 * tests; the backend's token verification is covered by the backend suite.
 */
describe("session handling", () => {
  it("redirects to the login screen when there is no token", async () => {
    const mock = installFetchMock();
    mockSession(mock);

    renderApp({ route: "/items" });

    expect(await screen.findByRole("heading", { name: /newtonite operations/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /sign in/i })).toBeInTheDocument();
    // Nothing behind the guard was requested.
    expect(mock.requestsFor("GET", "/items")).toHaveLength(0);
    expect(mock.requestsFor("GET", "/auth/me")).toHaveLength(0);
  });

  it("shows a loading state while the session is being resolved", async () => {
    const mock = installFetchMock();
    let resolveMe: ((reply: MockReply) => void) | undefined;
    const pending = new Promise<MockReply>((resolve) => {
      resolveMe = resolve;
    });
    mock.on("GET", "/auth/me", () => pending);
    mockItemList(mock, [makeItem()]);
    setSession(true);

    renderApp({ route: "/items" });

    expect(await screen.findByText(/loading your workspace/i)).toBeInTheDocument();

    resolveMe?.({ status: 200, body: { user: TEST_USER, memberships: [LEAD_MEMBERSHIP] } });
    expect(await screen.findByRole("heading", { name: /work items/i })).toBeInTheDocument();
  });

  it("returns to login and clears the token when the session is rejected", async () => {
    const mock = installFetchMock();
    mock.on("GET", "/auth/me", () => ({ status: 401, body: { error: "Invalid or expired token" } }));
    setSession(true);

    renderApp({ route: "/items" });

    expect(await screen.findByRole("button", { name: /sign in/i })).toBeInTheDocument();
    await waitFor(() => expect(hasValidSession()).toBe(false));
    expect(mock.requestsFor("GET", "/items")).toHaveLength(0);
  });

  it("shows a recoverable error when the session cannot be loaded", async () => {
    const mock = installFetchMock();
    mock.on("GET", "/auth/me", () => ({ status: 500, body: { error: "Internal server error" } }));
    setSession(true);

    renderApp({ route: "/items" });

    expect(await screen.findByText(/couldn't load your session/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
    expect(hasValidSession()).toBe(true);
  });

  it("signs out from the shell and clears client-held session state", async () => {
    const mock = installFetchMock();
    mockSession(mock);
    mockItemList(mock, [makeItem()]);
    mock.on("POST", "/auth/logout", () => ({ status: 200, body: { message: "Logged out successfully" } }));
    setSession(true);
    const user = userEvent.setup();

    renderApp({ route: "/items" });
    await screen.findByRole("heading", { name: /work items/i });

    // Sign-out now lives in the sidebar's account menu, not the main header.
    await user.click(screen.getByRole("button", { name: /open account menu/i }));
    await user.click(screen.getByRole("menuitem", { name: /sign out/i }));

    expect(await screen.findByRole("button", { name: /sign in/i })).toBeInTheDocument();
    expect(hasValidSession()).toBe(false);
  });

  it("ends the server session on sign-out so the auth cookie is cleared", async () => {
    // Regression guard for the cookie-auth refactor: the token lives in an
    // HttpOnly cookie that JavaScript cannot delete, so clearing client state
    // alone left a VALID credential in the browser after sign-out. The app
    // must tell the server to clear it.
    const mock = installFetchMock();
    mockSession(mock);
    mockItemList(mock, [makeItem()]);
    mock.on("POST", "/auth/logout", () => ({ status: 200, body: { message: "Logged out successfully" } }));
    setSession(true);
    const user = userEvent.setup();

    renderApp({ route: "/items" });
    await screen.findByRole("heading", { name: /work items/i });

    await user.click(screen.getByRole("button", { name: /open account menu/i }));
    await user.click(screen.getByRole("menuitem", { name: /sign out/i }));

    await waitFor(() => expect(mock.requestsFor("POST", "/auth/logout")).toHaveLength(1));
  });

  it("still signs the user out locally when the logout request fails", async () => {
    // A network failure must not trap the user in a signed-in state they asked
    // to leave - the local session is cleared regardless of what the server
    // says.
    const mock = installFetchMock();
    mockSession(mock);
    mockItemList(mock, [makeItem()]);
    mock.on("POST", "/auth/logout", () => ({ status: 500, body: { error: "Internal server error" } }));
    setSession(true);
    const user = userEvent.setup();

    renderApp({ route: "/items" });
    await screen.findByRole("heading", { name: /work items/i });

    await user.click(screen.getByRole("button", { name: /open account menu/i }));
    await user.click(screen.getByRole("menuitem", { name: /sign out/i }));

    expect(await screen.findByRole("button", { name: /sign in/i })).toBeInTheDocument();
    expect(hasValidSession()).toBe(false);
    await waitFor(() => expect(mock.requestsFor("POST", "/auth/logout")).toHaveLength(1));
  });

  it("never renders the login screen when a stored token is already present", async () => {
    // The regression this guards: the token used to be hydrated in a useEffect,
    // so the first render after a reload reported "anonymous" and the guard
    // redirected a valid session to /login before reading storage back. Reading
    // localStorage at module load means the very first render is authenticated.
    const mock = installFetchMock();
    mockSession(mock);
    mockItemList(mock, [makeItem()]);
    setSession(true);

    const { container } = renderApp({ route: "/items" });

    // Synchronously, before any effect or await: the app must not be on /login.
    expect(screen.queryByRole("button", { name: /sign in/i })).not.toBeInTheDocument();
    expect(container.textContent).not.toMatch(/sign in/i);

    expect(await screen.findByRole("heading", { name: /work items/i })).toBeInTheDocument();
    expect(hasValidSession()).toBe(true);
  });

  it("reconciles a token written to storage by another context on mount", async () => {
    // Storage can change outside this module (another tab, or a test). The
    // provider re-reads it on mount via the initializeToken effect, so a token
    // that appeared after module load is picked up rather than the session being
    // stuck anonymous. This test simulates that by clearing storage and writing
    // a fresh token, then mounting the app.
    localStorage.clear();
    localStorage.setItem("newtonite_has_session", "true");

    const mock = installFetchMock();
    mockSession(mock);
    mockItemList(mock, [makeItem()]);

    renderApp({ route: "/items" });

    // The mount effect re-reads storage and picks up the new token.
    expect(await screen.findByRole("heading", { level: 1, name: /work items/i })).toBeInTheDocument();
    expect(hasValidSession()).toBe(true);
    expect(screen.queryByRole("button", { name: /sign in/i })).not.toBeInTheDocument();
  });

  it("does not log out on a transient server failure", async () => {
    const mock = installFetchMock();
    mock.on("GET", "/auth/me", () => ({ status: 503, body: { error: "Service unavailable" } }));
    setSession(true);

    renderApp({ route: "/items" });

    // A 5xx is "try again", not "your session is gone".
    expect(await screen.findByText(/couldn't load your session/i)).toBeInTheDocument();
    expect(hasValidSession()).toBe(true);
    expect(screen.queryByRole("button", { name: /sign in/i })).not.toBeInTheDocument();
  });

  it("does not treat an unrelated API error as an expired session", async () => {
    const mock = installFetchMock();
    mockSession(mock);
    // The work-item list fails with a 403 while the session itself is healthy.
    mock.on("GET", "/items", () => ({ status: 403, body: { error: "Forbidden" } }));
    setSession(true);

    renderApp({ route: "/items" });

    expect(await screen.findByRole("heading", { name: /work items/i })).toBeInTheDocument();
    // The user stays signed in; only the failing surface reports an error.
    expect(hasValidSession()).toBe(true);
    expect(screen.queryByRole("button", { name: /sign in/i })).not.toBeInTheDocument();
  });
});