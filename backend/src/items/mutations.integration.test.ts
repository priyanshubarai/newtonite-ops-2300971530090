import request from "supertest";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { app } from "../app.js";
import { db, pool } from "../db/index.js";
import { workItems } from "../db/schema/work_items.js";
import { comments } from "../db/schema/comments.js";
import {
  insertActivityEventTx,
  insertOutboxJobTx,
  insertWorkItemTx,
} from "./repository.js";
import type { WorkItemRow } from "./serialize.js";
import {
  TEST_PASSWORD,
  addMembership,
  cleanupFixture,
  countActivityEvents,
  countOutboxJobs,
  createTestTeam,
  createTestUser,
  createTestWorkItem,
  getWorkItemRow,
  listActivityEvents,
  uniqueEmail,
  uniqueSlug,
} from "../auth/testFixtures.js";

/**
 * Phase 5 integration tests: atomic claim, optimistic concurrency, workflow
 * transitions, idempotency, and transactional audit/outbox consistency.
 *
 * Everything here drives the real Express app and the real Neon PostgreSQL
 * database through the configured `@neondatabase/serverless` interactive
 * transaction driver. Concurrency is exercised with genuinely overlapping
 * requests (`Promise.all`), not by calling functions sequentially. Fixtures are
 * throwaway teams/users/items with unique identifiers and are cleaned up
 * afterwards, so the seeded demo dataset is never mutated and no destructive
 * operation is performed.
 */

interface Fixture {
  teamA: string;
  teamB: string;
  viewerA: string;
  memberA: string;
  leadA: string;
  adminA: string;
  memberB: string;
  leadB: string;
  /** MEMBER in team A but LEAD in team B - tests that a role elsewhere grants nothing. */
  dualMember: string;
  outsider: string;
}

let fx: Fixture;
const cookies: Record<string, string> = {};
const emails: Record<string, string> = {};

let keyCounter = 0;
function uniqueIdempotencyKey(): string {
  keyCounter += 1;
  return `idem-${Date.now().toString(36)}-${keyCounter}-${Math.random().toString(36).slice(2, 8)}`;
}

async function makeUser(key: string, name: string): Promise<string> {
  const email = uniqueEmail(key.toLowerCase());
  emails[key] = email;
  return createTestUser(email, name);
}

function authed(cookie: string) {
  return { Cookie: cookie };
}

async function login(key: string): Promise<string> {
  const res = await request(app)
    .post("/auth/login")
    .send({ email: emails[key], password: TEST_PASSWORD });
  if (res.status !== 200) {
    throw new Error(`login failed for ${key}: ${res.status} ${JSON.stringify(res.body)}`);
  }
  const cookie = res.headers["set-cookie"]?.[0] || "";
  if (!cookie) {
    throw new Error(`no auth_token cookie for ${key}`);
  }
  return cookie;
}

/** A fresh team-A work item with the given overrides (version always starts at 1). */
function freshItem(
  overrides: Partial<{
    status: WorkItemRow["status"];
    assigneeId: string | null;
    priority: WorkItemRow["priority"];
    title: string;
    teamId: string;
    createdBy: string;
  }> = {},
): Promise<string> {
  return createTestWorkItem({
    teamId: overrides.teamId ?? fx.teamA,
    createdBy: overrides.createdBy ?? fx.leadA,
    title: overrides.title ?? `Mutation item ${uniqueIdempotencyKey()}`,
    type: "TASK",
    priority: overrides.priority ?? "MEDIUM",
    status: overrides.status ?? "OPEN",
    assigneeId: overrides.assigneeId ?? null,
  });
}

function getItem(id: string, token: string) {
  return request(app).get(`/items/${id}`).set(authed(token));
}

function patchItem(
  id: string,
  token: string,
  body: Record<string, unknown>,
  key?: string,
) {
  const req = request(app).patch(`/items/${id}`).set(authed(token));
  if (key) req.set("Idempotency-Key", key);
  return req.send(body);
}

function claimItem(id: string, token: string, key?: string) {
  const req = request(app).post(`/items/${id}/claim`).set(authed(token));
  if (key) req.set("Idempotency-Key", key);
  return req.send({});
}

function transitionItem(
  id: string,
  token: string,
  body: Record<string, unknown>,
  key?: string,
) {
  const req = request(app).post(`/items/${id}/transition`).set(authed(token));
  if (key) req.set("Idempotency-Key", key);
  return req.send(body);
}

function createItem(token: string, body: Record<string, unknown>, key?: string) {
  const req = request(app).post("/items").set(authed(token));
  if (key) req.set("Idempotency-Key", key);
  return req.send(body);
}

