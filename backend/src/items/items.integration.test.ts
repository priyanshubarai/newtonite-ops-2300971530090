import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { app } from "../app.js";
import { pool } from "../db/index.js";
import type { WorkItemRow } from "./serialize.js";
import {
  TEST_PASSWORD,
  addMembership,
  cleanupFixture,
  createTestTeam,
  createTestUser,
  createTestWorkItem,
  uniqueEmail,
  uniqueSlug,
} from "../auth/testFixtures.js";

/**
 * Integration tests for the Phase 4 work-item API.
 *
 * These drive the real Express app (routes + middleware + central error
 * handler) against the configured Neon PostgreSQL database. Fixtures are
 * throwaway teams/users/items with unique identifiers, created per run and
 * cleaned up afterwards, so the seeded demo dataset is never mutated and no
 * destructive operation is performed. Every suite here runs for real; nothing
 * is skipped.
 */

interface Fixture {
  teamA: string;
  teamB: string;
  viewerA: string;
  memberA: string;
  leadA: string;
  adminA: string;
  memberB: string;
  outsider: string;
}

let fx: Fixture;
const tokens: Record<string, string> = {};
const emails: Record<string, string> = {};

async function makeUser(key: string, name: string): Promise<string> {
  // Login lower-cases the email before lookup, so fixture emails must be
  // lower-case too (the local part included).
  const email = uniqueEmail(key.toLowerCase());
  emails[key] = email;
  return createTestUser(email, name);
}

function authed(token: string) {
  return { Authorization: `Bearer ${token}` };
}

beforeAll(async () => {
  const teamA = await createTestTeam("Items Team A", uniqueSlug("items-a"));
  const teamB = await createTestTeam("Items Team B", uniqueSlug("items-b"));

  const viewerA = await makeUser("viewerA", "Viewer A");
  const memberA = await makeUser("memberA", "Member A");
  const leadA = await makeUser("leadA", "Lead A");
  const adminA = await makeUser("adminA", "Admin A");
  const memberB = await makeUser("memberB", "Member B");
  const outsider = await makeUser("outsider", "Outsider");

  await addMembership(viewerA, teamA, "VIEWER");
  await addMembership(memberA, teamA, "MEMBER");
  await addMembership(leadA, teamA, "LEAD");
  await addMembership(adminA, teamA, "ADMIN");
  await addMembership(memberB, teamB, "MEMBER");
  // `outsider` deliberately has no membership anywhere.

  fx = { teamA, teamB, viewerA, memberA, leadA, adminA, memberB, outsider };

  // Seed team A items. A1/A3 share a due date to exercise the id tie-breaker.
  const sharedDue = new Date("2026-06-01T12:00:00.000Z");
  await createTestWorkItem({
    teamId: teamA,
    createdBy: memberA,
    title: "Alpha incident",
    description: "Customer-reported outage",
    type: "INCIDENT",
    priority: "HIGH",
    status: "OPEN",
    assigneeId: memberA,
    dueAt: sharedDue,
  });
  await createTestWorkItem({
    teamId: teamA,
    createdBy: memberA,
    title: "Beta payment",
    description: "Failed settlement",
    type: "PAYMENT",
    priority: "LOW",
    status: "IN_PROGRESS",
    assigneeId: null,
    dueAt: new Date("2026-07-01T12:00:00.000Z"),
  });
  await createTestWorkItem({
    teamId: teamA,
    createdBy: leadA,
    title: "Gamma compliance",
    description: "Audit follow-up",
    type: "COMPLIANCE",
    priority: "CRITICAL",
    status: "OPEN",
    assigneeId: leadA,
    dueAt: sharedDue,
  });
  // A team B item that must never appear to team A callers.
  await createTestWorkItem({
    teamId: teamB,
    createdBy: memberB,
    title: "Delta team B task",
    type: "TASK",
    priority: "MEDIUM",
    status: "OPEN",
    assigneeId: memberB,
  });

  for (const key of ["viewerA", "memberA", "leadA", "adminA", "memberB", "outsider"]) {
    const res = await request(app)
      .post("/auth/login")
      .send({ email: emails[key], password: TEST_PASSWORD });
    if (res.status !== 200) {
      throw new Error(`login failed for ${key}: ${res.status} ${JSON.stringify(res.body)}`);
    }
    tokens[key] = res.body.token;
  }
});

