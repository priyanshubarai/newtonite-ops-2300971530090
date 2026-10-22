import { describe, expect, it } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { installFetchMock, type MockReply } from "../test/mockFetch";
import { LEAD_MEMBERSHIP, TEAM_PAYMENTS, TEST_USER, makeItem, mockSession } from "../test/fixtures";
import { renderApp } from "../test/renderApp";
import { setSession } from "../auth/tokenStore";

const ITEM_PATH = /^\/items\/[0-9a-f-]{36}$/;

/** Helper to find Sonner toasts which render in a portal on document.body */
function findToast(role: "alert" | "status", name: RegExp) {
  return waitFor(() => {
    const toasts = document.body.querySelectorAll('[data-sonner-toast]');
    for (const toast of toasts) {
      const roleElement = toast.querySelector(`[role="${role}"]`) || toast;
      if (name.test(roleElement.textContent || "")) {
        return roleElement;
      }
    }
    throw new Error(`Toast with role "${role}" and name matching ${name} not found`);
  });
}

async function renderCreatePage(mock: ReturnType<typeof installFetchMock>) {
  setSession(true);
  mockSession(mock);
  renderApp({ route: "/items/new" });
  await screen.findByRole("heading", { name: /new work item/i });
}

describe("ItemCreatePage", () => {
  it("validates required fields before calling the API", async () => {
    const mock = installFetchMock();
    await renderCreatePage(mock);
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: /create work item/i }));

    expect(await screen.findByText("Title is required.")).toBeInTheDocument();
    expect(mock.requestsFor("POST", "/items")).toHaveLength(0);
  });

  it("submits the backend's field names and an idempotency key", async () => {
    const mock = installFetchMock();
    const created = makeItem({ id: "77777777-7777-4777-8777-777777777777", title: "New incident" });
    mock.on("POST", "/items", () => ({ status: 201, body: created }));
    mock.on("GET", ITEM_PATH, () => ({ status: 200, body: created }));
    await renderCreatePage(mock);
    const user = userEvent.setup();

    await user.type(screen.getByLabelText(/title/i), "New incident");
    await user.selectOptions(screen.getByLabelText(/^type\b/i), "INCIDENT");
    await user.click(screen.getByRole("button", { name: /create work item/i }));

    await waitFor(() => expect(mock.requestsFor("POST", "/items")).toHaveLength(1));
    const request = mock.requestsFor("POST", "/items")[0];
    expect(request.body).toEqual({
      title: "New incident",
      description: null,
      type: "INCIDENT",
      priority: "MEDIUM",
      teamId: LEAD_MEMBERSHIP.teamId,
      assigneeId: null,
      dueAt: null,
    });
    expect(request.headers["Idempotency-Key"]).toBeTruthy();

    // Success navigates to the new item's detail page.
    expect(await screen.findByText("Work item created.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "New incident" })).toBeInTheDocument();
  });

  it("assigns the item to the current user on request", async () => {
    const mock = installFetchMock();
    const created = makeItem({ assigneeId: TEST_USER.id });
    mock.on("POST", "/items", () => ({ status: 201, body: created }));
    mock.on("GET", ITEM_PATH, () => ({ status: 200, body: created }));
    await renderCreatePage(mock);
    const user = userEvent.setup();

    await user.type(screen.getByLabelText(/title/i), "Assign me");
    await user.click(screen.getByRole("button", { name: /assign this work item to yourself/i }));
    await user.click(screen.getByRole("button", { name: /create work item/i }));

    await waitFor(() => expect(mock.requestsFor("POST", "/items")).toHaveLength(1));
    expect(mock.requestsFor("POST", "/items")[0].body).toMatchObject({
      assigneeId: TEST_USER.id,
    });
  });

  it("surfaces a backend validation message on the offending field", async () => {
    const mock = installFetchMock();
    mock.on("POST", "/items", () => ({
      status: 400,
      body: {
        error: "Invalid request body",
        details: { fieldErrors: { title: ["title must be at most 200 characters"] } },
      },
    }));
    await renderCreatePage(mock);
    const user = userEvent.setup();

    await user.type(screen.getByLabelText(/title/i), "Something");
    await user.click(screen.getByRole("button", { name: /create work item/i }));

    expect(await screen.findByText("title must be at most 200 characters")).toBeInTheDocument();
    // The user's input is preserved after the failure.
    expect(screen.getByLabelText(/title/i)).toHaveValue("Something");
  });

  it("prevents a double submission while the request is in flight", async () => {
    const mock = installFetchMock();
    let resolveCreate: ((reply: MockReply) => void) | undefined;
    const pending = new Promise<MockReply>((resolve) => {
      resolveCreate = resolve;
    });
    mock.on("POST", "/items", () => pending);
    const created = makeItem({ id: "88888888-8888-4888-8888-888888888888", title: "Only once" });
    mock.on("GET", ITEM_PATH, () => ({ status: 200, body: created }));
    await renderCreatePage(mock);
    const user = userEvent.setup();

    await user.type(screen.getByLabelText(/title/i), "Only once");
    const submit = screen.getByRole("button", { name: /create work item/i });
    await user.click(submit);

    const pendingButton = await screen.findByRole("button", { name: /creating/i });
    expect(pendingButton).toBeDisabled();
    await user.click(pendingButton);

    resolveCreate?.({ status: 201, body: created });
    await waitFor(() => expect(mock.requestsFor("POST", "/items")).toHaveLength(1));
  });

  it("reuses the same idempotency key when retrying an unchanged request", async () => {
    const mock = installFetchMock();
    let attempt = 0;
    mock.on("POST", "/items", () => {
      attempt += 1;
      if (attempt === 1) return { status: 500, body: { error: "Internal server error" } };
      return { status: 201, body: makeItem({ title: "Retry me" }) };
    });
    mock.on("GET", ITEM_PATH, () => ({ status: 200, body: makeItem({ title: "Retry me" }) }));
    await renderCreatePage(mock);
    const user = userEvent.setup();

    await user.type(screen.getByLabelText(/title/i), "Retry me");
    await user.click(screen.getByRole("button", { name: /create work item/i }));
    await findToast("alert", /internal server error/i);

    await user.click(screen.getByRole("button", { name: /create work item/i }));
    await waitFor(() => expect(mock.requestsFor("POST", "/items")).toHaveLength(2));

    const [first, second] = mock.requestsFor("POST", "/items");
    expect(second.headers["Idempotency-Key"]).toBe(first.headers["Idempotency-Key"]);
  });

  it("generates a new idempotency key when the payload changes", async () => {
    const mock = installFetchMock();
    mock.on("POST", "/items", () => ({ status: 500, body: { error: "Internal server error" } }));
    await renderCreatePage(mock);
    const user = userEvent.setup();

    await user.type(screen.getByLabelText(/title/i), "First title");
    await user.click(screen.getByRole("button", { name: /create work item/i }));
    await findToast("alert", /internal server error/i);

    const title = screen.getByLabelText(/title/i);
    await user.clear(title);
    await user.type(title, "Second title");
    await user.click(screen.getByRole("button", { name: /create work item/i }));
    await waitFor(() => expect(mock.requestsFor("POST", "/items")).toHaveLength(2));

    const [first, second] = mock.requestsFor("POST", "/items");
    expect(second.headers["Idempotency-Key"]).not.toBe(first.headers["Idempotency-Key"]);
  });

  it("explains when the user has no role that permits creating items", async () => {
    const mock = installFetchMock();
    setSession(true);
    mockSession(mock, {
      memberships: [{ teamId: TEAM_PAYMENTS, teamName: "Payments", teamSlug: "payments", role: "VIEWER" }],
    });

    renderApp({ route: "/items/new" });

    expect(await screen.findByText(/can't create work items/i)).toBeInTheDocument();
    expect(mock.requestsFor("POST", "/items")).toHaveLength(0);
  });
});