function createComment(
  id: string,
  token: string,
  body: Record<string, unknown>,
  key?: string,
) {
  const req = request(app).post(`/items/${id}/comments`).set(authed(token));
  if (key) req.set("Idempotency-Key", key);
  return req.send(body);
}

async function countItemsByTitle(teamId: string, title: string): Promise<number> {
  const rows = await db
    .select({ value: sql<number>`count(*)::int` })
    .from(workItems)
    .where(and(eq(workItems.teamId, teamId), eq(workItems.title, title)));
  return rows[0]?.value ?? 0;
}

async function countComments(workItemId: string): Promise<number> {
  const rows = await db
    .select({ value: sql<number>`count(*)::int` })
    .from(comments)
    .where(eq(comments.workItemId, workItemId));
  return rows[0]?.value ?? 0;
}

beforeAll(async () => {
  const teamA = await createTestTeam("Mutations Team A", uniqueSlug("mut-a"));
  const teamB = await createTestTeam("Mutations Team B", uniqueSlug("mut-b"));

  const viewerA = await makeUser("viewerA", "Viewer A");
  const memberA = await makeUser("memberA", "Member A");
  const leadA = await makeUser("leadA", "Lead A");
  const adminA = await makeUser("adminA", "Admin A");
  const memberB = await makeUser("memberB", "Member B");
  const leadB = await makeUser("leadB", "Lead B");
  const dualMember = await makeUser("dualMember", "Dual Member");
  const outsider = await makeUser("outsider", "Outsider");

  await addMembership(viewerA, teamA, "VIEWER");
  await addMembership(memberA, teamA, "MEMBER");
  await addMembership(leadA, teamA, "LEAD");
  await addMembership(adminA, teamA, "ADMIN");
  await addMembership(memberB, teamB, "MEMBER");
  await addMembership(leadB, teamB, "LEAD");
  await addMembership(dualMember, teamA, "MEMBER");
  await addMembership(dualMember, teamB, "LEAD");

  fx = { teamA, teamB, viewerA, memberA, leadA, adminA, memberB, leadB, dualMember, outsider };

  for (const key of [
    "viewerA",
    "memberA",
    "leadA",
    "adminA",
    "memberB",
    "leadB",
    "dualMember",
    "outsider",
  ]) {
    cookies[key] = await login(key);
  }
});

afterAll(async () => {
  await cleanupFixture({
    userIds: [
      fx.viewerA,
      fx.memberA,
      fx.leadA,
      fx.adminA,
      fx.memberB,
      fx.leadB,
      fx.dualMember,
      fx.outsider,
    ],
    teamIds: [fx.teamA, fx.teamB],
  });
  await pool.end();
});

// ---------------------------------------------------------------------------

describe("POST /items/:id/claim - atomic claim", () => {
  it("1. a member claims an unassigned, claimable item and the version increments", async () => {
    const id = await freshItem();
    const res = await claimItem(id, cookies.memberA);

    expect(res.status).toBe(200);
    expect(res.body.assigneeId).toBe(fx.memberA);
    expect(res.body.version).toBe(2);

    const row = await getWorkItemRow(id);
    expect(row?.assigneeId).toBe(fx.memberA);
    expect(row?.version).toBe(2);

    // A successful claim records exactly one assignee event and one outbox job.
    const events = await listActivityEvents(id);
    expect(events.map((e) => e.eventType)).toEqual(["ASSIGNEE_CHANGED"]);
    expect(events[0].actorId).toBe(fx.memberA);
    expect(await countOutboxJobs(id)).toBe(1);
  });

  it("2. a viewer cannot claim (403) and nothing changes", async () => {
    const id = await freshItem();
    const res = await claimItem(id, cookies.viewerA);

    expect(res.status).toBe(403);
    expect((await getWorkItemRow(id))?.assigneeId).toBeNull();
    expect(await countActivityEvents(id)).toBe(0);
    expect(await countOutboxJobs(id)).toBe(0);
  });

  it("3. a non-member cannot claim an item in another team (404)", async () => {
    const id = await freshItem();
    const res = await claimItem(id, cookies.memberB);
    expect(res.status).toBe(404);
    expect((await getWorkItemRow(id))?.assigneeId).toBeNull();
  });

  it("4. two concurrent claimants: exactly one succeeds, the other gets 409", async () => {
    const id = await freshItem();
    const [a, b] = await Promise.all([
      claimItem(id, cookies.memberA),
      claimItem(id, cookies.adminA),
    ]);

    const statuses = [a.status, b.status].sort((x, y) => x - y);
    expect(statuses).toEqual([200, 409]);

    const winner = a.status === 200 ? a : b;
    const loser = a.status === 409 ? a : b;
    expect(loser.body.code).toBe("ALREADY_ASSIGNED");
    expect(winner.body.assigneeId).toBe(winner === a ? fx.memberA : fx.adminA);
    expect((await getWorkItemRow(id))?.assigneeId).toBe(winner.body.assigneeId);
    expect(winner.body.version).toBe(2);
  });

  it("5. the losing claim creates no success activity event or outbox job", async () => {
    const id = await freshItem();
    await Promise.all([claimItem(id, cookies.memberA), claimItem(id, cookies.adminA)]);

    // Exactly one winner => exactly one assignee event and one outbox job.
    const events = await listActivityEvents(id);
    expect(events).toHaveLength(1);
    expect(events[0].eventType).toBe("ASSIGNEE_CHANGED");
    expect(await countOutboxJobs(id)).toBe(1);
  });

  it("rejects claiming an already-assigned item (409) and a non-claimable status (409)", async () => {
    const assigned = await freshItem({ assigneeId: fx.leadA });
    const reseat = await claimItem(assigned, cookies.memberA);
    expect(reseat.status).toBe(409);
    expect(reseat.body.code).toBe("ALREADY_ASSIGNED");

    const closed = await freshItem({ status: "CLOSED" });
    const notClaimable = await claimItem(closed, cookies.memberA);
    expect(notClaimable.status).toBe(409);
    expect(notClaimable.body.code).toBe("NOT_CLAIMABLE");
  });
});

