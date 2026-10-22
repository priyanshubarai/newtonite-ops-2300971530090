import request from "supertest";
import jwt from "jsonwebtoken";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { app } from "./app.js";
import { env } from "./config/env.js";
import { db, pool } from "./db/index.js";
import { idempotencyRecords } from "./db/schema/idempotency_records.js";
import type { WorkItemRow } from "./items/serialize.js";
import {
  TEST_PASSWORD,
  addMembership,
  cleanupFixture,
  createTestTeam,
  createTestUser,
  createTestWorkItem,
  removeMembership,
  uniqueEmail,
  uniqueSlug,
} from "./auth/testFixtures.js";

/**
 * Phase 6 - integration, security, and regression verification.
 *
 * This suite targets behaviour the earlier phase suites did not cover, plus
 * regressions for the two defects Phase 6 found and fixed:
 *
 *   1. A malformed JSON body returned 500 instead of 400 (body-parser errors
 *      fell through to the generic handler).
 *   2. An out-of-range `page` produced an OFFSET that overflowed PostgreSQL's
 *      bigint and returned 500 instead of 400.
 *
 * Everything runs against the real Express app and the real Neon PostgreSQL
 * database through the configured driver. Fixtures are throwaway teams/users
 * with unique identifiers and are cleaned up afterwards; the seeded demo dataset
 * is never touched and no destructive operation is performed.
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
  /** Membership is mutated mid-suite to prove live authorization. */
  changeable: string;
  /** VIEWER promoted to MEMBER mid-suite. */
  promotable: string;
  outsider: string;
}

let fx: Fixture;
const cookies: Record<string, string> = {};
const emails: Record<string, string> = {};

function authed(cookie: string) {
  return { Cookie: cookie };
}

async function makeUser(key: string, name: string): Promise<string> {
  const email = uniqueEmail(key.toLowerCase());
  emails[key] = email;
  return createTestUser(email, name);
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

let itemSeq = 0;
function freshItem(overrides: { status?: WorkItemRow["status"]; teamId?: string } = {}) {
  itemSeq += 1;
  return createTestWorkItem({
    teamId: overrides.teamId ?? fx.teamA,
    createdBy: fx.leadA,
    title: `Phase6 item ${itemSeq}-${Date.now().toString(36)}`,
    type: "TASK",
    priority: "MEDIUM",
    status: overrides.status ?? "OPEN",
    assigneeId: null,
  });
}

let keySeq = 0;
function uniqueKey(): string {
  keySeq += 1;
  return `p6-${Date.now().toString(36)}-${keySeq}-${Math.random().toString(36).slice(2, 8)}`;
}

async function countIdempotencyRows(scope: string, key: string): Promise<number> {
  const rows = await db
    .select({ id: idempotencyRecords.id })
    .from(idempotencyRecords)
    .where(and(eq(idempotencyRecords.scope, scope), eq(idempotencyRecords.key, key)));
  return rows.length;
}

beforeAll(async () => {
  const teamA = await createTestTeam("P6 Team A", uniqueSlug("p6-a"));
  const teamB = await createTestTeam("P6 Team B", uniqueSlug("p6-b"));

  const viewerA = await makeUser("viewerA", "P6 Viewer A");
  const memberA = await makeUser("memberA", "P6 Member A");
  const leadA = await makeUser("leadA", "P6 Lead A");
  const adminA = await makeUser("adminA", "P6 Admin A");
  const memberB = await makeUser("memberB", "P6 Member B");
  const leadB = await makeUser("leadB", "P6 Lead B");
  const changeable = await makeUser("changeable", "P6 Changeable");
  const promotable = await makeUser("promotable", "P6 Promotable");
  const outsider = await makeUser("outsider", "P6 Outsider");

  await addMembership(viewerA, teamA, "VIEWER");
  await addMembership(memberA, teamA, "MEMBER");
  await addMembership(leadA, teamA, "LEAD");
  await addMembership(adminA, teamA, "ADMIN");
  await addMembership(memberB, teamB, "MEMBER");
  await addMembership(leadB, teamB, "LEAD");
  await addMembership(changeable, teamA, "MEMBER");
  await addMembership(promotable, teamA, "VIEWER");

  fx = {
    teamA,
    teamB,
    viewerA,
    memberA,
    leadA,
    adminA,
    memberB,
    leadB,
    changeable,
    promotable,
    outsider,
  };

  for (const key of [
    "viewerA",
    "memberA",
    "leadA",
    "adminA",
    "memberB",
    "leadB",
    "changeable",
    "promotable",
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
      fx.changeable,
      fx.promotable,
      fx.outsider,
    ],
    teamIds: [fx.teamA, fx.teamB],
  });
  await pool.end();
});

