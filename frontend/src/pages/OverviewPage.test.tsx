import { describe, expect, it } from "vitest";
import { screen, within } from "@testing-library/react";
import { installFetchMock } from "../test/mockFetch";
import { TEST_USER, makeItem, mockItemList, mockSession } from "../test/fixtures";
import { renderApp } from "../test/renderApp";
import { setToken } from "../auth/tokenStore";

async function renderOverview(mock: ReturnType<typeof installFetchMock>) {
  setToken("session-token");
  mockSession(mock);
  renderApp({ route: "/overview" });
  // The table is the last thing to render, so waiting for it means the metric
  // row above it has resolved too.
  await screen.findByRole("table");
}

describe("OverviewPage metric cards", () => {
  it("renders the four metric cards from the fetched items", async () => {
    const mock = installFetchMock();
    mockItemList(mock, [
      makeItem({ id: "11111111-1111-4111-8111-111111111111", title: "Mine", assigneeId: TEST_USER.id, priority: "HIGH" }),
      makeItem({ id: "22222222-2222-4222-8222-222222222222", title: "Critical", assigneeId: null, priority: "CRITICAL" }),
      makeItem({ id: "33333333-3333-4333-8333-333333333333", title: "Done", assigneeId: null, priority: "LOW", status: "RESOLVED" }),
      makeItem({ id: "44444444-4444-4444-8444-444444444444", title: "Quiet", assigneeId: null, priority: "LOW" }),
    ]);

    await renderOverview(mock);

    for (const title of ["Total Items", "My Items", "Urgent", "Completed"]) {
      expect(screen.getByText(title)).toBeInTheDocument();
    }

    // Each metric reads as a labelled group, so the number is not orphaned.
    const total = screen.getByRole("group", { name: "Total Items" });
    expect(within(total).getByText("4")).toBeInTheDocument();

    expect(within(screen.getByRole("group", { name: "My Items" })).getByText("1")).toBeInTheDocument();
    // HIGH + CRITICAL
    expect(within(screen.getByRole("group", { name: "Urgent" })).getByText("2")).toBeInTheDocument();
    // RESOLVED
    expect(within(screen.getByRole("group", { name: "Completed" })).getByText("1")).toBeInTheDocument();
  });

  it("never shows a fabricated trend percentage", async () => {
    const mock = installFetchMock();
    mockItemList(mock, [makeItem()]);

    await renderOverview(mock);

    // The old implementation hardcoded "+12%", "+5%", "-3%" and "+22%" with no
    // comparison data behind them. Nothing in the metric row may claim a period
    // comparison, and the trend arrow that accompanied it must be gone.
    expect(screen.queryByText(/\+\d+%/)).not.toBeInTheDocument();
    expect(screen.queryByText(/-\d+%/)).not.toBeInTheDocument();
    expect(screen.queryByText(/vs last period/i)).not.toBeInTheDocument();
  });

  it("captions a first-page count as a recent window, not a whole total", async () => {
    const mock = installFetchMock();
    // 25 items with a page size of 20: the counts below only cover the first 20,
    // so the caption must not imply it is the total.
    mockItemList(
      mock,
      Array.from({ length: 25 }, (_, index) =>
        makeItem({
          id: `${String(index).padStart(8, "0")}-0000-4000-8000-000000000000`,
          title: `Item ${index}`,
          status: "RESOLVED",
        }),
      ),
    );

    await renderOverview(mock);

    // All three first-page counts share the same caption wording; assert against
    // one specific card rather than the whole document.
    expect(within(screen.getByRole("group", { name: "Completed" })).getByText("20 of the 20 most recent")).toBeInTheDocument();
    expect(within(screen.getByRole("group", { name: "Completed" })).getByText("20")).toBeInTheDocument();
    // Total Items is the server's true count, which here exceeds the page.
    expect(within(screen.getByRole("group", { name: "Total Items" })).getByText("25")).toBeInTheDocument();
  });

  it("does not claim a share of the backlog when the list is empty", async () => {
    const mock = installFetchMock();
    mockItemList(mock, []);

    setToken("session-token");
    mockSession(mock);
    renderApp({ route: "/overview" });

    // The metric row renders even with no items, with zeroes and an honest
    // caption rather than a share of a backlog that does not exist.
    expect(await screen.findByText("Total Items")).toBeInTheDocument();
    expect(within(screen.getByRole("group", { name: "Total Items" })).getByText("0")).toBeInTheDocument();
    expect(screen.getAllByText("Nothing here yet").length).toBeGreaterThan(0);
  });
});
