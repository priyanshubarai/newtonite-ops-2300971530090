import { describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { installFetchMock } from "../test/mockFetch";
import { mockItemList, mockSession, makeItem, TEST_USER } from "../test/fixtures";
import { renderApp } from "../test/renderApp";
import { getToken } from "../auth/tokenStore";
import {
  DEMO_ACCOUNTS,
  DEV_DEMO_PASSWORD,
  findDemoAccount,
  rolePreviewLines,
} from "../lib/demoAccounts";

/**
 * Login screen: demo-account convenience, field validation, generic failure
 * messaging, session handoff, and basic keyboard operability. These are
 * component-level tests; they do not assert anything about backend
 * authentication security.
 */

function passwordInput() {
  // Exact match: the show/hide control is labelled "Show password".
  return screen.getByLabelText(/^password$/i);
}

function emailInput() {
  return screen.getByLabelText(/^email$/i);
}

describe("LoginPage", () => {
  it("renders a deliberately sized auth card with a single readable title", () => {
    const mock = installFetchMock();
    mockSession(mock);

    renderApp({ route: "/login" });

    const heading = screen.getByRole("heading", {
      name: "Newtonite Operations",
      level: 1,
    });
    // Regression guard: the display scale (up to 72px) shredded this title
    // inside the card and must not be reused here.
    expect(heading).not.toHaveClass("text-display");
    expect(heading.closest(".auth-card")).toBeInTheDocument();
  });

  it("blocks submission and reports missing fields", async () => {
    const mock = installFetchMock();
    mockSession(mock);
    const user = userEvent.setup();

    renderApp({ route: "/login" });
    await user.clear(passwordInput());
    await user.click(screen.getByRole("button", { name: /sign in/i }));

    expect(await screen.findByText("Enter your email address.")).toBeInTheDocument();
    expect(screen.getByText("Enter your password.")).toBeInTheDocument();
    expect(mock.requestsFor("POST", "/auth/login")).toHaveLength(0);
  });

  it("associates labels with their controls", () => {
    const mock = installFetchMock();
    mockSession(mock);

    renderApp({ route: "/login" });

    expect(emailInput()).toHaveAttribute("type", "email");
    expect(passwordInput()).toHaveAttribute("type", "password");
    expect(screen.getByLabelText(/demo account/i)).toBeInTheDocument();
  });

  it("offers exactly the maintained demo accounts", () => {
    const mock = installFetchMock();
    mockSession(mock);

    renderApp({ route: "/login" });

    const select = screen.getByLabelText(/demo account/i);
    const options = within(select).getAllByRole("option");
    // First option is the placeholder, then one option per configured account.
    expect(options[0]).toHaveValue("");
    expect(options.slice(1).map((option) => option.getAttribute("value"))).toEqual(
      DEMO_ACCOUNTS.map((account) => account.email),
    );
    // No secrets belong in the option labels.
    for (const option of options) {
      expect(option.textContent ?? "").not.toContain(DEV_DEMO_PASSWORD);
    }
  });

  it("populates the email field and role preview when an account is selected", async () => {
    const mock = installFetchMock();
    mockSession(mock);
    const user = userEvent.setup();

    renderApp({ route: "/login" });
    await user.selectOptions(screen.getByLabelText(/demo account/i), "avery@newtonite.dev");

    expect(emailInput()).toHaveValue("avery@newtonite.dev");
    const preview = screen.getByRole("status");
    expect(preview).toHaveTextContent("Payments Operations — Admin");
    expect(preview).toHaveTextContent("Platform Engineering — Admin");
  });

  it("shows every team-scoped role for a multi-team account", async () => {
    const mock = installFetchMock();
    mockSession(mock);
    const user = userEvent.setup();
    const blake = findDemoAccount("blake@newtonite.dev");
    expect(blake).toBeDefined();

    renderApp({ route: "/login" });
    await user.selectOptions(screen.getByLabelText(/demo account/i), "blake@newtonite.dev");

    const preview = screen.getByRole("status");
    for (const line of rolePreviewLines(blake!)) {
      expect(preview).toHaveTextContent(line);
    }
  });

  it("does not fabricate a role for an unknown email", async () => {
    const mock = installFetchMock();
    mockSession(mock);
    const user = userEvent.setup();

    renderApp({ route: "/login" });
    await user.type(emailInput(), "nobody@newtonite.dev");

    const preview = screen.getByRole("status");
    expect(preview).toHaveTextContent(/Not a seeded demo account/);
    expect(preview).not.toHaveTextContent(/Admin|Lead|Member|Viewer/);
    expect(preview.querySelectorAll("li")).toHaveLength(0);
  });

  it("prefills the documented development demo password", () => {
    const mock = installFetchMock();
    mockSession(mock);

    renderApp({ route: "/login" });

    // Assert against the approved configuration rather than printing a value.
    expect(passwordInput()).toHaveValue(DEV_DEMO_PASSWORD);
  });

  it("lets the tester edit or clear the prefilled password", async () => {
    const mock = installFetchMock();
    mockSession(mock);
    const user = userEvent.setup();

    renderApp({ route: "/login" });
    await user.clear(passwordInput());
    expect(passwordInput()).toHaveValue("");

    await user.type(passwordInput(), "edited-password");
    expect(passwordInput()).toHaveValue("edited-password");
  });

  it("masks the password and toggles visibility", async () => {
    const mock = installFetchMock();
    mockSession(mock);
    const user = userEvent.setup();

    renderApp({ route: "/login" });
    expect(passwordInput()).toHaveAttribute("type", "password");

    const show = screen.getByRole("button", { name: "Show password" });
    expect(show).toHaveAttribute("aria-pressed", "false");
    await user.click(show);

    expect(passwordInput()).toHaveAttribute("type", "text");
    const hide = screen.getByRole("button", { name: "Hide password" });
    expect(hide).toHaveAttribute("aria-pressed", "true");

    await user.click(hide);
    expect(passwordInput()).toHaveAttribute("type", "password");
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
    await user.type(emailInput(), "nobody@newtonite.dev");
    await user.clear(passwordInput());
    await user.type(passwordInput(), "wrong-password");
    await user.click(screen.getByRole("button", { name: /sign in/i }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Invalid email or password.");
    // Still on the login screen, and no token was stored.
    expect(screen.getByRole("button", { name: /sign in/i })).toBeInTheDocument();
    expect(getToken()).toBeNull();
    // An ordinary failure must not wipe the tester's input.
    expect(passwordInput()).toHaveValue("wrong-password");
  });

  it("shows a network error message when the server cannot be reached", async () => {
    const mock = installFetchMock();
    mockSession(mock);
    // Simulate a transport failure by making the handler reject
    mock.on("POST", "/auth/login", () => Promise.reject(new TypeError("Failed to fetch")));
    const user = userEvent.setup();

    renderApp({ route: "/login" });
    await user.type(emailInput(), TEST_USER.email);
    await user.clear(passwordInput());
    await user.type(passwordInput(), "any-password");
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
    await user.type(emailInput(), TEST_USER.email);
    await user.clear(passwordInput());
    await user.type(passwordInput(), "any-password");
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
    await user.type(emailInput(), TEST_USER.email);
    await user.clear(passwordInput());
    await user.type(passwordInput(), "correct-horse-battery");
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
    await user.type(emailInput(), TEST_USER.email);
    await user.clear(passwordInput());
    await user.type(passwordInput(), "correct-horse-battery");

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
    await user.type(emailInput(), TEST_USER.email);
    await user.clear(passwordInput());
    await user.type(passwordInput(), "correct-horse-battery");
    await user.click(screen.getByRole("button", { name: /sign in/i }));

    expect(await screen.findByRole("heading", { name: /work items/i })).toBeInTheDocument();
    expect(getToken()).toBe("session-token");
  });

  it("sends the selected email and password through the existing login contract", async () => {
    const mock = installFetchMock();
    mockSession(mock);
    mockItemList(mock, []);
    mock.on("POST", "/auth/login", () => ({
      status: 200,
      body: { token: "session-token", tokenType: "Bearer", user: TEST_USER },
    }));
    const user = userEvent.setup();

    renderApp({ route: "/login" });
    await user.selectOptions(screen.getByLabelText(/demo account/i), "avery@newtonite.dev");
    const submit = screen.getByRole("button", { name: /sign in/i });
    expect(submit).toBeEnabled();
    await user.click(submit);

    await waitFor(() => {
      expect(mock.requestsFor("POST", "/auth/login")).toHaveLength(1);
    });
    const [request] = mock.requestsFor("POST", "/auth/login");
    expect(request.body).toEqual({
      email: "avery@newtonite.dev",
      password: DEV_DEMO_PASSWORD,
    });
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
    await user.type(emailInput(), TEST_USER.email);
    await user.clear(passwordInput());
    await user.type(passwordInput(), "correct-horse-battery{Enter}");

    await waitFor(() => {
      expect(mock.requestsFor("POST", "/auth/login")).toHaveLength(1);
    });
  });
});
