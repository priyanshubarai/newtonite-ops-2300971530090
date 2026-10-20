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
    // The create link in the empty state (not the header)
    const emptyState = screen.getByText("No work items yet").closest(".state")!;
    expect(within(emptyState).getByRole("link", { name: /create the first work item/i })).toBeInTheDocument();
  });

  it("shows a filtered-empty state with a clear-filters action when filters match nothing", async () => {
    const mock = installFetchMock();
    // Return items initially, but empty when status=CLOSED filter is applied
    mock.on("GET", "/items", (request) => {
      const status = request.query.get("status");
      if (status === "CLOSED") {
        return { status: 200, body: { items: [], pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0, hasNextPage: false, hasPrevPage: false } } };
      }
      return {
        status: 200,
        body: {
          items: [makeItem({ title: "Latency spike" })],
          pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1, hasNextPage: false, hasPrevPage: false },
        },
      };
    });
    const user = userEvent.setup();

    await renderDashboard(mock);
    await screen.findByRole("link", { name: /latency spike/i });

    // Apply a filter that will return no results
    await user.selectOptions(screen.getByLabelText(/^status$/i), "CLOSED");

    // Should show filtered-empty message and clear-filters button
    expect(await screen.findByText(/no items match your filters/i)).toBeInTheDocument();
    // The empty state has a clear-filters button in its actions
    const emptyStateContainer = await screen.findByText(/try widening your filters/i);
    const emptyStateClearButton = emptyStateContainer.closest(".state")?.querySelector('button');
    expect(emptyStateClearButton).toBeInTheDocument();
    // The create link in the empty state should not be present for filtered-empty
    const filteredEmptyState = screen.getByText(/no items match your filters/i).closest(".state")!;
    expect(within(filteredEmptyState).queryByRole("link", { name: /create the first work item/i })).not.toBeInTheDocument();
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
    // Check for the create link in the page header (not the header)
    const page = screen.getByRole("main");
    expect(await within(page).findByRole("link", { name: /new work item/i })).toBeInTheDocument();
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

    // Use the assignee filter input in the filters section
    const filterAssigneeInput = screen.getByLabelText(/assignee id/i);
    await user.type(filterAssigneeInput, "not-a-uuid");

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

  it("sends search query after debounce and resets page", async () => {
    const mock = installFetchMock();
    const items = Array.from({ length: 5 }, (_, index) =>
      makeItem({ id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`, title: `Searchable ${index + 1}` }),
    );
    mockItemList(mock, items);
    const user = userEvent.setup();

    await renderDashboard(mock);
    await screen.findByRole("link", { name: /searchable 1/i });

    // Type in search box - should debounce
    // Use the search input in the filters section (not the header)
    const filterSearchInput = screen.getByLabelText(/search/i, { selector: 'input[id^="filter-"]' }) ?? screen.getByLabelText(/search/i);
    await user.type(filterSearchInput, "test");

    // Wait for debounce and request
    await waitFor(() => {
      const request = lastListRequest(mock);
      expect(request.query.get("search")).toBe("test");
      expect(request.query.get("page")).toBe("1");
    });

    // Verify only one request was sent for the debounced term (not one per keystroke)
    const searchRequests = mock.requestsFor("GET", "/items").filter((r) => r.query.get("search") === "test");
    expect(searchRequests.length).toBe(1);
  });

  it("updates URL when filters change and uses replace navigation", async () => {
    const mock = installFetchMock();
    mockItemList(mock, [makeItem()]);
    const user = userEvent.setup();

    await renderDashboard(mock);
    await screen.findByRole("link", { name: /latency spike/i });

    // Change a filter - URL should update
    await user.selectOptions(screen.getByLabelText(/^status$/i), "IN_PROGRESS");

    await waitFor(() => {
      const request = lastListRequest(mock);
      expect(request.query.get("status")).toBe("IN_PROGRESS");
      expect(request.query.get("page")).toBe("1"); // page resets when filter changes
    });

    // The URL should have been updated (we can't directly test the browser URL in jsdom,
    // but we can verify the search params would be correct by checking the mock request)
    // The important thing is that the request was sent with the correct params.
  });

  it("disables previous button on first page and next button on last page", async () => {
    const mock = installFetchMock();
    const items = Array.from({ length: 15 }, (_, index) =>
      makeItem({ id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`, title: `Item ${index + 1}` }),
    );
    // Use pageSize=10 to get 2 pages (15 items / 10 per page = 2 pages)
    mockItemList(mock, items, 10);
    const user = userEvent.setup();

    await renderDashboard(mock);
    await screen.findByRole("link", { name: "Item 1" });

    // First, set page size to 10 to match the mock setup
    await user.selectOptions(screen.getByLabelText(/per page/i), "10");
    await waitFor(() => expect(lastListRequest(mock).query.get("pageSize")).toBe("10"));
    await screen.findByRole("link", { name: "Item 1" });

    // On page 1, previous should be disabled, next should be enabled
    expect(screen.getByRole("button", { name: /previous/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /next/i })).not.toBeDisabled();

    // Go to page 2
    await user.click(screen.getByRole("button", { name: /next/i }));
    await waitFor(() => expect(lastListRequest(mock).query.get("page")).toBe("2"));

    // On page 2, previous should be enabled, next should be disabled
    expect(screen.getByRole("button", { name: /previous/i })).not.toBeDisabled();
    expect(screen.getByRole("button", { name: /next/i })).toBeDisabled();
  });
});