import { describe, expect, it } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { installFetchMock } from "../test/mockFetch";
import { MEMBER_MEMBERSHIP, VIEWER_MEMBERSHIP, makeItem, mockSession } from "../test/fixtures";
import { renderApp } from "../test/renderApp";
import { setToken } from "../auth/tokenStore";

const ITEM_PATH = /^\/items\/[0-9a-f-]{36}$/;

async function renderEditPage(
  mock: ReturnType<typeof installFetchMock>,
  memberships = [MEMBER_MEMBERSHIP],
) {
  setToken("session-token");
  mockSession(mock, { memberships });
  renderApp({ route: `/items/${makeItem().id}/edit` });
}

/** Wait for the editable form to appear. */
function waitForEditForm() {
  return screen.findByRole("heading", { name: /edit work item/i });
}

describe("ItemEditPage", () => {
  it("prefills from the server and submits the expected version", async () => {
    const mock = installFetchMock();
    const loaded = makeItem({ version: 3, title: "Original title" });
    const saved = makeItem({ version: 4, title: "Updated title" });
    mock.on("GET", ITEM_PATH, () => ({ status: 200, body: loaded }));
    mock.on("PATCH", ITEM_PATH, () => ({ status: 200, body: saved }));
    renderEditPage(mock);
    await waitForEditForm();
    const user = userEvent.setup();

    const title = screen.getByLabelText(/title/i);
    expect(title).toHaveValue("Original title");

    await user.clear(title);
    await user.type(title, "Updated title");
    await user.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() => expect(mock.requestsFor("PATCH", `/items/${loaded.id}`)).toHaveLength(1));
    const request = mock.requestsFor("PATCH", `/items/${loaded.id}`)[0];
    expect(request.body).toMatchObject({ title: "Updated title", expectedVersion: 3 });
    // Protected fields are never sent by the client.
    expect(request.body).not.toHaveProperty("status");
    expect(request.body).not.toHaveProperty("teamId");
    expect(request.body).not.toHaveProperty("version");
    expect(request.headers["Idempotency-Key"]).toBeTruthy();
    // The stored version is not user-editable.
    expect(screen.queryByLabelText(/version/i)).not.toBeInTheDocument();
  });

  it("exposes no status control in the general edit form", async () => {
    const mock = installFetchMock();
    mock.on("GET", ITEM_PATH, () => ({ status: 200, body: makeItem() }));
    renderEditPage(mock);
    await waitForEditForm();

    expect(screen.queryByLabelText(/^status\b/i)).not.toBeInTheDocument();
  });

  it("keeps the user's edits and offers a reload on a stale-version conflict", async () => {
    const mock = installFetchMock();
    let current = makeItem({ version: 3, title: "Original title" });
    mock.on("GET", ITEM_PATH, () => ({ status: 200, body: current }));
    mock.on("PATCH", ITEM_PATH, () => ({
      status: 409,
      body: { error: "Version conflict", code: "STALE_VERSION" },
    }));
    renderEditPage(mock);
    await waitForEditForm();
    const user = userEvent.setup();

    const title = screen.getByLabelText(/title/i);
    await user.clear(title);
    await user.type(title, "My local edit");
    await user.click(screen.getByRole("button", { name: /save changes/i }));

    // The conflict Alert appears with the warning tone
    expect(await screen.findByText(/this item changed while you were editing/i)).toBeInTheDocument();
    expect(await screen.findByText(/your edits are still here/i)).toBeInTheDocument();
    // No silent overwrite: the local edit is still in the form.
    expect(screen.getByLabelText(/title/i)).toHaveValue("My local edit");

    // Reload pulls the newer version but leaves the user's edit intact.
    current = makeItem({ version: 4, title: "Someone else's title" });
    await user.click(screen.getByRole("button", { name: /reload latest version/i }));

    expect(await screen.findByText("Latest version loaded")).toBeInTheDocument();
    expect(screen.getByLabelText(/title/i)).toHaveValue("My local edit");

    // A subsequent save submits the refreshed version.
    mock.on("PATCH", ITEM_PATH, () => ({ status: 200, body: makeItem({ version: 5 }) }));
    await user.click(screen.getByRole("button", { name: /save changes/i }));
    await waitFor(() => expect(mock.requestsFor("PATCH", `/items/${current.id}`)).toHaveLength(2));
    expect(mock.requestsFor("PATCH", `/items/${current.id}`)[1].body).toMatchObject({
      expectedVersion: 4,
    });
  });

  it("reports a validation error returned by the backend", async () => {
    const mock = installFetchMock();
    mock.on("GET", ITEM_PATH, () => ({ status: 200, body: makeItem() }));
    mock.on("PATCH", ITEM_PATH, () => ({
      status: 400,
      body: {
        error: "Invalid request body",
        details: { fieldErrors: { description: ["description must be at most 5000 characters"] } },
      },
    }));
    renderEditPage(mock);
    await waitForEditForm();
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: /save changes/i }));

    // Field-level validation error appears inline (not as a toast)
    expect(
      await screen.findByText("description must be at most 5000 characters"),
    ).toBeInTheDocument();
  });

  it("does not offer editing to a viewer", async () => {
    const mock = installFetchMock();
    mock.on("GET", ITEM_PATH, () => ({ status: 200, body: makeItem() }));
    renderEditPage(mock, [VIEWER_MEMBERSHIP]);

    expect(await screen.findByText(/can't edit this work item/i)).toBeInTheDocument();    expect(screen.queryByRole("button", { name: /save changes/i })).not.toBeInTheDocument();
  });

  it("shows a not-found state for a missing item", async () => {
    const mock = installFetchMock();
    mock.on("GET", ITEM_PATH, () => ({ status: 404, body: { error: "Work item not found" } }));
    renderEditPage(mock);

    expect(await screen.findByText(/work item not found/i)).toBeInTheDocument();
  });
});
