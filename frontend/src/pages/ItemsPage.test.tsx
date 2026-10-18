import { describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { installFetchMock } from "../test/mockFetch";
import {
  LEAD_MEMBERSHIP,
  VIEWER_MEMBERSHIP,
  TEAM_PAYMENTS,
  makeItem,
  mockItemList,
  mockSession,
} from "../test/fixtures";
import { renderApp } from "../test/renderApp";
import { setToken } from "../auth/tokenStore";

function lastListRequest(mock: ReturnType<typeof installFetchMock>) {
  const requests = mock.requestsFor("GET", "/items");
  return requests[requests.length - 1];
}

async function renderDashboard(mock: ReturnType<typeof installFetchMock>) {
  setToken("session-token");
  mockSession(mock);
  renderApp({ route: "/items" });
  await screen.findByRole("heading", { name: /work items/i });
}

describe("ItemsPage", () => {
  it("renders work-item rows from the server response", async () => {
    const mock = installFetchMock();
    mockItemList(mock, [
      makeItem({ title: "Latency spike" }),
      makeItem({ id: "55555555-5555-4555-8555-555555555555", title: "Refund glitch", priority: "CRITICAL", status: "IN_PROGRESS" }),
    ]);

    await renderDashboard(mock);

    const table = await screen.findByRole("table");
    expect(within(table).getByRole("link", { name: "Latency spike" })).toBeInTheDocument();
    expect(within(table).getByRole("link", { name: "Refund glitch" })).toBeInTheDocument();
    // Team id is resolved to a readable name from the membership list.
    expect(within(table).getAllByText("Payments").length).toBeGreaterThan(0);
    expect(screen.getByText(/Showing/)).toHaveTextContent("1");
  });

  it("shows an empty state with a create action when there are no items", async () => {
    const mock = installFetchMock();
    mockItemList(mock, []);

    await renderDashboard(mock);

    expect(await screen.findByText("No work items yet")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /create the first work item/i })).toBeInTheDocument();
  });

  it("shows a recoverable error state when the list request fails", async () => {
    const mock = installFetchMock();
    mock.on("GET", "/items", () => ({ status: 500, body: { error: "Internal server error" } }));

    await renderDashboard(mock);

    expect(await screen.findByText(/couldn't load work items/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
  });

  it("requests the server for each page and resets to page 1 when filters change", async () => {
    const mock = installFetchMock();
    const items = Array.from({ length: 25 }, (_, index) =>
      makeItem({ id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`, title: `Item ${index + 1}` }),
    );
    mockItemList(mock, items);
    const user = userEvent.setup();

    await renderDashboard(mock);
    await screen.findByRole("link", { name: "Item 1" });

    expect(lastListRequest(mock).query.get("page")).toBe("1");

    await user.click(screen.getByRole("button", { name: /next/i }));
    await waitFor(() => expect(lastListRequest(mock).query.get("page")).toBe("2"));

    await user.selectOptions(screen.getByLabelText(/^status$/i), "OPEN");
    await waitFor(() => {
      const request = lastListRequest(mock);
      expect(request.query.get("page")).toBe("1");
      expect(request.query.get("status")).toBe("OPEN");
    });
  });

  it("never sends a page size above the API maximum", async () => {
    const mock = installFetchMock();
    mockItemList(mock, [makeItem()]);
    const user = userEvent.setup();

    await renderDashboard(mock);
    await screen.findByRole("link", { name: /latency spike/i });

    // The offered options are all within the contract; the largest is 100.
    const perPage = screen.getByLabelText(/per page/i);
    const options = within(perPage).getAllByRole("option").map((option) => Number(option.getAttribute("value")));
    expect(Math.max(...options)).toBeLessThanOrEqual(100);

    await user.selectOptions(perPage, "100");
    await waitFor(() => expect(lastListRequest(mock).query.get("pageSize")).toBe("100"));
  });

  it("offers the create action only when a role permits it", async () => {
    const leadMock = installFetchMock();
    mockItemList(leadMock, []);
    await renderDashboard(leadMock);
    expect(await screen.findByRole("link", { name: /new work item/i })).toBeInTheDocument();
  });

  it("hides the create action for a viewer", async () => {
    const mock = installFetchMock();
    mockItemList(mock, []);
    setToken("session-token");
    mockSession(mock, { memberships: [VIEWER_MEMBERSHIP] });

    renderApp({ route: "/items" });

    await screen.findByText("No work items yet");
    expect(screen.queryByRole("link", { name: /new work item/i })).not.toBeInTheDocument();
  });

  it("does not send an invalid assignee id as a filter", async () => {
    const mock = installFetchMock();
    mockItemList(mock, [makeItem()]);
    const user = userEvent.setup();

    await renderDashboard(mock);
    await screen.findByRole("link", { name: /latency spike/i });

    await user.type(screen.getByLabelText(/assignee id/i), "not-a-uuid");

    expect(await screen.findByText(/enter a full user id/i)).toBeInTheDocument();
    await waitFor(() => expect(lastListRequest(mock)).toBeTruthy());
    expect(lastListRequest(mock).query.has("assigneeId")).toBe(false);
  });

  it("filters by team using the membership's team id", async () => {
    const mock = installFetchMock();
    mockItemList(mock, [makeItem()]);
    const user = userEvent.setup();

    await renderDashboard(mock);
    await screen.findByRole("link", { name: /latency spike/i });

    await user.selectOptions(screen.getByLabelText(/^team$/i), TEAM_PAYMENTS);

    await waitFor(() => expect(lastListRequest(mock).query.get("teamId")).toBe(TEAM_PAYMENTS));
    expect(mock.requestsFor("GET", "/items").length).toBeGreaterThan(1);
  });

  it("uses the lead membership for role resolution", () => {
    expect(LEAD_MEMBERSHIP.role).toBe("LEAD");
    expect(TEAM_PAYMENTS).toHaveLength(36);
  });
});