afterAll(async () => {
  await cleanupFixture({
    userIds: [fx.viewerA, fx.memberA, fx.leadA, fx.adminA, fx.memberB, fx.outsider],
    teamIds: [fx.teamA, fx.teamB],
  });
  await pool.end();
});

function listItems(token: string, query = "") {
  return request(app).get(`/items${query}`).set(authed(token));
}

describe("GET /items - listing, scoping, filtering", () => {
  it("requires authentication", async () => {
    expect((await request(app).get("/items")).status).toBe(401);
  });

  it("returns only items from teams the caller belongs to", async () => {
    const res = await listItems(tokens.memberA);
    expect(res.status).toBe(200);

    const titles = res.body.items.map((i: WorkItemRow) => i.title);
    expect(titles).toContain("Alpha incident");
    expect(titles).toContain("Beta payment");
    expect(titles).toContain("Gamma compliance");
    // Team B items must not leak.
    expect(titles).not.toContain("Delta team B task");
    // Default pagination metadata.
    expect(res.body.pagination.page).toBe(1);
    expect(res.body.pagination.pageSize).toBe(20);
    expect(res.body.pagination.total).toBe(3);
  });

  it("does not disclose items when filtering by a non-member team", async () => {
    const res = await listItems(tokens.memberA, `?teamId=${fx.teamB}`);
    expect(res.status).toBe(200);
    expect(res.body.items).toEqual([]);
    expect(res.body.pagination.total).toBe(0);
  });

  it("scopes to a member team when an explicit team filter is supplied", async () => {
    const res = await listItems(tokens.memberA, `?teamId=${fx.teamA}`);
    expect(res.status).toBe(200);
    expect(res.body.pagination.total).toBe(3);
    expect(res.body.items.every((i: WorkItemRow) => i.teamId === fx.teamA)).toBe(true);
  });

  it("applies status, priority, and assignee filters", async () => {
    const byStatus = await listItems(tokens.memberA, "?status=OPEN");
    expect(byStatus.body.items.map((i: WorkItemRow) => i.title).sort()).toEqual(
      ["Alpha incident", "Gamma compliance"].sort(),
    );

    const byPriority = await listItems(tokens.memberA, "?priority=LOW");
    expect(byPriority.body.items.map((i: WorkItemRow) => i.title)).toEqual(["Beta payment"]);

    const byAssignee = await listItems(tokens.memberA, `?assigneeId=${fx.memberA}`);
    expect(byAssignee.body.items.map((i: WorkItemRow) => i.title)).toEqual(["Alpha incident"]);
  });

  it("searches title and description (case-insensitive, literal wildcards)", async () => {
    const byTitle = await listItems(tokens.memberA, "?search=gamma");
    expect(byTitle.body.items.map((i: WorkItemRow) => i.title)).toEqual(["Gamma compliance"]);

    const byDescription = await listItems(tokens.memberA, "?search=settlement");
    expect(byDescription.body.items.map((i: WorkItemRow) => i.title)).toEqual(["Beta payment"]);

    // A literal '%' should match nothing rather than acting as a wildcard.
    const literal = await listItems(tokens.memberA, "?search=%25");
    expect(literal.body.items).toEqual([]);
  });

  it("paginates with defaults, respects the page-size cap, and reports exact totals", async () => {
    const firstPage = await listItems(tokens.memberA, `?teamId=${fx.teamA}&page=1&pageSize=2`);
    expect(firstPage.body.items).toHaveLength(2);
    expect(firstPage.body.pagination.total).toBe(3);
    expect(firstPage.body.pagination.totalPages).toBe(2);
    expect(firstPage.body.pagination.hasNextPage).toBe(true);
    expect(firstPage.body.pagination.hasPrevPage).toBe(false);

    const secondPage = await listItems(tokens.memberA, `?teamId=${fx.teamA}&page=2&pageSize=2`);
    expect(secondPage.body.items).toHaveLength(1);
    expect(secondPage.body.pagination.hasNextPage).toBe(false);
    expect(secondPage.body.pagination.hasPrevPage).toBe(true);

    // The cap is enforced (rejected, not silently clamped).
    const overCap = await listItems(tokens.memberA, "?pageSize=101");
    expect(overCap.status).toBe(400);
    const atCap = await listItems(tokens.memberA, "?pageSize=100");
    expect(atCap.status).toBe(200);
  });

  it("rejects invalid filters, sort fields, and pagination values", async () => {
    const cases = [
      "?status=BOGUS",
      "?priority=SUPER",
      "?sort=title",
      "?order=sideways",
      "?page=0",
      "?page=abc",
      "?page=-1",
      "?page=1.5",
      "?pageSize=0",
      "?pageSize=-1",
      "?pageSize=1.5",
      "?pageSize=abc",
      "?pageSize=101",
      "?teamId=not-a-uuid",
      "?assigneeId=not-a-uuid",
      `?search=${"x".repeat(201)}`,
    ];
    for (const q of cases) {
      const res = await listItems(tokens.memberA, q);
      expect(res.status, `expected 400 for ${q}`).toBe(400);
    }
  });

  it("orders deterministically with an id tie-breaker", async () => {
    // A1 and A3 share a due date. Tie-break is id ascending regardless of the
    // requested direction, so the ordering is stable and provable.
    const asc = await listItems(tokens.memberA, `?teamId=${fx.teamA}&sort=dueAt&order=asc&pageSize=100`);
    const items = asc.body.items as WorkItemRow[];
    const dueAtA1 = items.findIndex((i) => i.title === "Alpha incident");
    const dueAtA3 = items.findIndex((i) => i.title === "Gamma compliance");
    expect(dueAtA1).toBeGreaterThanOrEqual(0);
    expect(dueAtA3).toBeGreaterThanOrEqual(0);

    const a1 = items[dueAtA1];
    const a3 = items[dueAtA3];
    if (a1.id < a3.id) {
      expect(dueAtA1).toBeLessThan(dueAtA3);
    } else {
      expect(dueAtA3).toBeLessThan(dueAtA1);
    }

    // Repeating the same request yields the identical ordering.
    const repeat = await listItems(tokens.memberA, `?teamId=${fx.teamA}&sort=dueAt&order=asc&pageSize=100`);
    expect(repeat.body.items.map((i: WorkItemRow) => i.id)).toEqual(items.map((i) => i.id));
  });
});

