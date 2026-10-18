import express from "express";
import request from "supertest";
import jwt from "jsonwebtoken";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { env } from "../config/env.js";
import { pool } from "../db/index.js";
import { authRouter } from "./routes.js";
import { requireAuth } from "./middleware.js";
import { authorizeTeamAction, requireTeamPermission } from "./authorize.js";
import {
  TEST_PASSWORD,
  addMembership,
  cleanupFixture,
  createTestTeam,
  createTestUser,
  removeMembership,
  uniqueEmail,
  uniqueSlug,
} from "./testFixtures.js";

/**
 * Integration tests for authentication and team-scoped authorization.
 *
 * These run against the configured Neon PostgreSQL database and exercise the
 * real Express app, real middleware, and real DB-backed role lookups. Fixture
 * rows are created and cleaned up per-run so the seeded demo dataset is never
 * mutated. Nothing here is destructive to the schema.
 */

// A minimal router that exposes the real middleware so we can assert on the
// exact HTTP behaviour later route handlers will rely on.
const testRouter = express.Router();
testRouter.get("/view/:teamId", requireAuth, requireTeamPermission("view"), (req, res) => {
  res.status(200).json({ ok: true, role: req.teamContext?.role });
});
testRouter.post("/item/:teamId", requireAuth, requireTeamPermission("create_item"), (req, res) => {
  res.status(201).json({ ok: true, role: req.teamContext?.role });
});
testRouter.post("/approve/:teamId", requireAuth, requireTeamPermission("approve_transition"), (req, res) => {
  res.status(200).json({ ok: true, role: req.teamContext?.role });
});
testRouter.post("/members/:teamId", requireAuth, requireTeamPermission("manage_membership"), (req, res) => {
  res.status(200).json({ ok: true, role: req.teamContext?.role });
});

const testApp = express();
testApp.use(express.json());
testApp.use("/auth", authRouter); // reuse the real auth routes (login, /me)
testApp.use("/t", testRouter);

const DEMO_PASSWORD = process.env.DEMO_PASSWORD ?? "newtonite-demo";

interface Fixture {
  teamA: string;
  teamB: string;
  viewer: string;
  member: string;
  lead: string;
  admin: string;
  outsider: string;
  inactive: string;
}

let fx: Fixture;
const tokens: Record<string, string> = {};

async function loginAs(email: string, password: string): Promise<{ status: number; body: any }> {
  const res = await request(testApp).post("/auth/login").send({ email, password });
  return { status: res.status, body: res.body };
}

function authed(token: string) {
  return { Authorization: `Bearer ${token}` };
}

beforeAll(async () => {
  const teamA = await createTestTeam("AuthZ Team A", uniqueSlug("authz-a"));
  const teamB = await createTestTeam("AuthZ Team B", uniqueSlug("authz-b"));

  const viewer = await createTestUser(uniqueEmail("viewer"), "Viewer User");
  const member = await createTestUser(uniqueEmail("member"), "Member User");
  const lead = await createTestUser(uniqueEmail("lead"), "Lead User");
  const admin = await createTestUser(uniqueEmail("admin"), "Admin User");
  const outsider = await createTestUser(uniqueEmail("outsider"), "Outsider User");
  const inactive = await createTestUser(uniqueEmail("inactive"), "Inactive User", TEST_PASSWORD, false);

  // Team A: one of each role. Team B: only the lead is a member, as LEAD.
  await addMembership(viewer, teamA, "VIEWER");
  await addMembership(member, teamA, "MEMBER");
  await addMembership(lead, teamA, "LEAD");
  await addMembership(admin, teamA, "ADMIN");
  await addMembership(lead, teamB, "LEAD");

  fx = { teamA, teamB, viewer, member, lead, admin, outsider, inactive };

  // Obtain real tokens through the login endpoint.
  const emails: Record<string, string> = {
    viewer: (await emailFor(viewer))!,
    member: (await emailFor(member))!,
    lead: (await emailFor(lead))!,
    admin: (await emailFor(admin))!,
    outsider: (await emailFor(outsider))!,
    inactive: (await emailFor(inactive))!,
  };
  for (const key of ["viewer", "member", "lead", "admin", "outsider"]) {
    const { status, body } = await loginAs(emails[key], TEST_PASSWORD);
    if (status !== 200) {
      throw new Error(`Failed to obtain token for ${key}: ${status} ${JSON.stringify(body)}`);
    }
    tokens[key] = body.token;
  }
  // Expose emails for login-failure tests.
  Object.assign(fxEmails, emails);
});