// ---------------------------------------------------------------------------

describe("PATCH /items/:id - optimistic concurrency", () => {
  it("6/7. a valid expectedVersion commits and increments once; a stale one returns 409 STALE_VERSION", async () => {
    const id = await freshItem();

    const ok = await patchItem(id, cookies.memberA, { title: "v2 title", expectedVersion: 1 });
    expect(ok.status).toBe(200);
    expect(ok.body.version).toBe(2);

    const stale = await patchItem(id, cookies.memberA, { title: "v3?", expectedVersion: 1 });
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe("STALE_VERSION");
  });

  it("8. a stale update changes nothing and creates no audit/outbox records", async () => {
    const id = await freshItem();
    const before = await getWorkItemRow(id);

    const stale = await patchItem(id, cookies.memberA, {
      title: "should not apply",
      priority: "CRITICAL",
      expectedVersion: 42,
    });
    expect(stale.status).toBe(409);

    const after = await getWorkItemRow(id);
    expect(after?.title).toBe(before?.title);
    expect(after?.priority).toBe(before?.priority);
    expect(after?.version).toBe(1);
    expect(await countActivityEvents(id)).toBe(0);
    expect(await countOutboxJobs(id)).toBe(0);
  });

  it("9. two concurrent updates with the same expectedVersion cannot both win", async () => {
    const id = await freshItem();
    const [a, b] = await Promise.all([
      patchItem(id, cookies.memberA, { title: "writer A", expectedVersion: 1 }),
      patchItem(id, cookies.memberA, { title: "writer B", expectedVersion: 1 }),
    ]);

    const statuses = [a.status, b.status].sort((x, y) => x - y);
    expect(statuses).toEqual([200, 409]);

    const winner = a.status === 200 ? a : b;
    const loser = a.status === 409 ? a : b;
    expect(loser.body.code).toBe("STALE_VERSION");

    const row = await getWorkItemRow(id);
    expect(row?.version).toBe(2);
    expect(row?.title).toBe(winner.body.title);
    expect(await countActivityEvents(id)).toBe(1);
    expect(await countOutboxJobs(id)).toBe(1);
  });

  it("10. version increments across PATCH, claim, and transition", async () => {
    const id = await freshItem();

    const patched = await patchItem(id, cookies.memberA, { title: "step 1", expectedVersion: 1 });
    expect(patched.body.version).toBe(2);

    const claimed = await claimItem(id, cookies.memberA);
    expect(claimed.body.version).toBe(3);
    expect(claimed.body.assigneeId).toBe(fx.memberA);

    const transitioned = await transitionItem(id, cookies.memberA, {
      toStatus: "IN_PROGRESS",
      expectedVersion: 3,
    });
    expect(transitioned.status).toBe(200);
    expect(transitioned.body.version).toBe(4);
    expect(transitioned.body.status).toBe("IN_PROGRESS");
  });

  it("11. clients cannot set the stored version directly", async () => {
    const id = await freshItem();
    const patched = await patchItem(id, cookies.memberA, {
      title: "sneaky",
      version: 99,
      expectedVersion: 1,
    });
    expect(patched.status).toBe(400);

    const created = await createItem(cookies.memberA, {
      title: "sneaky create",
      type: "TASK",
      priority: "LOW",
      teamId: fx.teamA,
      version: 99,
    });
    expect(created.status).toBe(400);
    expect((await getWorkItemRow(id))?.version).toBe(1);
  });
});

