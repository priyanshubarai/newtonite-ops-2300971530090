import { describe, expect, it } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { installFetchMock } from "../test/mockFetch";
import {
  LEAD_MEMBERSHIP,
  MEMBER_MEMBERSHIP,
  TEST_USER,
  VIEWER_MEMBERSHIP,
  makeItem,
  mockSession,
} from "../test/fixtures";
import { renderApp } from "../test/renderApp";
import { setToken } from "../auth/tokenStore";

const ITEM_PATH = /^\/items\/[0-9a-f-]{36}$/;

async function renderDetail(
  mock: ReturnType<typeof installFetchMock>,
  item = makeItem(),
  memberships = [LEAD_MEMBERSHIP],
) {
  setToken("session-token");
  mockSession(mock, { memberships });
  mock.on("GET", ITEM_PATH, () => ({ status: 200, body: item }));
  renderApp({ route: `/items/${item.id}` });
  await screen.findByRole("heading", { name: item.title });
}

describe("ItemDetailPage", () => {
  it("renders the item's details", async () => {
    const mock = installFetchMock();
    const item = makeItem({ description: "Checkout error rate is elevated." });

    await renderDetail(mock, item);

    expect(screen.getByText("Checkout error rate is elevated.")).toBeInTheDocument();
    expect(screen.getByText("Payments")).toBeInTheDocument();
    expect(screen.getByText("Unassigned")).toBeInTheDocument();
    // No activity-read endpoint exists; none is requested.
    expect(mock.calls.every((call) => !call.path.includes("activity"))).toBe(true);
  });

  it("claims an unassigned item and refreshes the view", async () => {
    const mock = installFetchMock();
    const item = makeItem({ status: "OPEN", assigneeId: null });
    const claimed = makeItem({ status: "OPEN", assigneeId: TEST_USER.id, version: 2 });
    await renderDetail(mock, item);
    mock.on("POST", `${"/items/" + item.id}/claim`, () => ({ status: 200, body: claimed }));
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: /claim this item/i }));

    await waitFor(() => expect(mock.requestsFor("POST", `/items/${item.id}/claim`)).toHaveLength(1));
    expect(mock.requestsFor("POST", `/items/${item.id}/claim`)[0].headers["Idempotency-Key"]).toBeTruthy();
    expect(await screen.findByText(/you claimed this work item/i)).toBeInTheDocument();
    expect(screen.queryByText("Unassigned")).not.toBeInTheDocument();
  });

  it("treats a lost claim race as a recoverable conflict", async () => {
    const mock = installFetchMock();
    const item = makeItem({ status: "OPEN", assigneeId: null });
    await renderDetail(mock, item);
    mock.on("POST", `/items/${item.id}/claim`, () => ({
      status: 409,
      body: { error: "Item already assigned", code: "ALREADY_ASSIGNED" },
    }));
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: /claim this item/i }));

    expect(await screen.findByText(/claimed this item first/i)).toBeInTheDocument();
    // The item is re-fetched so the user sees the current state.
    await waitFor(() => expect(mock.requestsFor("GET", `/items/${item.id}`).length).toBeGreaterThan(1));
  });

  it("does not offer a claim for an already-assigned or unclaimable item", async () => {
    const mock = installFetchMock();
    await renderDetail(mock, makeItem({ status: "OPEN", assigneeId: TEST_USER.id }));

    expect(screen.queryByRole("button", { name: /claim this item/i })).not.toBeInTheDocument();
  });

  it("offers the next workflow step and submits the current version", async () => {
    const mock = installFetchMock();
    const item = makeItem({ status: "OPEN", version: 1 });
    const moved = makeItem({ status: "IN_PROGRESS", version: 2 });
    await renderDetail(mock, item, [MEMBER_MEMBERSHIP]);
    mock.on("POST", `/items/${item.id}/transition`, () => ({ status: 200, body: moved }));
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: /start progress/i }));

    await waitFor(() => expect(mock.requestsFor("POST", `/items/${item.id}/transition`)).toHaveLength(1));
    const request = mock.requestsFor("POST", `/items/${item.id}/transition`)[0];
    expect(request.body).toEqual({ toStatus: "IN_PROGRESS", expectedVersion: 1 });
    expect(await screen.findByText(/moved to in progress/i)).toBeInTheDocument();
  });

  it("hides approval from a member", async () => {
    const mock = installFetchMock();
    await renderDetail(mock, makeItem({ status: "AWAITING_APPROVAL" }), [MEMBER_MEMBERSHIP]);

    expect(screen.queryByRole("button", { name: /approve & resolve/i })).not.toBeInTheDocument();
    expect(screen.getByText(/requires a team lead or admin/i)).toBeInTheDocument();
  });

  it("shows approval to a lead", async () => {
    const mock = installFetchMock();
    await renderDetail(mock, makeItem({ status: "AWAITING_APPROVAL" }), [LEAD_MEMBERSHIP]);

    expect(screen.getByRole("button", { name: /approve & resolve/i })).toBeInTheDocument();
  });

  it("offers no actions to a viewer", async () => {
    const mock = installFetchMock();
    await renderDetail(mock, makeItem({ status: "OPEN", assigneeId: null }), [VIEWER_MEMBERSHIP]);

    expect(screen.queryByRole("button", { name: /claim this item/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /start progress/i })).not.toBeInTheDocument();
  });

  it("surfaces a stale-version transition as a reload prompt", async () => {
    const mock = installFetchMock();
    const item = makeItem({ status: "OPEN", version: 1 });
    await renderDetail(mock, item, [MEMBER_MEMBERSHIP]);
    mock.on("POST", `/items/${item.id}/transition`, () => ({
      status: 409,
      body: { error: "Version conflict", code: "STALE_VERSION" },
    }));
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: /start progress/i }));

    expect(await screen.findByText(/changed since the page was loaded/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /reload latest version/i })).toBeInTheDocument();
  });

  it("explains an invalid transition", async () => {
    const mock = installFetchMock();
    const item = makeItem({ status: "OPEN" });
    await renderDetail(mock, item, [MEMBER_MEMBERSHIP]);
    mock.on("POST", `/items/${item.id}/transition`, () => ({
      status: 409,
      body: { error: "Invalid workflow transition", code: "INVALID_TRANSITION" },
    }));
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: /start progress/i }));

    expect(await screen.findByText(/no longer valid for this item/i)).toBeInTheDocument();
  });

  it("reports a permission failure from the server", async () => {
    const mock = installFetchMock();
    const item = makeItem({ status: "AWAITING_APPROVAL" });
    await renderDetail(mock, item, [LEAD_MEMBERSHIP]);
    mock.on("POST", `/items/${item.id}/transition`, () => ({
      status: 403,
      body: { error: "Forbidden" },
    }));
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: /approve & resolve/i }));

    expect(await screen.findByText(/only a team lead or admin can approve/i)).toBeInTheDocument();
  });

  it("shows a terminal message for a closed item", async () => {
    const mock = installFetchMock();
    await renderDetail(mock, makeItem({ status: "CLOSED" }));

    expect(screen.getByText(/no further transitions are available/i)).toBeInTheDocument();
  });

  it("offers an edit link only when the role permits it", async () => {
    const mock = installFetchMock();
    await renderDetail(mock, makeItem(), [VIEWER_MEMBERSHIP]);

    expect(screen.queryByRole("link", { name: /^edit$/i })).not.toBeInTheDocument();
  });
});
