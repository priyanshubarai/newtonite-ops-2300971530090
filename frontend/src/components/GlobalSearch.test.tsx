import { describe, expect, it } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { installFetchMock } from "../test/mockFetch";
import { makeItem, mockItemList, mockSession } from "../test/fixtures";
import { renderApp } from "../test/renderApp";
import { setSession } from "../auth/tokenStore";

/**
 * The global header search.
 *
 * It used to be a `readOnly` input that hard-navigated to /items on click, so it
 * could not accept typing and every interaction reloaded the app (which in turn
 * flashed the login screen). These tests pin the replacement contract: a real
 * input that holds its own text, routes through the router, and sends the query
 * to the server with the existing `?search=` contract.
 */
describe("global search", () => {
  it("accepts typing and keeps focus", async () => {
    const mock = installFetchMock();
    mockSession(mock);
    mockItemList(mock, [makeItem()]);
    setSession(true);
    const user = userEvent.setup();

    renderApp({ route: "/overview" });
    await screen.findByText("Total Items");

    const input = screen.getByLabelText(/search work items/i);
    await user.click(input);
    await user.keyboard("latency");

    expect(input).toHaveFocus();
    expect(input).toHaveValue("latency");
  });

  it("retains the query across unrelated rerenders", async () => {
    const mock = installFetchMock();
    mockSession(mock);
    mockItemList(mock, [makeItem()]);
    setSession(true);
    const user = userEvent.setup();

    const { queryClient } = renderApp({ route: "/overview" });
    await screen.findByText("Total Items");

    const input = screen.getByLabelText(/search work items/i);
    await user.click(input);
    await user.keyboard("checkout");

    // Force a re-render of the whole tree the way a background refetch would.
    await queryClient.invalidateQueries();

    await waitFor(() => expect(input).toHaveValue("checkout"));
  });

  it("submitting sends the query to the server with the ?search= contract", async () => {
    const mock = installFetchMock();
    mockSession(mock);
    mockItemList(mock, [
      makeItem({ id: "55555555-5555-4555-8555-555555555555", title: "Latency spike on checkout" }),
    ]);
    setSession(true);
    const user = userEvent.setup();

    renderApp({ route: "/overview" });
    await screen.findByText("Total Items");

    const input = screen.getByLabelText(/search work items/i);
    await user.click(input);
    await user.keyboard("latency{Enter}");

    // The request must carry the query server-side rather than filtering a
    // fully-downloaded list in the browser.
    await waitFor(() => {
      const requests = mock.requestsFor("GET", "/items");
      const withSearch = requests.filter((r) => r.query.get("search") === "latency");
      expect(withSearch.length).toBeGreaterThan(0);
    });

    expect(await screen.findByRole("heading", { level: 1, name: /^work items$/i })).toBeInTheDocument();
    expect(await screen.findByText(/latency spike on checkout/i)).toBeInTheDocument();
  });

  it("does not navigate away from an unrelated page on a stray keystroke", async () => {
    const mock = installFetchMock();
    mockSession(mock);
    mockItemList(mock, [makeItem()]);
    setSession(true);
    const user = userEvent.setup();

    renderApp({ route: "/overview" });
    await screen.findByText("Total Items");

    const input = screen.getByLabelText(/search work items/i);
    await user.click(input);
    await user.keyboard("lat");

    // Typing alone must not yank the user off the page they are reading: the
    // overview stays put and the list page's own h1 never appears. (Matching on
    // role+level avoids the overview's "Latest Work Items" h2.)
    expect(await screen.findByText("Latest Work Items")).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { level: 1, name: /^work items$/i }),
    ).not.toBeInTheDocument();
    expect(input).toHaveValue("lat");
  });

  it("shows an empty result without discarding the query", async () => {
    const mock = installFetchMock();
    mockSession(mock);
    mockItemList(mock, []);
    setSession(true);
    const user = userEvent.setup();

    renderApp({ route: "/overview" });
    await screen.findByText("Total Items");

    const input = screen.getByLabelText(/search work items/i);
    await user.click(input);
    await user.keyboard("nothing-matches-this{Enter}");

    await screen.findByRole("heading", { level: 1, name: /^work items$/i });
    expect(await screen.findByText(/no items match your filters/i)).toBeInTheDocument();

    // A failed/empty search must not clear what the user typed.
    expect(input).toHaveValue("nothing-matches-this");
  });

  it("keeps the input usable after the request fails", async () => {
    const mock = installFetchMock();
    mockSession(mock);
    mock.on("GET", "/items", () => ({ status: 500, body: { error: "Internal server error" } }));
    setSession(true);
    const user = userEvent.setup();

    renderApp({ route: "/items" });
    await screen.findByRole("heading", { level: 1, name: /^work items$/i });

    const input = screen.getByLabelText(/search work items/i);
    await user.click(input);
    await user.keyboard("latency");

    // The search surface reports the failure but the header stays interactive and
    // the user's query survives it.
    await waitFor(() => expect(mock.requestsFor("GET", "/items").length).toBeGreaterThan(0));
    expect(input).toHaveValue("latency");
    await user.keyboard(" spike");
    expect(input).toHaveValue("latency spike");
    expect(input).toHaveFocus();
  });

  it("debounces requests while the user types on the list page", async () => {
    const mock = installFetchMock();
    mockSession(mock);
    mockItemList(mock, [makeItem()]);
    setSession(true);
    const user = userEvent.setup();

    renderApp({ route: "/items" });
    await screen.findByRole("heading", { level: 1, name: /^work items$/i });

    const baseline = mock.requestsFor("GET", "/items").length;

    const input = screen.getByLabelText(/search work items/i);
    await user.click(input);
    // Six keystrokes in quick succession must not become six requests.
    await user.keyboard("alphaa");

    // Wait for the debounced query to actually reach the server.
    await waitFor(() => {
      const withQuery = mock
        .requestsFor("GET", "/items")
        .filter((r) => r.query.get("search") === "alphaa");
      expect(withQuery.length).toBeGreaterThan(0);
    });

    // The field keeps what the user typed while the URL carries the same query.
    expect(input).toHaveValue("alphaa");

    // The whole burst collapses into a single debounced request, not one per key.
    const after = mock.requestsFor("GET", "/items").length;
    expect(after - baseline).toBeLessThanOrEqual(2);
    expect(after - baseline).toBeLessThan(6);
  });
});