// ---------------------------------------------------------------------------

describe("POST /items/:id/transition - workflow enforcement", () => {
  it("12. valid transitions succeed along OPEN -> ... -> CLOSED", async () => {
    const id = await freshItem();

    const toProgress = await transitionItem(id, cookies.memberA, {
      toStatus: "IN_PROGRESS",
      expectedVersion: 1,
    });
    expect(toProgress.status).toBe(200);
    expect(toProgress.body.status).toBe("IN_PROGRESS");

    const toApproval = await transitionItem(id, cookies.memberA, {
      toStatus: "AWAITING_APPROVAL",
      expectedVersion: 2,
    });
    expect(toApproval.status).toBe(200);
    expect(toApproval.body.status).toBe("AWAITING_APPROVAL");

    const toResolved = await transitionItem(id, cookies.leadA, {
      toStatus: "RESOLVED",
      expectedVersion: 3,
    });
    expect(toResolved.status).toBe(200);
    expect(toResolved.body.status).toBe("RESOLVED");

    const toClosed = await transitionItem(id, cookies.memberA, {
      toStatus: "CLOSED",
      expectedVersion: 4,
    });
    expect(toClosed.status).toBe(200);
    expect(toClosed.body.status).toBe("CLOSED");
    expect(toClosed.body.version).toBe(5);

    const events = await listActivityEvents(id);
    expect(events.map((e) => e.eventType)).toEqual([
      "STATUS_CHANGED",
      "STATUS_CHANGED",
      "STATUS_CHANGED",
      "STATUS_CHANGED",
    ]);
    expect(await countOutboxJobs(id)).toBe(4);
  });

  it("13. skipping a state is rejected (409 INVALID_TRANSITION)", async () => {
    const id = await freshItem();
    const res = await transitionItem(id, cookies.memberA, {
      toStatus: "AWAITING_APPROVAL",
      expectedVersion: 1,
    });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("INVALID_TRANSITION");
    expect((await getWorkItemRow(id))?.status).toBe("OPEN");
    expect(await countActivityEvents(id)).toBe(0);
  });

  it("14. status cannot be changed through PATCH", async () => {
    const id = await freshItem();
    const res = await patchItem(id, cookies.memberA, { status: "CLOSED", expectedVersion: 1 });
    expect(res.status).toBe(400);
  });

  it("15. a viewer or member cannot approve out of AWAITING_APPROVAL", async () => {
    const item = () => freshItem({ status: "AWAITING_APPROVAL" });

    const byViewer = await transitionItem(await item(), cookies.viewerA, {
      toStatus: "RESOLVED",
      expectedVersion: 1,
    });
    expect(byViewer.status).toBe(403);

    const byMember = await transitionItem(await item(), cookies.memberA, {
      toStatus: "RESOLVED",
      expectedVersion: 1,
    });
    expect(byMember.status).toBe(403);
  });

  it("16. a lead/admin of the item's own team can approve", async () => {
    const id1 = await freshItem({ status: "AWAITING_APPROVAL" });
    const asLead = await transitionItem(id1, cookies.leadA, {
      toStatus: "RESOLVED",
      expectedVersion: 1,
    });
    expect(asLead.status).toBe(200);
    expect(asLead.body.status).toBe("RESOLVED");

    const id2 = await freshItem({ status: "AWAITING_APPROVAL" });
    const asAdmin = await transitionItem(id2, cookies.adminA, {
      toStatus: "RESOLVED",
      expectedVersion: 1,
    });
    expect(asAdmin.status).toBe(200);
  });

  it("17. a lead/admin from a different team cannot approve", async () => {
    // leadB is a LEAD - but only in team B, so team A's item is invisible (404).
    const id1 = await freshItem({ status: "AWAITING_APPROVAL" });
    const byForeignLead = await transitionItem(id1, cookies.leadB, {
      toStatus: "RESOLVED",
      expectedVersion: 1,
    });
    expect(byForeignLead.status).toBe(404);

    // dualMember is a LEAD in team B and a MEMBER in team A: the team-B role
    // must not authorize approval in team A (403, not 200).
    const id2 = await freshItem({ status: "AWAITING_APPROVAL" });
    const byDual = await transitionItem(id2, cookies.dualMember, {
      toStatus: "RESOLVED",
      expectedVersion: 1,
    });
    expect(byDual.status).toBe(403);
    expect((await getWorkItemRow(id2))?.status).toBe("AWAITING_APPROVAL");
  });

  it("18. a closed item cannot be reopened", async () => {
    const id = await freshItem({ status: "CLOSED" });
    for (const toStatus of ["OPEN", "IN_PROGRESS", "RESOLVED"]) {
      const res = await transitionItem(id, cookies.leadA, { toStatus, expectedVersion: 1 });
      expect(res.status, toStatus).toBe(409);
      expect(res.body.code).toBe("INVALID_TRANSITION");
    }
    expect((await getWorkItemRow(id))?.status).toBe("CLOSED");
  });

  it("19. a stale transition is rejected with no side effects", async () => {
    const id = await freshItem({ status: "AWAITING_APPROVAL" });
    const res = await transitionItem(id, cookies.leadA, {
      toStatus: "RESOLVED",
      expectedVersion: 5,
    });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("STALE_VERSION");
    expect((await getWorkItemRow(id))?.status).toBe("AWAITING_APPROVAL");
    expect(await countActivityEvents(id)).toBe(0);
    expect(await countOutboxJobs(id)).toBe(0);
  });
});