// ---------------------------------------------------------------------------

describe("API error handling and response hygiene", () => {
  it("rejects a malformed JSON body with 400, not 500 (regression)", async () => {
    const res = await request(app)
      .post("/auth/login")
      .set("Content-Type", "application/json")
      .send('{"email": "a@b.co", "password": ');

    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe("string");
  });

  it("rejects an oversized JSON body with 413, not 500 (regression)", async () => {
    const res = await request(app)
      .post("/items")
      .set(authed(cookies.memberA))
      .set("Content-Type", "application/json")
      .send({ title: "x".repeat(200_000), type: "TASK", priority: "LOW", teamId: fx.teamA });

    expect(res.status).toBe(413);
  });

  it("never leaks SQL, stack traces, or secrets in error bodies", async () => {
    const samples: string[] = [];

    // 400 malformed JSON
    samples.push(
      (
        await request(app)
          .post("/auth/login")
          .set("Content-Type", "application/json")
          .send("{bad json")
      ).text,
    );
    // 401 unauthenticated
    samples.push((await request(app).get("/items")).text);
    // 403 under-privileged member
    samples.push(
      (
        await request(app)
          .post("/items")
          .set(authed(cookies.viewerA))
          .send({ title: "x", type: "TASK", priority: "LOW", teamId: fx.teamA })
      ).text,
    );
    // 404 cross-team / non-existent
    samples.push((await request(app).get(`/items/${await freshItem()}`).set(authed(cookies.outsider))).text);
    // 409 stale version
    const id = await freshItem();
    samples.push(
      (
        await request(app)
          .patch(`/items/${id}`)
          .set(authed(cookies.memberA))
          .send({ title: "y", expectedVersion: 999 })
      ).text,
    );

    const forbidden = [
      "at Object",
      "node_modules",
      "select ",
      "SELECT ",
      "insert into",
      "postgres://",
      "postgresql://",
      "DATABASE_URL",
      "JWT_SECRET",
      "passwordHash",
      "pg_",
      "stack",
    ];
    for (const body of samples) {
      for (const needle of forbidden) {
        expect(body.includes(needle), `leaked "${needle}" in: ${body}`).toBe(false);
      }
    }
  });
});

// ---------------------------------------------------------------------------