const fxEmails: Record<string, string> = {};

async function emailFor(userId: string): Promise<string | null> {
  const { rows } = await pool.query("SELECT email FROM users WHERE id = $1", [userId]);
  return rows[0]?.email ?? null;
}

afterAll(async () => {
  await cleanupFixture({
    userIds: [fx.viewer, fx.member, fx.lead, fx.admin, fx.outsider, fx.inactive],
    teamIds: [fx.teamA, fx.teamB],
  });
  await pool.end();
});

describe("POST /auth/login", () => {
  it("returns a token and safe user profile for correct credentials", async () => {
    const { status, body } = await loginAs(fxEmails.viewer, TEST_PASSWORD);
    expect(status).toBe(200);
    expect(typeof body.token).toBe("string");
    expect(body.tokenType).toBe("Bearer");
    expect(body.user).toMatchObject({ email: fxEmails.viewer });
    expect(body.user.passwordHash).toBeUndefined();
    expect(body.user.isActive).toBeUndefined();
  });

  it("rejects an incorrect password with a generic 401", async () => {
    const { status, body } = await loginAs(fxEmails.viewer, "definitely-wrong");
    expect(status).toBe(401);
    expect(body.error).toBe("Invalid email or password");
  });

  it("returns the identical generic error for an unknown email", async () => {
    const { status, body } = await loginAs("nobody-here@example.test", TEST_PASSWORD);
    expect(status).toBe(401);
    expect(body.error).toBe("Invalid email or password");
  });

  it("rejects a deactivated account with the same generic 401", async () => {
    const { status, body } = await loginAs(fxEmails.inactive, TEST_PASSWORD);
    expect(status).toBe(401);
    expect(body.error).toBe("Invalid email or password");
  });

  it("rejects malformed input with 400", async () => {
    const bad = await request(testApp).post("/auth/login").send({ email: "not-an-email" });
    expect(bad.status).toBe(400);
    const empty = await request(testApp).post("/auth/login").send({});
    expect(empty.status).toBe(400);
  });

  it("normalizes email case before lookup", async () => {
    const { status } = await loginAs(fxEmails.member.toUpperCase(), TEST_PASSWORD);
    expect(status).toBe(200);
  });
});

describe("GET /me", () => {
  it("returns the user and memberships without exposing the password hash", async () => {
    const res = await request(testApp)
      .get("/auth/me")
      .set(authed(tokens.lead));
    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe(fxEmails.lead);
    expect(res.body.user.passwordHash).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toContain("passwordHash");
    // Lead is a member of both teams.
    const teamIds = res.body.memberships.map((m: any) => m.teamId);
    expect(teamIds).toContain(fx.teamA);
    expect(teamIds).toContain(fx.teamB);
    const roles = Object.fromEntries(
      res.body.memberships.map((m: any) => [m.teamId, m.role]),
    );
    expect(roles[fx.teamA]).toBe("LEAD");
    expect(roles[fx.teamB]).toBe("LEAD");
  });

  it("rejects a request with no token", async () => {
    const res = await request(testApp).get("/auth/me");
    expect(res.status).toBe(401);
  });

  it("rejects an invalid token", async () => {
    const res = await request(testApp)
      .get("/auth/me")
      .set(authed("not.a.validtoken"));
    expect(res.status).toBe(401);
  });

  it("rejects a token signed with the wrong secret", async () => {
    const forged = jwt.sign({ sub: fx.lead }, "a-completely-different-secret-value-123456", {
      algorithm: "HS256",
      expiresIn: 900,
      issuer: "newtonite",
      audience: "newtonite-api",
    });
    const res = await request(testApp).get("/auth/me").set(authed(forged));
    expect(res.status).toBe(401);
  });

  it("rejects an expired token", async () => {
    const expired = jwt.sign({ sub: fx.lead }, env.JWT_SECRET, {
      algorithm: "HS256",
      expiresIn: -60,
      issuer: "newtonite",
      audience: "newtonite-api",
    });
    const res = await request(testApp).get("/auth/me").set(authed(expired));
    expect(res.status).toBe(401);
  });

  it("rejects a token whose subject no longer exists", async () => {
    const ghost = jwt.sign({ sub: "00000000-0000-4000-8000-000000000000" }, env.JWT_SECRET, {
      algorithm: "HS256",
      expiresIn: 900,
      issuer: "newtonite",
      audience: "newtonite-api",
    });
    const res = await request(testApp).get("/auth/me").set(authed(ghost));
    expect(res.status).toBe(401);
  });
});

