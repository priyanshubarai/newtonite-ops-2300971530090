import { describe, expect, it } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { installFetchMock, type MockReply } from "../test/mockFetch";
import { LEAD_MEMBERSHIP, makeItem, mockItemList, mockSession, TEST_USER } from "../test/fixtures";
import { renderApp } from "../test/renderApp";
import { getToken, setToken } from "./tokenStore";

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
    setToken("session-token");

    renderApp({ route: "/items" });

    expect(await screen.findByText(/loading your workspace/i)).toBeInTheDocument();

    resolveMe?.({ status: 200, body: { user: TEST_USER, memberships: [LEAD_MEMBERSHIP] } });
    expect(await screen.findByRole("heading", { name: /work items/i })).toBeInTheDocument();
  });

  it("returns to login and clears the token when the session is rejected", async () => {
    const mock = installFetchMock();
    mock.on("GET", "/auth/me", () => ({ status: 401, body: { error: "Invalid or expired token" } }));
    setToken("expired-token");

    renderApp({ route: "/items" });

    expect(await screen.findByRole("button", { name: /sign in/i })).toBeInTheDocument();
    await waitFor(() => expect(getToken()).toBeNull());
    expect(mock.requestsFor("GET", "/items")).toHaveLength(0);
  });

  it("shows a recoverable error when the session cannot be loaded", async () => {
    const mock = installFetchMock();
    mock.on("GET", "/auth/me", () => ({ status: 500, body: { error: "Internal server error" } }));
    setToken("session-token");

    renderApp({ route: "/items" });

    expect(await screen.findByText(/couldn't load your session/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
    expect(getToken()).toBe("session-token");
  });

  it("signs out from the shell and clears client-held session state", async () => {
    const mock = installFetchMock();
    mockSession(mock);
    mockItemList(mock, [makeItem()]);
    setToken("session-token");
    const user = userEvent.setup();

    renderApp({ route: "/items" });
    await screen.findByRole("heading", { name: /work items/i });

    await user.click(screen.getByRole("button", { name: /sign out/i }));

    expect(await screen.findByRole("button", { name: /sign in/i })).toBeInTheDocument();
    expect(getToken()).toBeNull();
  });
});