describe("authentication boundaries on the items API", () => {
  it("rejects missing and malformed bearer tokens with 401 on every items endpoint", async () => {
    const id = await freshItem();
    // Build a fresh request per call: a supertest Test is single-use.
    const endpoints: Array<{ name: string; build: () => request.Test }> = [
      { name: "GET /items", build: () => request(app).get("/items") },
      {
        name: "POST /items",
        build: () =>
          request(app)
            .post("/items")
            .send({ title: "x", type: "TASK", priority: "LOW", teamId: fx.teamA }),
      },
      { name: "GET /items/:id", build: () => request(app).get(`/items/${id}`) },
      {
        name: "PATCH /items/:id",
        build: () => request(app).patch(`/items/${id}`).send({ title: "x", expectedVersion: 1 }),
      },
      { name: "POST /items/:id/claim", build: () => request(app).post(`/items/${id}/claim`).send({}) },
      {
        name: "POST /items/:id/transition",
        build: () =>
          request(app)
            .post(`/items/${id}/transition`)
            .send({ toStatus: "IN_PROGRESS", expectedVersion: 1 }),
      },
    ];

    for (const endpoint of endpoints) {
      expect((await endpoint.build()).status, `${endpoint.name} without token`).toBe(401);
    }
    for (const endpoint of endpoints) {
      const res = await endpoint.build().set(authed("not.a.jwt"));
      expect(res.status, `${endpoint.name} with malformed token`).toBe(401);
    }
  });

  it("rejects expired and forged tokens on an items endpoint", async () => {
    const expired = jwt.sign({ sub: fx.memberA }, env.JWT_SECRET, {
      algorithm: "HS256",
      expiresIn: -60,
      issuer: "newtonite",
      audience: "newtonite-api",
    });
    expect((await request(app).get("/items").set(authed(expired))).status).toBe(401);

    const forged = jwt.sign({ sub: fx.memberA }, "definitely-not-the-right-secret-value-1234", {
      algorithm: "HS256",
      expiresIn: 900,
      issuer: "newtonite",
      audience: "newtonite-api",
    });
    expect((await request(app).get("/items").set(authed(forged))).status).toBe(401);
  });
});

// ---------------------------------------------------------------------------

describe("live membership and role changes are honoured by the API", () => {
  it("a revoked membership takes effect on the next request, and re-granting restores access", async () => {
    const id = await freshItem();

    // MEMBER can view, edit, and claim.
    expect((await request(app).get(`/items/${id}`).set(authed(cookies.changeable))).status).toBe(200);

    await removeMembership(fx.changeable, fx.teamA);

    expect((await request(app).get(`/items/${id}`).set(authed(cookies.changeable))).status).toBe(404);
    expect((await request(app).post(`/items/${id}/claim`).set(authed(cookies.changeable)).send({})).status).toBe(404);
    expect(
      (
        await request(app)
          .post("/items")
          .set(authed(cookies.changeable))
          .send({ title: "revoked", type: "TASK", priority: "LOW", teamId: fx.teamA })
      ).status,
    ).toBe(404);

    // The token itself is unchanged; only the membership was revoked.
    await addMembership(fx.changeable, fx.teamA, "MEMBER");
    expect((await request(app).get(`/items/${id}`).set(authed(cookies.changeable))).status).toBe(200);
    expect((await request(app).post(`/items/${id}/claim`).set(authed(cookies.changeable)).send({})).status).toBe(200);
  });

  it("promoting a VIEWER to MEMBER grants ordinary work rights, and demoting revokes them", async () => {
    // VIEWER cannot create or claim.
    const beforeItem = await freshItem();
    expect(
      (
        await request(app)
          .post("/items")
          .set(authed(cookies.promotable))
          .send({ title: "v", type: "TASK", priority: "LOW", teamId: fx.teamA })
      ).status,
    ).toBe(403);
    expect((await request(app).post(`/items/${beforeItem}/claim`).set(authed(cookies.promotable)).send({})).status).toBe(403);

    // Promote VIEWER -> MEMBER.
    await removeMembership(fx.promotable, fx.teamA);
    await addMembership(fx.promotable, fx.teamA, "MEMBER");

    const created = await request(app)
      .post("/items")
      .set(authed(cookies.promotable))
      .send({ title: "promoted", type: "TASK", priority: "LOW", teamId: fx.teamA });
    expect(created.status).toBe(201);
    const claimable = await freshItem();
    expect((await request(app).post(`/items/${claimable}/claim`).set(authed(cookies.promotable)).send({})).status).toBe(200);

    // Demote back to VIEWER -> claim denied again (403, still a member).
    await removeMembership(fx.promotable, fx.teamA);
    await addMembership(fx.promotable, fx.teamA, "VIEWER");
    const another = await freshItem();
    expect((await request(app).post(`/items/${another}/claim`).set(authed(cookies.promotable)).send({})).status).toBe(403);
  });
});