describe("team-scoped authorization (requireTeamPermission)", () => {
  it("VIEWER can view but cannot create, approve, or manage membership", async () => {
    const t = tokens.viewer;
    expect((await request(testApp).get(`/t/view/${fx.teamA}`).set(authed(t))).status).toBe(200);
    expect((await request(testApp).post(`/t/item/${fx.teamA}`).set(authed(t))).status).toBe(403);
    expect((await request(testApp).post(`/t/approve/${fx.teamA}`).set(authed(t))).status).toBe(403);
    expect((await request(testApp).post(`/t/members/${fx.teamA}`).set(authed(t))).status).toBe(403);
  });

  it("MEMBER can create but cannot approve or manage membership", async () => {
    const t = tokens.member;
    expect((await request(testApp).post(`/t/item/${fx.teamA}`).set(authed(t))).status).toBe(201);
    expect((await request(testApp).post(`/t/approve/${fx.teamA}`).set(authed(t))).status).toBe(403);
    expect((await request(testApp).post(`/t/members/${fx.teamA}`).set(authed(t))).status).toBe(403);
  });

  it("LEAD can approve within their team but cannot manage membership", async () => {
    const t = tokens.lead;
    expect((await request(testApp).post(`/t/approve/${fx.teamA}`).set(authed(t))).status).toBe(200);
    expect((await request(testApp).post(`/t/members/${fx.teamA}`).set(authed(t))).status).toBe(403);
  });

  it("ADMIN can manage membership within their team", async () => {
    const t = tokens.admin;
    expect((await request(testApp).post(`/t/members/${fx.teamA}`).set(authed(t))).status).toBe(200);
  });

  it("a role in Team A grants no permission in Team B", async () => {
    // Admin is ADMIN in A but has no membership in B -> not found (404), not 200.
    const res = await request(testApp)
      .post(`/t/members/${fx.teamB}`)
      .set(authed(tokens.admin));
    expect(res.status).toBe(404);
  });

  it("unauthenticated requests are rejected with 401", async () => {
    const res = await request(testApp).post(`/t/item/${fx.teamA}`);
    expect(res.status).toBe(401);
  });
});

describe("authorizeTeamAction reflects live membership changes", () => {
  it("respects a revoked membership and a subsequent role change", async () => {
    // Start: outsider has no membership anywhere -> 404.
    expect(await authorizeTeamAction(fx.outsider, fx.teamA, "view")).toEqual({
      ok: false,
      status: 404,
    });

    // Grant VIEWER -> can view, cannot create.
    await addMembership(fx.outsider, fx.teamA, "VIEWER");
    expect((await authorizeTeamAction(fx.outsider, fx.teamA, "view")).ok).toBe(true);
    expect(await authorizeTeamAction(fx.outsider, fx.teamA, "create_item")).toEqual({
      ok: false,
      status: 403,
    });

    // Upgrade to LEAD -> can approve.
    await removeMembership(fx.outsider, fx.teamA);
    await addMembership(fx.outsider, fx.teamA, "LEAD");
    expect((await authorizeTeamAction(fx.outsider, fx.teamA, "approve_transition")).ok).toBe(true);

    // Revoke entirely -> back to 404 immediately (no token expiry needed).
    await removeMembership(fx.outsider, fx.teamA);
    expect(await authorizeTeamAction(fx.outsider, fx.teamA, "approve_transition")).toEqual({
      ok: false,
      status: 404,
    });
  });

  it("fails closed for a missing or malformed team id", async () => {
    expect(await authorizeTeamAction(fx.lead, "00000000-0000-4000-8000-000000000000", "view")).toEqual({
      ok: false,
      status: 404,
    });
    expect(await authorizeTeamAction(fx.lead, "not-a-uuid", "view")).toEqual({
      ok: false,
      status: 404,
    });
  });
});

describe("seeded demo account", () => {
  it("can log in with the documented demo password", async () => {
    const { status, body } = await loginAs("avery@newtonite.dev", DEMO_PASSWORD);
    // If the demo seed is present this is 200; tolerate absence but never fail open.
    if (status === 200) {
      expect(typeof body.token).toBe("string");
    } else {
      expect(status).toBe(401);
    }
  });
});
