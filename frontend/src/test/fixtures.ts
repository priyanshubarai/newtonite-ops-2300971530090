import type { AuthUser, Membership, WorkItem } from "../api/types";
import type { FetchMock } from "./mockFetch";

/** Shared, obviously-synthetic fixtures for frontend tests. */

export const TEST_USER: AuthUser = {
  id: "11111111-1111-4111-8111-111111111111",
  email: "avery@newtonite.dev",
  name: "Avery Stone",
  isActive: true,
};

export const OTHER_USER_ID = "99999999-9999-4999-8999-999999999999";

export const TEAM_PAYMENTS = "22222222-2222-4222-8222-222222222222";
export const TEAM_COMPLIANCE = "33333333-3333-4333-8333-333333333333";

export function membership(
  teamId: string,
  role: Membership["role"],
  teamName = "Payments",
): Membership {
  return { teamId, teamName, teamSlug: teamName.toLowerCase(), role };
}

export const LEAD_MEMBERSHIP = membership(TEAM_PAYMENTS, "LEAD", "Payments");
export const MEMBER_MEMBERSHIP = membership(TEAM_PAYMENTS, "MEMBER", "Payments");
export const VIEWER_MEMBERSHIP = membership(TEAM_PAYMENTS, "VIEWER", "Payments");

export const ITEM_ID = "44444444-4444-4444-8444-444444444444";

export function makeItem(overrides: Partial<WorkItem> = {}): WorkItem {
  return {
    id: ITEM_ID,
    title: "Latency spike on checkout",
    description: "Error rate climbed above the alert threshold.",
    type: "INCIDENT",
    priority: "HIGH",
    status: "OPEN",
    teamId: TEAM_PAYMENTS,
    assigneeId: null,
    createdBy: TEST_USER.id,
    dueAt: null,
    version: 1,
    createdAt: "2026-10-01T09:00:00.000Z",
    updatedAt: "2026-10-02T09:00:00.000Z",
    ...overrides,
  };
}

/** Register the session endpoint on a fetch mock. */
export function mockSession(
  fetchMock: FetchMock,
  options: { user?: AuthUser; memberships?: Membership[] } = {},
): void {
  const user = options.user ?? TEST_USER;
  const memberships = options.memberships ?? [LEAD_MEMBERSHIP];
  fetchMock.on("GET", "/auth/me", () => ({ status: 200, body: { user, memberships } }));
}

/** Register a work-item list endpoint returning the given items. */
export function mockItemList(
  fetchMock: FetchMock,
  items: WorkItem[],
  pageSize = 20,
): void {
  fetchMock.on("GET", "/items", (request) => {
    const page = Number(request.query.get("page") ?? "1");
    const requestedSize = Number(request.query.get("pageSize") ?? String(pageSize));
    const total = items.length;
    const totalPages = total === 0 ? 0 : Math.ceil(total / requestedSize);
    const start = (page - 1) * requestedSize;
    return {
      status: 200,
      body: {
        items: items.slice(start, start + requestedSize),
        pagination: {
          page,
          pageSize: requestedSize,
          total,
          totalPages,
          hasNextPage: page < totalPages,
          hasPrevPage: page > 1,
        },
      },
    };
  });
}