// ---------------------------------------------------------------------------

describe("Idempotency-Key handling", () => {
  it("20/23. same key + same payload replays the original result with one business effect", async () => {
    const key = uniqueIdempotencyKey();
    const title = `Idempotent create ${key}`;
    const body = { title, type: "TASK", priority: "LOW", teamId: fx.teamA };

    const first = await createItem(cookies.memberA, body, key);
    expect(first.status).toBe(201);

    const replay = await createItem(cookies.memberA, body, key);
    expect(replay.status).toBe(201);
    expect(replay.body.id).toBe(first.body.id);
    expect(replay.body.version).toBe(first.body.version);

    // One mutation, one audit event, one outbox job - despite two requests.
    expect(await countItemsByTitle(fx.teamA, title)).toBe(1);
    expect(await countActivityEvents(first.body.id)).toBe(1);
    expect(await countOutboxJobs(first.body.id)).toBe(1);
  });

  it("21. same key + different payload returns 409 IDEMPOTENCY_KEY_REUSED", async () => {
    const key = uniqueIdempotencyKey();
    const body = { title: `Reuse base ${key}`, type: "TASK", priority: "LOW", teamId: fx.teamA };

    expect((await createItem(cookies.memberA, body, key)).status).toBe(201);

    const reused = await createItem(cookies.memberA, { ...body, priority: "HIGH" }, key);
    expect(reused.status).toBe(409);
    expect(reused.body.code).toBe("IDEMPOTENCY_KEY_REUSED");
  });

  it("22. concurrent identical requests produce exactly one business effect", async () => {
    const key = uniqueIdempotencyKey();
    const title = `Concurrent idempotent ${key}`;
    const body = { title, type: "TASK", priority: "MEDIUM", teamId: fx.teamA };

    const [a, b] = await Promise.all([
      createItem(cookies.memberA, body, key),
      createItem(cookies.memberA, body, key),
    ]);

    expect([a.status, b.status]).toEqual([201, 201]);
    expect(a.body.id).toBe(b.body.id);
    expect(await countItemsByTitle(fx.teamA, title)).toBe(1);
    expect(await countActivityEvents(a.body.id)).toBe(1);
    expect(await countOutboxJobs(a.body.id)).toBe(1);
  });

  it("24. a failed request does not become a cached success and does not consume the key", async () => {
    const key = uniqueIdempotencyKey();
    const badTitle = `Never created ${key}`;
    // teamId is team B, which memberA cannot write to -> 404.
    const bad = {
      title: badTitle,
      type: "TASK",
      priority: "LOW",
      teamId: fx.teamB,
    };

    const first = await createItem(cookies.memberA, bad, key);
    expect(first.status).toBe(404);

    const retry = await createItem(cookies.memberA, bad, key);
    expect(retry.status).toBe(404); // re-executed, not a cached 2xx
    expect(await countItemsByTitle(fx.teamB, badTitle)).toBe(0);

    // The key was not consumed by the failure: a valid payload under it works.
    const good = await createItem(
      cookies.memberA,
      { title: `After failure ${key}`, type: "TASK", priority: "LOW", teamId: fx.teamA },
      key,
    );
    expect(good.status).toBe(201);
  });

  it("a concurrent duplicate of a mutation that fails still produces no effect", async () => {
    const key = uniqueIdempotencyKey();
    const body = { title: `Racing failure ${key}`, type: "TASK", priority: "LOW", teamId: fx.teamB };

    const [a, b] = await Promise.all([
      createItem(cookies.memberA, body, key),
      createItem(cookies.memberA, body, key),
    ]);
    expect([a.status, b.status]).toEqual([404, 404]);
    expect(await countItemsByTitle(fx.teamB, body.title)).toBe(0);
  });

  it("replays idempotent PATCH, claim, and transition without double-applying", async () => {
    // PATCH
    const patchTarget = await freshItem();
    const patchKey = uniqueIdempotencyKey();
    const p1 = await patchItem(
      patchTarget,
      cookies.memberA,
      { title: "idempotent patch", expectedVersion: 1 },
      patchKey,
    );
    const p2 = await patchItem(
      patchTarget,
      cookies.memberA,
      { title: "idempotent patch", expectedVersion: 1 },
      patchKey,
    );
    expect(p1.status).toBe(200);
    expect(p2.status).toBe(200);
    expect(p2.body.version).toBe(2);
    expect((await getWorkItemRow(patchTarget))?.version).toBe(2);
    expect(await countActivityEvents(patchTarget)).toBe(1);
    expect(await countOutboxJobs(patchTarget)).toBe(1);

    // CLAIM
    const claimTarget = await freshItem();
    const claimKey = uniqueIdempotencyKey();
    const c1 = await claimItem(claimTarget, cookies.memberA, claimKey);
    const c2 = await claimItem(claimTarget, cookies.memberA, claimKey);
    expect([c1.status, c2.status]).toEqual([200, 200]);
    expect(c2.body.assigneeId).toBe(fx.memberA);
    expect((await getWorkItemRow(claimTarget))?.version).toBe(2);
    expect(await countActivityEvents(claimTarget)).toBe(1);
    expect(await countOutboxJobs(claimTarget)).toBe(1);

    // TRANSITION
    const transitionTarget = await freshItem();
    const transitionKey = uniqueIdempotencyKey();
    const t1 = await transitionItem(
      transitionTarget,
      cookies.memberA,
      { toStatus: "IN_PROGRESS", expectedVersion: 1 },
      transitionKey,
    );
    const t2 = await transitionItem(
      transitionTarget,
      cookies.memberA,
      { toStatus: "IN_PROGRESS", expectedVersion: 1 },
      transitionKey,
    );
    expect([t1.status, t2.status]).toEqual([200, 200]);
    expect(t2.body.status).toBe("IN_PROGRESS");
    expect((await getWorkItemRow(transitionTarget))?.version).toBe(2);
    expect(await countActivityEvents(transitionTarget)).toBe(1);
    expect(await countOutboxJobs(transitionTarget)).toBe(1);
  });
});

