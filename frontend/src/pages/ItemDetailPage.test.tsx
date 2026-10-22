import { describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
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
import { setSession } from "../auth/tokenStore";

/** Helper to find Sonner toasts which render in a portal on document.body */
function findToast(role: "alert" | "status", name: RegExp) {
  // Sonner toasts render in a portal on document.body
  // The toast element has data-sonner-toast attribute and contains an element with the role
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

const ITEM_PATH = /^\/items\/[0-9a-f-]{36}$/;

async function renderDetail(
  mock: ReturnType<typeof installFetchMock>,
  item = makeItem(),
  memberships = [LEAD_MEMBERSHIP],
) {
  setSession(true);
  mockSession(mock, { memberships });
  mock.on("GET", ITEM_PATH, () => ({ status: 200, body: item }));
  // Mock activity endpoint to return empty activity by default
  mock.on("GET", new RegExp(`/items/${item.id}/activity`), () => ({
    status: 200,
    body: { items: [], pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0, hasNextPage: false, hasPrevPage: false } },
  }));
  // Mock comments endpoint to return empty comments by default
  mock.on("GET", new RegExp(`/items/${item.id}/comments`), () => ({
    status: 200,
    body: { items: [], pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0, hasNextPage: false, hasPrevPage: false } },
  }));
  renderApp({ route: `/items/${item.id}` });
  await screen.findByRole("heading", { name: item.title });
}