describe("POST /items - creation", () => {
  it("requires authentication", async () => {
    const res = await request(app).post("/items").send({ title: "x" });
    expect(res.status).toBe(401);
  });

  it("lets a MEMBER create an item with server-owned fields set", async () => {
    const res = await request(app)
      .post("/items")
      .set(authed(tokens.memberA))
      .send({
        title: "  New customer issue  ",
        description: "Reported via support",
        type: "CUSTOMER_ISSUE",
        priority: "HIGH",
        teamId: fx.teamA,
        assigneeId: fx.leadA,
      });

    expect(res.status).toBe(201);
    expect(res.body.title).toBe("New customer issue"); // trimmed
    expect(res.body.status).toBe("OPEN"); // server default
    expect(res.body.version).toBe(1);
    expect(res.body.createdBy).toBe(fx.memberA); // derived from token
    expect(res.body.teamId).toBe(fx.teamA);
    expect(res.body.assigneeId).toBe(fx.leadA);
  });

  it("rejects a VIEWER creating an item with 403", async () => {
    const res = await request(app)
      .post("/items")
      .set(authed(tokens.viewerA))
      .send({ title: "Nope", type: "TASK", priority: "LOW", teamId: fx.teamA });
    expect(res.status).toBe(403);
  });

  it("conceals a non-member team as 404", async () => {
    const res = await request(app)
      .post("/items")
      .set(authed(tokens.memberA))
      .send({ title: "Cross team", type: "TASK", priority: "LOW", teamId: fx.teamB });
    expect(res.status).toBe(404);
  });

  it("rejects client attempts to set protected/server-owned fields", async () => {
    const base = { title: "Sneaky", type: "TASK", priority: "LOW", teamId: fx.teamA };
    for (const protectedField of [
      { status: "CLOSED" },
      { version: 99 },
      { createdBy: fx.outsider },
      { id: "00000000-0000-4000-8000-000000000000" },
      { createdAt: new Date().toISOString() },
    ]) {
      const res = await request(app)
        .post("/items")
        .set(authed(tokens.memberA))
        .send({ ...base, ...protectedField });
      expect(res.status, JSON.stringify(protectedField)).toBe(400);
    }
  });

  it("rejects invalid enum values, malformed UUIDs, and missing fields", async () => {
    const cases = [
      { title: "Bad type", type: "BOGUS", priority: "LOW", teamId: fx.teamA },
      { title: "Bad priority", type: "TASK", priority: "SUPER", teamId: fx.teamA },
      { title: "Bad team", type: "TASK", priority: "LOW", teamId: "not-a-uuid" },
      { title: "Bad assignee", type: "TASK", priority: "LOW", teamId: fx.teamA, assigneeId: "nope" },
      { title: "", type: "TASK", priority: "LOW", teamId: fx.teamA },
      { type: "TASK", priority: "LOW", teamId: fx.teamA }, // missing title
    ];
    for (const body of cases) {
      const res = await request(app).post("/items").set(authed(tokens.memberA)).send(body);
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
  });

  it("rejects a cross-team or non-member assignee", async () => {
    for (const assigneeId of [fx.memberB, fx.outsider]) {
      const res = await request(app)
        .post("/items")
        .set(authed(tokens.memberA))
        .send({ title: "Assign", type: "TASK", priority: "LOW", teamId: fx.teamA, assigneeId });
      expect(res.status, `assignee ${assigneeId}`).toBe(400);
    }
  });
});

describe("GET /items/:id - detail", () => {
  let itemAId: string;
  let itemBId: string;

  beforeAll(async () => {
    itemAId = await createTestWorkItem({
      teamId: fx.teamA,
      createdBy: fx.leadA,
      title: "Detail target A",
      type: "TASK",
      priority: "MEDIUM",
      status: "OPEN",
    });
    itemBId = await createTestWorkItem({
      teamId: fx.teamB,
      createdBy: fx.memberB,
      title: "Detail target B",
      type: "TASK",
      priority: "MEDIUM",
      status: "OPEN",
    });
  });

  afterAll(async () => {
    // Removed with the teams during global cleanup; nothing extra needed.
  });

  it("requires authentication", async () => {
    expect((await request(app).get(`/items/${itemAId}`)).status).toBe(401);
  });

  it("returns a permitted team's item with only safe fields", async () => {
    const res = await request(app).get(`/items/${itemAId}`).set(authed(tokens.memberA));
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(itemAId);
    expect(res.body.title).toBe("Detail target A");
    // No password/secret-ish keys leak.
    expect(JSON.stringify(res.body)).not.toMatch(/password/i);
  });

  it("conceals another team's item as 404", async () => {
    const res = await request(app).get(`/items/${itemBId}`).set(authed(tokens.memberA));
    expect(res.status).toBe(404);
  });

  it("returns 404 for a non-member caller (no enumeration)", async () => {
    const res = await request(app).get(`/items/${itemAId}`).set(authed(tokens.outsider));
    expect(res.status).toBe(404);
  });

  it("returns 404 for malformed and unknown ids", async () => {
    expect((await request(app).get("/items/not-a-uuid").set(authed(tokens.memberA))).status).toBe(404);
    expect(
      (
        await request(app)
          .get("/items/00000000-0000-4000-8000-000000000000")
          .set(authed(tokens.memberA))
      ).status,
    ).toBe(404);
  });
});

describe("PATCH /items/:id - update (optimistic concurrency)", () => {
  async function freshItem(assigneeId: string | null = null): Promise<string> {
    return createTestWorkItem({
      teamId: fx.teamA,
      createdBy: fx.leadA,
      title: "Editable item",
      description: "original",
      type: "TASK",
      priority: "MEDIUM",
      status: "OPEN",
      assigneeId,
    });
  }

  it("requires authentication", async () => {
    const itemId = await freshItem();
    const res = await request(app)
      .patch(`/items/${itemId}`)
      .send({ title: "x", expectedVersion: 1 });
    expect(res.status).toBe(401);
  });

  it("lets a MEMBER update permitted fields and increments version exactly once", async () => {
    const itemId = await freshItem();
    const res = await request(app)
      .patch(`/items/${itemId}`)
      .set(authed(tokens.memberA))
      .send({ title: "Updated title", priority: "HIGH", assigneeId: fx.memberA, expectedVersion: 1 });

    expect(res.status).toBe(200);
    expect(res.body.title).toBe("Updated title");
    expect(res.body.priority).toBe("HIGH");
    expect(res.body.assigneeId).toBe(fx.memberA);
    expect(res.body.version).toBe(2); // version 1 -> 2
    expect(res.body.status).toBe("OPEN"); // unchanged (status only moves via /transition)

    // The change is persisted, not just echoed.
    const after = await request(app).get(`/items/${itemId}`).set(authed(tokens.memberA));
    expect(after.body.version).toBe(2);
    expect(after.body.title).toBe("Updated title");
  });

  it("requires an expectedVersion and rejects a stale one with 409 STALE_VERSION", async () => {
    const itemId = await freshItem();

    // Missing expectedVersion is a validation failure.
    const missing = await request(app)
      .patch(`/items/${itemId}`)
      .set(authed(tokens.memberA))
      .send({ title: "no version" });
    expect(missing.status).toBe(400);

    // A wrong version is a conflict.
    const stale = await request(app)
      .patch(`/items/${itemId}`)
      .set(authed(tokens.memberA))
      .send({ title: "stale", expectedVersion: 99 });
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe("STALE_VERSION");
  });

  it("rejects a VIEWER updating with 403", async () => {
    const itemId = await freshItem();
    const res = await request(app)
      .patch(`/items/${itemId}`)
      .set(authed(tokens.viewerA))
      .send({ title: "Changed by viewer", expectedVersion: 1 });
    expect(res.status).toBe(403);
  });

  it("conceals another team's item as 404", async () => {
    const bItem = await createTestWorkItem({
      teamId: fx.teamB,
      createdBy: fx.memberB,
      title: "Team B editable",
      type: "TASK",
      priority: "LOW",
      status: "OPEN",
    });
    const res = await request(app)
      .patch(`/items/${bItem}`)
      .set(authed(tokens.memberA))
      .send({ title: "hijack", expectedVersion: 1 });
    expect(res.status).toBe(404);
  });

  it("rejects protected field changes", async () => {
    const itemId = await freshItem();
    const cases = [
      { status: "CLOSED" },
      { version: 2 },
      { teamId: fx.teamB },
      { createdBy: fx.outsider },
      { id: "00000000-0000-4000-8000-000000000000" },
      { createdAt: new Date().toISOString() },
      { updatedAt: new Date().toISOString() },
    ];
    for (const body of cases) {
      const res = await request(app)
        .patch(`/items/${itemId}`)
        .set(authed(tokens.memberA))
        .send({ ...body, expectedVersion: 1 });
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
  });

  it("rejects invalid and empty updates", async () => {
    const itemId = await freshItem();
    const cases = [
      {},
      { expectedVersion: 1 }, // no updatable field
      { priority: "BOGUS", expectedVersion: 1 },
      { title: "", expectedVersion: 1 },
      { type: "NOPE", expectedVersion: 1 },
      { dueAt: "not-a-date", expectedVersion: 1 },
      { title: "x", expectedVersion: 0 },
      { title: "x", expectedVersion: "two" },
    ];
    for (const body of cases) {
      const res = await request(app)
        .patch(`/items/${itemId}`)
        .set(authed(tokens.memberA))
        .send(body);
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
  });

  it("rejects assigning a user outside the item's team", async () => {
    for (const assigneeId of [fx.memberB, fx.outsider]) {
      const itemId = await freshItem();
      const res = await request(app)
        .patch(`/items/${itemId}`)
        .set(authed(tokens.memberA))
        .send({ assigneeId, expectedVersion: 1 });
      expect(res.status, `assignee ${assigneeId}`).toBe(400);
    }
  });

  it("allows clearing the assignee with null", async () => {
    const itemId = await freshItem(fx.memberA);
    const res = await request(app)
      .patch(`/items/${itemId}`)
      .set(authed(tokens.memberA))
      .send({ assigneeId: null, expectedVersion: 1 });
    expect(res.status).toBe(200);
    expect(res.body.assigneeId).toBeNull();
    expect(res.body.version).toBe(2);
  });

  it("returns 404 for malformed and unknown ids", async () => {
    expect(
      (
        await request(app)
          .patch("/items/not-a-uuid")
          .set(authed(tokens.memberA))
          .send({ title: "x", expectedVersion: 1 })
      ).status,
    ).toBe(404);
    expect(
      (
        await request(app)
          .patch("/items/00000000-0000-4000-8000-000000000000")
          .set(authed(tokens.memberA))
          .send({ title: "x", expectedVersion: 1 })
      ).status,
    ).toBe(404);
  });

  it("cannot change the stored version directly (client-sent version is rejected)", async () => {
    const itemId = await freshItem();
    const res = await request(app)
      .patch(`/items/${itemId}`)
      .set(authed(tokens.memberA))
      .send({ title: "sneaky", version: 99, expectedVersion: 1 });
    expect(res.status).toBe(400);
    expect((await request(app).get(`/items/${itemId}`).set(authed(tokens.memberA))).body.version).toBe(1);
  });
});