// ---------------------------------------------------------------------------

describe("Transactional activity + outbox consistency", () => {
  it("25. each successful mutation writes the matching, attributed activity event", async () => {
    // CREATE -> ITEM_CREATED
    const created = await createItem(cookies.memberA, {
      title: `Audited create ${uniqueIdempotencyKey()}`,
      type: "INCIDENT",
      priority: "HIGH",
      teamId: fx.teamA,
    });
    expect(created.status).toBe(201);
    const createdEvents = await listActivityEvents(created.body.id);
    expect(createdEvents).toHaveLength(1);
    expect(createdEvents[0].eventType).toBe("ITEM_CREATED");
    expect(createdEvents[0].actorId).toBe(fx.memberA);
    expect((createdEvents[0].metadata as any).after.status).toBe("OPEN");

    // PATCH priority -> PRIORITY_CHANGED; PATCH title -> ITEM_UPDATED
    const target = await freshItem();
    const originalTitle = (await getWorkItemRow(target))!.title;
    const priorityChange = await patchItem(target, cookies.memberA, {
      priority: "CRITICAL",
      expectedVersion: 1,
    });
    expect(priorityChange.status).toBe(200);
    const titleChange = await patchItem(target, cookies.memberA, {
      title: "documented change",
      expectedVersion: 2,
    });
    expect(titleChange.status).toBe(200);

    const events = await listActivityEvents(target);
    expect(events.map((e) => e.eventType)).toEqual(["PRIORITY_CHANGED", "ITEM_UPDATED"]);
    expect(events[0].metadata as any).toMatchObject({
      before: { priority: "MEDIUM" },
      after: { priority: "CRITICAL" },
    });
    expect(events[1].metadata as any).toMatchObject({
      before: { title: originalTitle },
      after: { title: "documented change" },
    });
  });

  it("26. the mutation and its activity event roll back together when the event insert fails", async () => {
    const title = `Rollback probe ${uniqueIdempotencyKey()}`;
    let workItemId = "";

    await expect(
      db.transaction(async (tx) => {
        const row = await insertWorkItemTx(tx, {
          title,
          description: null,
          type: "TASK",
          priority: "LOW",
          teamId: fx.teamA,
          assigneeId: null,
          createdBy: fx.memberA,
          dueAt: null,
        });
        workItemId = row.id;
        // A non-existent actor violates the FK on activity_events.actor_id.
        await insertActivityEventTx(tx, {
          workItemId: row.id,
          actorId: "00000000-0000-4000-8000-000000000000",
          eventType: "ITEM_CREATED",
          metadata: { after: {} },
        });
        await insertOutboxJobTx(tx, {
          jobType: "work_item.created",
          payload: { workItemId: row.id },
        });
      }),
    ).rejects.toThrow();

    // The whole transaction rolled back: no item, no outbox job.
    expect(workItemId).not.toBe("");
    expect(await countItemsByTitle(fx.teamA, title)).toBe(0);
    expect(await countOutboxJobs(workItemId)).toBe(0);
  });

  it("27. an outbox job is inserted atomically with a successful create", async () => {
    const title = `Outbox create ${uniqueIdempotencyKey()}`;
    const res = await createItem(cookies.memberA, {
      title,
      type: "PAYMENT",
      priority: "LOW",
      teamId: fx.teamA,
    });
    expect(res.status).toBe(201);

    const jobs = await db.execute(
      sql`select job_type, payload from outbox_jobs where payload->>'workItemId' = ${res.body.id}`,
    );
    expect(jobs.rows).toHaveLength(1);
    expect((jobs.rows[0] as any).job_type).toBe("work_item.created");
    expect((jobs.rows[0] as any).payload.teamId).toBe(fx.teamA);
  });

  it("28. unauthorized, stale, and invalid mutations create no success audit/outbox records", async () => {
    const id = await freshItem();

    // Unauthorized (viewer).
    expect((await patchItem(id, cookies.viewerA, { title: "x", expectedVersion: 1 })).status).toBe(403);
    // Stale version.
    expect((await patchItem(id, cookies.memberA, { title: "x", expectedVersion: 9 })).status).toBe(409);
    // Invalid transition.
    expect(
      (await transitionItem(id, cookies.memberA, { toStatus: "RESOLVED", expectedVersion: 1 })).status,
    ).toBe(409);
    // Unauthorized claim.
    expect((await claimItem(id, cookies.viewerA)).status).toBe(403);

    expect(await countActivityEvents(id)).toBe(0);
    expect(await countOutboxJobs(id)).toBe(0);
    const row = await getWorkItemRow(id);
    expect(row?.version).toBe(1);
    expect(row?.status).toBe("OPEN");
    expect(row?.assigneeId).toBeNull();
  });

  // Comment creation and activity events
  it("29. create comment creates one comment and one COMMENT_ADDED activity event", async () => {
    const id = await freshItem();
    const key = uniqueIdempotencyKey();

    const res = await createComment(id, cookies.memberA, { body: "Test comment" }, key);
    expect(res.status).toBe(201);

    expect(await countComments(id)).toBe(1);
    expect(await countActivityEvents(id)).toBe(1);

    const activity = await listActivityEvents(id);
    expect(activity).toHaveLength(1);
    expect(activity[0].eventType).toBe("COMMENT_ADDED");
    expect(activity[0].metadata).toEqual({ commentId: res.body.comment.id, authorId: fx.memberA });
  });

  it("30. second comment creates its own activity event", async () => {
    const id = await freshItem();
    const key1 = uniqueIdempotencyKey();
    const key2 = uniqueIdempotencyKey();

    const res1 = await createComment(id, cookies.memberA, { body: "First comment" }, key1);
    expect(res1.status).toBe(201);

    const res2 = await createComment(id, cookies.memberA, { body: "Second comment" }, key2);
    expect(res2.status).toBe(201);

    expect(await countComments(id)).toBe(2);
    expect(await countActivityEvents(id)).toBe(2);

    const activity = await listActivityEvents(id);
    expect(activity).toHaveLength(2);
    // Both should be COMMENT_ADDED
    expect(activity.every((a) => a.eventType === "COMMENT_ADDED")).toBe(true);
    // Different comment IDs
    const metadata0 = activity[0].metadata as { commentId: string };
    const metadata1 = activity[1].metadata as { commentId: string };
    expect(metadata0.commentId).not.toBe(metadata1.commentId);
  });

  it("31. activity endpoint returns COMMENT_ADDED events for the work item", async () => {
    const id = await freshItem();
    const key = uniqueIdempotencyKey();

    await createComment(id, cookies.memberA, { body: "Comment for activity test" }, key);

    const res = await request(app).get(`/items/${id}/activity`).set(authed(cookies.memberA));
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].eventType).toBe("COMMENT_ADDED");
    expect(res.body.items[0].metadata).toEqual({ commentId: expect.any(String), authorId: fx.memberA });
  });

  it("32. retrying same idempotent comment request does not duplicate comment or activity", async () => {
    const id = await freshItem();
    const key = uniqueIdempotencyKey();
    const body = { body: "Idempotent comment" };

    const res1 = await createComment(id, cookies.memberA, body, key);
    expect(res1.status).toBe(201);

    const res2 = await createComment(id, cookies.memberA, body, key);
    expect(res2.status).toBe(201);
    expect(res2.body).toEqual(res1.body);

    expect(await countComments(id)).toBe(1);
    expect(await countActivityEvents(id)).toBe(1);
  });

  it("33. failed comment creation does not leave orphan activity events", async () => {
    const id = await freshItem();
    const key = uniqueIdempotencyKey();

    // Post to a different team (unauthorized) - should fail
    const badBody = { body: "Unauthorized comment" };
    const res = await createComment(id, cookies.memberB, badBody, key);
    expect(res.status).toBe(404);

    expect(await countComments(id)).toBe(0);
    expect(await countActivityEvents(id)).toBe(0);

    // The key was not consumed by the failure: a valid payload under it works
    const good = await createComment(id, cookies.memberA, { body: "Valid comment" }, key);
    expect(good.status).toBe(201);

    expect(await countComments(id)).toBe(1);
    expect(await countActivityEvents(id)).toBe(1);
  });

  // Reading comments back
  it("34. comments endpoint returns the comments written for the work item", async () => {
    const id = await freshItem();

    const res = await request(app).get(`/items/${id}/comments`).set(authed(cookies.memberA));
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(0);
    expect(res.body.pagination.total).toBe(0);

    const created = await createComment(id, cookies.memberA, { body: "First note" }, uniqueIdempotencyKey());
    expect(created.status).toBe(201);
    await createComment(id, cookies.memberA, { body: "Second note" }, uniqueIdempotencyKey());

    const listed = await request(app).get(`/items/${id}/comments`).set(authed(cookies.memberA));
    expect(listed.status).toBe(200);
    expect(listed.body.items).toHaveLength(2);
    expect(listed.body.pagination.total).toBe(2);

    const bodies = listed.body.items.map((c: { body: string }) => c.body);
    expect(bodies).toContain("First note");
    expect(bodies).toContain("Second note");
    // The reader is identified and the author id is carried, never a password.
    expect(listed.body.items[0].authorId).toBeTruthy();
  });

  it("35. comments endpoint is team-scoped: a non-member team gets 404, not an empty list", async () => {
    const id = await freshItem();
    await createComment(id, cookies.memberA, { body: "Team A only" }, uniqueIdempotencyKey());

    // memberB belongs to team B, not team A.
    const res = await request(app).get(`/items/${id}/comments`).set(authed(cookies.memberB));
    expect(res.status).toBe(404);

    // A viewer of team A is a member of the team, so the read is allowed.
    const viewer = await request(app).get(`/items/${id}/comments`).set(authed(cookies.viewerA));
    expect(viewer.status).toBe(200);
    expect(viewer.body.items).toHaveLength(1);
  });

  it("36. comments endpoint paginates and rejects a malformed id", async () => {
    const id = await freshItem();
    await createComment(id, cookies.memberA, { body: "Note 1" }, uniqueIdempotencyKey());
    await createComment(id, cookies.memberA, { body: "Note 2" }, uniqueIdempotencyKey());

    const page = await request(app)
      .get(`/items/${id}/comments`)
      .query({ page: 1, pageSize: 1 })
      .set(authed(cookies.memberA));
    expect(page.status).toBe(200);
    expect(page.body.items).toHaveLength(1);
    expect(page.body.pagination.total).toBe(2);
    expect(page.body.pagination.pageSize).toBe(1);
    expect(page.body.pagination.hasNextPage).toBe(true);

    // A malformed id is answered with 404, not 400, so a caller cannot tell a
    // bad id from an id that does not exist. This matches GET /items/:id.
    const bad = await request(app).get("/items/not-a-uuid/comments").set(authed(cookies.memberA));
    expect(bad.status).toBe(404);
  });
});