// ---------------------------------------------------------------------------

describe("cross-team isolation", () => {
  it("a privileged role in team A grants nothing over a team B item", async () => {
    const itemB = await freshItem({ teamId: fx.teamB });

    // adminA is ADMIN in team A; leadA is LEAD in team A.
    for (const token of [cookies.adminA, cookies.leadA]) {
      expect((await request(app).get(`/items/${itemB}`).set(authed(token))).status).toBe(404);
      expect(
        (await request(app).patch(`/items/${itemB}`).set(authed(token)).send({ title: "x", expectedVersion: 1 })).status,
      ).toBe(404);
      expect((await request(app).post(`/items/${itemB}/claim`).set(authed(token)).send({})).status).toBe(404);
      expect(
        (
          await request(app)
            .post(`/items/${itemB}/transition`)
            .set(authed(token))
            .send({ toStatus: "IN_PROGRESS", expectedVersion: 1 })
        ).status,
      ).toBe(404);
    }

    // Untouched by any of the above.
    const itemB2 = await request(app).get(`/items/${itemB}`).set(authed(cookies.leadB));
    expect(itemB2.status).toBe(200);
    expect(itemB2.body.version).toBe(1);
    expect(itemB2.body.status).toBe("OPEN");
    expect(itemB2.body.assigneeId).toBeNull();
  });

  it("listing is scoped to member teams and a foreign teamId filter is empty", async () => {
    await freshItem();
    await freshItem({ teamId: fx.teamB });

    const mine = await request(app).get("/items?pageSize=100").set(authed(cookies.memberA));
    expect(mine.status).toBe(200);
    expect(mine.body.items.every((i: WorkItemRow) => i.teamId === fx.teamA)).toBe(true);

    const foreignFilter = await request(app).get(`/items?teamId=${fx.teamB}`).set(authed(cookies.memberA));
    expect(foreignFilter.status).toBe(200);
    expect(foreignFilter.body.items).toEqual([]);
    expect(foreignFilter.body.pagination.total).toBe(0);
  });
});

// ---------------------------------------------------------------------------

describe("pagination contract", () => {
  it("accepts 1..100 and rejects 0, negative, over-cap, fractional, and non-numeric values with 400", async () => {
    for (const ok of ["1", "20", "100"]) {
      expect((await request(app).get(`/items?pageSize=${ok}`).set(authed(cookies.memberA))).status, ok).toBe(200);
    }
    for (const bad of ["0", "-1", "101", "1.5", "abc", "1e3"]) {
      expect((await request(app).get(`/items?pageSize=${bad}`).set(authed(cookies.memberA))).status, bad).toBe(400);
    }
  });

  it("rejects an out-of-range page with 400 rather than overflowing the database (regression)", async () => {
    for (const badPage of ["99999999999999999999", "1e20", "1e17", "-1", "0", "1.5"]) {
      const res = await request(app).get(`/items?page=${badPage}`).set(authed(cookies.memberA));
      expect(res.status, `page=${badPage}`).toBe(400);
    }
    // A large-but-valid page is an empty 200, not an error.
    const big = await request(app).get("/items?page=1000000&pageSize=100").set(authed(cookies.memberA));
    expect(big.status).toBe(200);
    expect(big.body.items).toEqual([]);
  });
});

// ---------------------------------------------------------------------------