describe("ItemDetailPage", () => {
  it("renders the item's details", async () => {
    const mock = installFetchMock();
    const item = makeItem({ description: "Checkout error rate is elevated." });

    await renderDetail(mock, item);

    expect(screen.getByText("Checkout error rate is elevated.")).toBeInTheDocument();
    // Scope to main content to avoid sidebar team names
    const main = screen.getByRole("main");
    expect(within(main).getByText("Payments")).toBeInTheDocument();
    expect(within(main).getByText("Unassigned")).toBeInTheDocument();
    // Activity is now requested.
    expect(mock.calls.some((call) => call.path.includes("activity"))).toBe(true);
  });

  it("claims an unassigned item and refreshes the view", async () => {
    const mock = installFetchMock();
    const item = makeItem({ status: "OPEN", assigneeId: null });
    const claimed = makeItem({ status: "OPEN", assigneeId: TEST_USER.id, version: 2 });
    await renderDetail(mock, item);
    mock.on("POST", `/items/${item.id}/claim`, () => ({ status: 200, body: claimed }));
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

    // The error appears in a Sonner toast
    expect(await findToast("alert", /changed since the page was loaded/i)).toBeInTheDocument();
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

    // Error message should appear in a Sonner toast
    expect(await findToast("alert", /no longer valid for this item/i)).toBeInTheDocument();
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

  it("handles claim failure due to network error gracefully", async () => {
    const mock = installFetchMock();
    const item = makeItem({ status: "OPEN", assigneeId: null });
    await renderDetail(mock, item);
    // Simulate a network failure
    mock.on("POST", `/items/${item.id}/claim`, () => {
      throw new TypeError("Failed to fetch");
    });
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: /claim this item/i }));

    // Request should be attempted
    await waitFor(() => expect(mock.requestsFor("POST", `/items/${item.id}/claim`)).toHaveLength(1));
  });

  it("handles claim failure with server error gracefully", async () => {
    const mock = installFetchMock();
    const item = makeItem({ status: "OPEN", assigneeId: null });
    await renderDetail(mock, item);
    mock.on("POST", `/items/${item.id}/claim`, () => ({
      status: 500,
      body: { error: "Internal server error" },
    }));
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: /claim this item/i }));

    // Request should be attempted
    await waitFor(() => expect(mock.requestsFor("POST", `/items/${item.id}/claim`)).toHaveLength(1));
  });

  it("handles transition failure due to network error gracefully", async () => {
    const mock = installFetchMock();
    const item = makeItem({ status: "OPEN", version: 1 });
    await renderDetail(mock, item, [MEMBER_MEMBERSHIP]);
    mock.on("POST", `/items/${item.id}/transition`, () => {
      throw new TypeError("Failed to fetch");
    });
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: /start progress/i }));

    // Request should be attempted
    await waitFor(() => expect(mock.requestsFor("POST", `/items/${item.id}/transition`)).toHaveLength(1));
  });

  it("handles transition failure with server error gracefully", async () => {
    const mock = installFetchMock();
    const item = makeItem({ status: "OPEN", version: 1 });
    await renderDetail(mock, item, [MEMBER_MEMBERSHIP]);
    mock.on("POST", `/items/${item.id}/transition`, () => ({
      status: 500,
      body: { error: "Internal server error" },
    }));
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: /start progress/i }));

    // Request should be attempted
    await waitFor(() => expect(mock.requestsFor("POST", `/items/${item.id}/transition`)).toHaveLength(1));
  });

  it("reuses the same idempotency key when the claim button is clicked rapidly", async () => {
    const mock = installFetchMock();
    const item = makeItem({ status: "OPEN", assigneeId: null });
    const claimed = makeItem({ status: "OPEN", assigneeId: TEST_USER.id, version: 2 });
    await renderDetail(mock, item);
    mock.on("POST", `/items/${item.id}/claim`, () => ({ status: 200, body: claimed }));
    const user = userEvent.setup();

    const claimButton = screen.getByRole("button", { name: /claim this item/i });
    await user.click(claimButton);
    await user.click(claimButton); // Rapid second click

    await waitFor(() => expect(mock.requestsFor("POST", `/items/${item.id}/claim`)).toHaveLength(1));
    expect(mock.requestsFor("POST", `/items/${item.id}/claim`)[0].headers["Idempotency-Key"]).toBeTruthy();
  });

  it("reuses the same idempotency key when the transition button is clicked rapidly", async () => {
    const mock = installFetchMock();
    const item = makeItem({ status: "OPEN", version: 1 });
    let resolveTransition: (value: { status: number; body: unknown }) => void = () => {};
    const transitionPromise = new Promise<{ status: number; body: unknown }>((resolve) => {
      resolveTransition = resolve;
    });
    mock.on("POST", `/items/${item.id}/transition`, () => transitionPromise);
    const moved = makeItem({ status: "IN_PROGRESS", version: 2 });
    await renderDetail(mock, item, [MEMBER_MEMBERSHIP]);
    const user = userEvent.setup();

    const transitionButton = screen.getByRole("button", { name: /start progress/i });
    await user.click(transitionButton);
    // Rapid second click before first completes
    await user.click(transitionButton);

    // Resolve the first request
    resolveTransition({ status: 200, body: moved });

    await waitFor(() => {
      expect(mock.requestsFor("POST", `/items/${item.id}/transition`)).toHaveLength(1);
      expect(mock.requestsFor("POST", `/items/${item.id}/transition`)[0].headers["Idempotency-Key"]).toBeTruthy();
    });
  });

  it("handles NOT_CLAIMABLE error when item status is not claimable", async () => {
    const mock = installFetchMock();
    // Use OPEN status which is claimable, but backend returns NOT_CLAIMABLE
    const item = makeItem({ status: "OPEN", assigneeId: null });
    await renderDetail(mock, item);
    mock.on("POST", `/items/${item.id}/claim`, () => ({
      status: 409,
      body: { error: "Work item is no longer claimable", code: "NOT_CLAIMABLE" },
    }));
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: /claim this item/i }));

    expect(await screen.findByText(/can no longer be claimed/i)).toBeInTheDocument();
    // Item should be re-fetched to show current state
    await waitFor(() => expect(mock.requestsFor("GET", `/items/${item.id}`).length).toBeGreaterThan(1), { timeout: 10000 });
  });

  describe("Comment submission", () => {
    it("posts first comment successfully and clears the form", async () => {
      const mock = installFetchMock();
      const item = makeItem({ status: "OPEN" });
      await renderDetail(mock, item);

      const createdComment = {
        id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        workItemId: item.id,
        authorId: TEST_USER.id,
        body: "First comment",
        createdAt: "2026-10-21T10:00:00.000Z",
        updatedAt: "2026-10-21T10:00:00.000Z",
      };
      mock.on("POST", `/items/${item.id}/comments`, () => ({
        status: 201,
        body: { comment: createdComment },
      }));

      const user = userEvent.setup();
      const textarea = screen.getByLabelText(/add a comment/i);
      await user.type(textarea, "First comment");
      await user.click(screen.getByRole("button", { name: /post comment/i }));

      await waitFor(() => expect(mock.requestsFor("POST", `/items/${item.id}/comments`)).toHaveLength(1));
      const request = mock.requestsFor("POST", `/items/${item.id}/comments`)[0];
      expect(request.headers["Idempotency-Key"]).toBeTruthy();
      expect(request.body).toEqual({ body: "First comment" });

      // Success toast appears as a Sonner toast with role="status"
      const toast = await findToast("status", /comment added/i);
      expect(toast).toBeInTheDocument();
      // Form should be cleared
      expect(textarea).toHaveValue("");
    });

    it("posts second different comment successfully with a different idempotency key", async () => {
      const mock = installFetchMock();
      const item = makeItem({ status: "OPEN" });
      await renderDetail(mock, item);

      const comment1 = {
        id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        workItemId: item.id,
        authorId: TEST_USER.id,
        body: "First comment",
        createdAt: "2026-10-21T10:00:00.000Z",
        updatedAt: "2026-10-21T10:00:00.000Z",
      };
      const comment2 = {
        id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
        workItemId: item.id,
        authorId: TEST_USER.id,
        body: "Second comment",
        createdAt: "2026-10-21T10:01:00.000Z",
        updatedAt: "2026-10-21T10:01:00.000Z",
      };

      let callCount = 0;
      mock.on("POST", `/items/${item.id}/comments`, () => {
        callCount++;
        if (callCount === 1) {
          return { status: 201, body: { comment: comment1 } };
        }
        return { status: 201, body: { comment: comment2 } };
      });

      const user = userEvent.setup();
      const textarea = screen.getByLabelText(/add a comment/i);

      // First comment
      await user.type(textarea, "First comment");
      await user.click(screen.getByRole("button", { name: /post comment/i }));
      await waitFor(() => expect(mock.requestsFor("POST", `/items/${item.id}/comments`)).toHaveLength(1));
      const key1 = mock.requestsFor("POST", `/items/${item.id}/comments`)[0].headers["Idempotency-Key"];

      // Second comment - different text
      await user.type(textarea, "Second comment");
      await user.click(screen.getByRole("button", { name: /post comment/i }));
      await waitFor(() => expect(mock.requestsFor("POST", `/items/${item.id}/comments`)).toHaveLength(2));
      const key2 = mock.requestsFor("POST", `/items/${item.id}/comments`)[1].headers["Idempotency-Key"];

      // Keys should be different for different comment bodies
      expect(key1).not.toBe(key2);
      // Second success toast appears
      const toast = await findToast("status", /comment added/i);
      expect(toast).toBeInTheDocument();
    });

    it("reuses the same idempotency key when rapidly clicking post for the same comment", async () => {
      const mock = installFetchMock();
      const item = makeItem({ status: "OPEN" });
      await renderDetail(mock, item);

      let resolveComment: (value: { status: number; body: unknown }) => void = () => {};
      const commentPromise = new Promise<{ status: number; body: unknown }>((resolve) => {
        resolveComment = resolve;
      });
      const createdComment = {
        id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        workItemId: item.id,
        authorId: TEST_USER.id,
        body: "Rapid click comment",
        createdAt: "2026-10-21T10:00:00.000Z",
        updatedAt: "2026-10-21T10:00:00.000Z",
      };
      mock.on("POST", `/items/${item.id}/comments`, () => commentPromise);

      const user = userEvent.setup();
      const textarea = screen.getByLabelText(/add a comment/i);
      await user.type(textarea, "Rapid click comment");
      const postButton = screen.getByRole("button", { name: /post comment/i });
      await user.click(postButton);
      // Rapid second click before first completes
      await user.click(postButton);

      // Resolve the first request
      resolveComment({ status: 201, body: { comment: createdComment } });

      await waitFor(() => {
        expect(mock.requestsFor("POST", `/items/${item.id}/comments`)).toHaveLength(1);
        expect(mock.requestsFor("POST", `/items/${item.id}/comments`)[0].headers["Idempotency-Key"]).toBeTruthy();
      });
    });

    it("preserves comment text on submission failure", async () => {
      const mock = installFetchMock();
      const item = makeItem({ status: "OPEN" });
      await renderDetail(mock, item);

      mock.on("POST", `/items/${item.id}/comments`, () => ({
        status: 500,
        body: { error: "Internal server error" },
      }));

      const user = userEvent.setup();
      const textarea = screen.getByLabelText(/add a comment/i);
      await user.type(textarea, "Comment that will fail");
      await user.click(screen.getByRole("button", { name: /post comment/i }));

      // Error toast appears as a Sonner toast with role="alert"
      const toast = await findToast("alert", /internal server error/i);
      expect(toast).toBeInTheDocument();
      // Text should be preserved
      expect(textarea).toHaveValue("Comment that will fail");
    });

    it("shows permission error when user cannot add comments", async () => {
      const mock = installFetchMock();
      const item = makeItem({ status: "OPEN" });
      await renderDetail(mock, item, [VIEWER_MEMBERSHIP]);

      mock.on("POST", `/items/${item.id}/comments`, () => ({
        status: 403,
        body: { error: "Forbidden" },
      }));

      const user = userEvent.setup();
      const textarea = screen.getByLabelText(/add a comment/i);
      await user.type(textarea, "Comment from viewer");
      await user.click(screen.getByRole("button", { name: /post comment/i }));

      // Error toast appears as a Sonner toast with role="alert"
      const toast = await findToast("alert", /doesn't allow adding comments/i);
      expect(toast).toBeInTheDocument();
      // Text should be preserved
      expect(textarea).toHaveValue("Comment from viewer");
    });

    it("disables post button when comment is empty or pending", async () => {
      const mock = installFetchMock();
      const item = makeItem({ status: "OPEN" });
      await renderDetail(mock, item);

      const postButton = screen.getByRole("button", { name: /post comment/i });
      const textarea = screen.getByLabelText(/add a comment/i);

      // Initially disabled (empty)
      expect(postButton).toBeDisabled();

      // Type something - should be enabled
      await userEvent.type(textarea, "Test");
      expect(postButton).not.toBeDisabled();

      // Clear - should be disabled again
      await userEvent.clear(textarea);
      expect(postButton).toBeDisabled();
    });
  });
});
