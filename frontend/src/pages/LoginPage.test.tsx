import { describe, expect, it } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { installFetchMock } from "../test/mockFetch";
import { mockItemList, mockSession, makeItem, TEST_USER } from "../test/fixtures";
import { renderApp } from "../test/renderApp";
import { getToken } from "../auth/tokenStore";

/**
 * Login screen: field validation, generic failure messaging, session handoff,
 * and basic keyboard operability. These are component-level tests; they do not
 * assert anything about backend authentication security.
 */
describe("LoginPage", () => {
  it("blocks submission and reports missing fields", async () => {
    const mock = installFetchMock();
    mockSession(mock);
    const user = userEvent.setup();

    renderApp({ route: "/login" });
    await user.click(screen.getByRole("button", { name: /sign in/i }));

    expect(await screen.findByText("Enter your email address.")).toBeInTheDocument();
    expect(screen.getByText("Enter your password.")).toBeInTheDocument();
    expect(mock.requestsFor("POST", "/auth/login")).toHaveLength(0);
  });

  it("associates labels with their controls", () => {
    const mock = installFetchMock();
    mockSession(mock);

    renderApp({ route: "/login" });

    expect(screen.getByLabelText(/email/i)).toHaveAttribute("type", "email");
    expect(screen.getByLabelText(/password/i)).toHaveAttribute("type", "password");
  });

  it("shows a single generic message for rejected credentials", async () => {
    const mock = installFetchMock();
    mockSession(mock);
    mock.on("POST", "/auth/login", () => ({
      status: 401,
      body: { error: "Invalid email or password" },
    }));
    const user = userEvent.setup();

    renderApp({ route: "/login" });
    await user.type(screen.getByLabelText(/email/i), "nobody@newtonite.dev");
    await user.type(screen.getByLabelText(/password/i), "wrong-password");
    await user.click(screen.getByRole("button", { name: /sign in/i }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Invalid email or password.");
    // Still on the login screen, and no token was stored.
    expect(screen.getByRole("button", { name: /sign in/i })).toBeInTheDocument();
    expect(getToken()).toBeNull();
  });

  it("shows a network error message when the server cannot be reached", async () => {
    const mock = installFetchMock();
    mockSession(mock);
    // Simulate a transport failure by making the handler reject
    mock.on("POST", "/auth/login", () => Promise.reject(new TypeError("Failed to fetch")));
    const user = userEvent.setup();

    renderApp({ route: "/login" });
    await user.type(screen.getByLabelText(/email/i), TEST_USER.email);
    await user.type(screen.getByLabelText(/password/i), "any-password");
    await user.click(screen.getByRole("button", { name: /sign in/i }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("We couldn't reach the server. Check your connection and try again.");
    expect(screen.getByRole("button", { name: /sign in/i })).toBeInTheDocument();
    expect(getToken()).toBeNull();
  });

  it("shows a server error message for non-401 server failures", async () => {
    const mock = installFetchMock();
    mockSession(mock);
    mock.on("POST", "/auth/login", () => ({
      status: 500,
      body: { error: "Internal server error" },
    }));
    const user = userEvent.setup();

    renderApp({ route: "/login" });
    await user.type(screen.getByLabelText(/email/i), TEST_USER.email);
    await user.type(screen.getByLabelText(/password/i), "any-password");
    await user.click(screen.getByRole("button", { name: /sign in/i }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Internal server error");
    expect(screen.getByRole("button", { name: /sign in/i })).toBeInTheDocument();
    expect(getToken()).toBeNull();
  });

  it("returns to the originally requested page after successful login", async () => {
    const mock = installFetchMock();
    mockSession(mock);
    mockItemList(mock, [makeItem()]);
    mock.on("POST", "/auth/login", () => ({
      status: 200,
      body: { token: "session-token", tokenType: "Bearer", user: TEST_USER },
    }));
    const user = userEvent.setup();

    // User tries to access /items, gets redirected to /login with state
    renderApp({
      route: "/login",
      state: { from: "/items" },
    });
    await user.type(screen.getByLabelText(/email/i), TEST_USER.email);
    await user.type(screen.getByLabelText(/password/i), "correct-horse-battery");
    await user.click(screen.getByRole("button", { name: /sign in/i }));

    expect(await screen.findByRole("heading", { name: /work items/i })).toBeInTheDocument();
  });

  it("prevents duplicate submissions while a request is in flight", async () => {
    const mock = installFetchMock();
    mockSession(mock);
    mockItemList(mock, []);
    let resolveLogin: (value: { status: number; body: unknown }) => void = () => {};
    const loginPromise = new Promise<{ status: number; body: unknown }>((resolve) => {
      resolveLogin = resolve;
    });
    mock.on("POST", "/auth/login", () => loginPromise);
    const user = userEvent.setup();

    renderApp({ route: "/login" });
    await user.type(screen.getByLabelText(/email/i), TEST_USER.email);
    await user.type(screen.getByLabelText(/password/i), "correct-horse-battery");

    const submitButton = screen.getByRole("button", { name: /sign in/i });
    await user.click(submitButton);

    // Button should be disabled and show loading text
    expect(submitButton).toBeDisabled();
    expect(submitButton).toHaveTextContent("Signing in…");

    // Try to click again - should not trigger another request
    await user.click(submitButton);

    // Resolve the first request
    resolveLogin({ status: 200, body: { token: "session-token", tokenType: "Bearer", user: TEST_USER } });

    await waitFor(() => {
      expect(mock.requestsFor("POST", "/auth/login")).toHaveLength(1);
    });

    expect(await screen.findByRole("heading", { name: /work items/i })).toBeInTheDocument();
  });

  it("stores the token and loads the dashboard on success", async () => {
    const mock = installFetchMock();
    mockSession(mock);
    mockItemList(mock, [makeItem()]);
    mock.on("POST", "/auth/login", () => ({
      status: 200,
      body: { token: "session-token", tokenType: "Bearer", user: TEST_USER },
    }));
    const user = userEvent.setup();

    renderApp({ route: "/login" });
    await user.type(screen.getByLabelText(/email/i), TEST_USER.email);
    await user.type(screen.getByLabelText(/password/i), "correct-horse-battery");
    await user.click(screen.getByRole("button", { name: /sign in/i }));

    expect(await screen.findByRole("heading", { name: /work items/i })).toBeInTheDocument();
    expect(getToken()).toBe("session-token");
  });

  it("submits with the keyboard from a field", async () => {
    const mock = installFetchMock();
    mockSession(mock);
    mockItemList(mock, []);
    mock.on("POST", "/auth/login", () => ({
      status: 200,
      body: { token: "session-token", tokenType: "Bearer", user: TEST_USER },
    }));
    const user = userEvent.setup();

    renderApp({ route: "/login" });
    await user.type(screen.getByLabelText(/email/i), TEST_USER.email);
    await user.type(screen.getByLabelText(/password/i), "correct-horse-battery{Enter}");

    await waitFor(() => {
      expect(mock.requestsFor("POST", "/auth/login")).toHaveLength(1);
    });
  });
});