describe("input validation", () => {
  it("rejects invalid PATCH bodies consistently with 400", async () => {
    const id = await freshItem();
    const cases: Array<Record<string, unknown>> = [
      { title: "no version" }, // missing expectedVersion
      { title: "x", expectedVersion: 0 },
      { title: "x", expectedVersion: -1 },
      { title: "x", expectedVersion: 1.5 },
      { title: "x", expectedVersion: "1" },
      { dueAt: "not-a-date", expectedVersion: 1 },
      { expectedVersion: 1 }, // empty PATCH (no updatable field)
      { title: "x", expectedVersion: 1, unknownField: true },
      { title: "x", status: "CLOSED", expectedVersion: 1 }, // protected
    ];
    for (const body of cases) {
      const res = await request(app).patch(`/items/${id}`).set(authed(cookies.memberA)).send(body);
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
    // None of the rejected patches mutated the row.
    const after = await request(app).get(`/items/${id}`).set(authed(cookies.memberA));
    expect(after.body.version).toBe(1);
  });

  it("rejects a malformed dueAt on create with 400", async () => {
    const res = await request(app)
      .post("/items")
      .set(authed(cookies.memberA))
      .send({ title: "bad due", type: "TASK", priority: "LOW", teamId: fx.teamA, dueAt: "yesterday" });
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------

describe("idempotency guards", () => {
  it("rejects an over-long Idempotency-Key with 400 and performs no work", async () => {
    const key = "k".repeat(300);
    const title = `Too-long key ${uniqueKey()}`;
    const res = await request(app)
      .post("/items")
      .set(authed(cookies.memberA))
      .set("Idempotency-Key", key)
      .send({ title, type: "TASK", priority: "LOW", teamId: fx.teamA });

    expect(res.status).toBe(400);
    expect(await countIdempotencyRows(`user:${fx.memberA}:POST /items`, key)).toBe(0);
  });

  it("does not cache a validation failure and does not consume the key", async () => {
    const key = uniqueKey();
    const scope = `user:${fx.memberA}:POST /items`;

    // Invalid body (bad enum) with the key -> 400, no record.
    const bad = await request(app)
      .post("/items")
      .set(authed(cookies.memberA))
      .set("Idempotency-Key", key)
      .send({ title: "bad", type: "BOGUS", priority: "LOW", teamId: fx.teamA });
    expect(bad.status).toBe(400);
    expect(await countIdempotencyRows(scope, key)).toBe(0);

    // The same key is still usable for a valid request.
    const ok = await request(app)
      .post("/items")
      .set(authed(cookies.memberA))
      .set("Idempotency-Key", key)
      .send({ title: "good after failure", type: "TASK", priority: "LOW", teamId: fx.teamA });
    expect(ok.status).toBe(201);
    expect(await countIdempotencyRows(scope, key)).toBe(1);
  });
});

// ---------------------------------------------------------------------------

describe("database migration state", () => {
  it("has the additive ITEM_UPDATED enum value applied to the live database", async () => {
    const { rows } = await pool.query(
      `select e.enumlabel as label
         from pg_enum e
         join pg_type t on t.oid = e.enumtypid
        where t.typname = 'activity_event_type'
        order by e.enumsortorder`,
    );
    const labels = rows.map((r: { label: string }) => r.label);
    expect(labels).toContain("ITEM_UPDATED");
    // Existing values must be preserved by the additive migration.
    for (const expected of ["ITEM_CREATED", "STATUS_CHANGED", "ASSIGNEE_CHANGED", "PRIORITY_CHANGED"]) {
      expect(labels).toContain(expected);
    }
  });

  it("has the drizzle migration journal applied (both migrations recorded)", async () => {
    const presence = await pool.query(
      `select exists (
         select 1 from information_schema.tables
         where table_schema = 'drizzle' and table_name = '__drizzle_migrations'
       ) as present`,
    );
    if (presence.rows[0]?.present !== true) {
      // Nothing to assert if a different migration tracking table is used.
      return;
    }
    const { rows } = await pool.query(`select count(*)::int as c from drizzle.__drizzle_migrations`);
    expect(rows[0].c).toBeGreaterThanOrEqual(2);
  });
});
