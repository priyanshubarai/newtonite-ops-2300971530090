import { createHash } from "node:crypto";
import bcrypt from "bcryptjs";
import { eq, sql } from "drizzle-orm";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import {
  users,
  teams,
  userTeamMemberships,
  workItems,
  activityEvents,
  comments,
} from "./src/db/schema/index.js";
import type { teamRoleEnum, workItemTypeEnum, workPriorityEnum, workStatusEnum } from "./src/db/schema/enums.js";

// Use standard pg Pool (not neon-serverless) so seed works with local PostgreSQL
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});
const db = drizzle(pool);

type Role = (typeof teamRoleEnum.enumValues)[number];
type ItemType = (typeof workItemTypeEnum.enumValues)[number];
type Priority = (typeof workPriorityEnum.enumValues)[number];
type Status = (typeof workStatusEnum.enumValues)[number];

/**
 * Deterministic UUID (v5-style: SHA-1 of namespace + name) so re-running the
 * seed upserts the same logical rows instead of creating duplicates. This is
 * what makes the seed repeatable without a separate mapping table.
 */
const NAMESPACE = "1b671a64-40d5-491e-99b0-da01ff1f3341";
function seedUuid(name: string): string {
  const h = createHash("sha1").update(`${NAMESPACE}:${name}`).digest("hex");
  return [
    h.slice(0, 8),
    h.slice(8, 12),
    `5${h.slice(13, 16)}`,
    ((parseInt(h[16], 16) & 0x3) | 0x8).toString(16) + h.slice(17, 20),
    h.slice(20, 32),
  ].join("-");
}

// Development-only demo password. Clearly labelled as a local demo account;
// hashed with bcrypt (never stored in plaintext).
const DEMO_PASSWORD = process.env.DEMO_PASSWORD ?? "newtonite-demo";
const BCRYPT_ROUNDS = 10;

const TEAM_SEEDS = [
  { slug: "payments", name: "Payments Operations" },
  { slug: "support", name: "Customer Support" },
  { slug: "compliance", name: "Compliance & Risk" },
  { slug: "platform", name: "Platform Engineering" },
];

const USER_SEEDS = [
  { email: "avery@newtonite.dev", name: "Avery Chen" },
  { email: "blake@newtonite.dev", name: "Blake Rivera" },
  { email: "casey@newtonite.dev", name: "Casey Morgan" },
  { email: "devon@newtonite.dev", name: "Devon Park" },
  { email: "emery@newtonite.dev", name: "Emery Sutton" },
  { email: "finley@newtonite.dev", name: "Finley Brooks" },
  { email: "gray@newtonite.dev", name: "Gray Nakamura" },
  { email: "harper@newtonite.dev", name: "Harper Diaz" },
  { email: "indigo@newtonite.dev", name: "Indigo Frost" },
  { email: "juniper@newtonite.dev", name: "Juniper Wells" },
];

// Each entry: user email -> array of { teamSlug, role }. Covers all four roles
// and multiple memberships for several users (multi-team membership).
const MEMBERSHIP_SEEDS: Array<{ email: string; team: string; role: Role }> = [
  { email: "avery@newtonite.dev", team: "payments", role: "ADMIN" },
  { email: "avery@newtonite.dev", team: "platform", role: "ADMIN" },
  { email: "blake@newtonite.dev", team: "payments", role: "LEAD" },
  { email: "blake@newtonite.dev", team: "support", role: "MEMBER" },
  { email: "casey@newtonite.dev", team: "support", role: "LEAD" },
  { email: "devon@newtonite.dev", team: "compliance", role: "LEAD" },
  { email: "emery@newtonite.dev", team: "platform", role: "LEAD" },
  { email: "finley@newtonite.dev", team: "payments", role: "MEMBER" },
  { email: "finley@newtonite.dev", team: "compliance", role: "MEMBER" },
  { email: "gray@newtonite.dev", team: "support", role: "MEMBER" },
  { email: "harper@newtonite.dev", team: "compliance", role: "MEMBER" },
  { email: "harper@newtonite.dev", team: "platform", role: "MEMBER" },
  { email: "indigo@newtonite.dev", team: "payments", role: "VIEWER" },
  { email: "juniper@newtonite.dev", team: "support", role: "VIEWER" },
];

const ITEM_TYPES: ItemType[] = ["INCIDENT", "CUSTOMER_ISSUE", "PAYMENT", "COMPLIANCE", "TASK"];
const PRIORITIES: Priority[] = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];
const STATUSES: Status[] = ["OPEN", "IN_PROGRESS", "AWAITING_APPROVAL", "RESOLVED", "CLOSED"];

const TITLE_PATTERNS: Record<ItemType, string> = {
  INCIDENT: "Investigate service degradation",
  CUSTOMER_ISSUE: "Resolve customer escalation",
  PAYMENT: "Reconcile disputed payment",
  COMPLIANCE: "Handle compliance data request",
  TASK: "Complete operational task",
};

const TARGET_ITEM_COUNT = 2500;

async function upsert(
  table: any,
  values: any[],
  conflictColumns: any[],
  target: any,
) {
  if (values.length === 0) return;
  await db
    .insert(table)
    .values(values)
    .onConflictDoUpdate({ target: conflictColumns, set: target })
    .execute();
}

async function main() {
  console.log("Seeding Newtonite demo data (repeatable)...");

  // --- Users -------------------------------------------------------------
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, BCRYPT_ROUNDS);
  const userRows = USER_SEEDS.map((u) => ({
    id: seedUuid(`user:${u.email}`),
    email: u.email,
    name: u.name,
    passwordHash,
    isActive: true,
  }));
  await upsert(users, userRows, [users.email], {
    name: sql`excluded.name`,
    passwordHash: sql`excluded.password_hash`,
    isActive: sql`true`,
    updatedAt: sql`now()`,
  });
  console.log(`  users: ${userRows.length}`);

  // --- Teams -------------------------------------------------------------
  const teamRows = TEAM_SEEDS.map((t) => ({
    id: seedUuid(`team:${t.slug}`),
    slug: t.slug,
    name: t.name,
  }));
  await upsert(teams, teamRows, [teams.slug], {
    name: sql`excluded.name`,
    updatedAt: sql`now()`,
  });
  console.log(`  teams: ${teamRows.length}`);

  // --- Memberships -------------------------------------------------------
  const membershipRows = MEMBERSHIP_SEEDS.map((m) => ({
    id: seedUuid(`membership:${m.email}:${m.team}`),
    userId: seedUuid(`user:${m.email}`),
    teamId: seedUuid(`team:${m.team}`),
    role: m.role,
  }));
  await upsert(userTeamMemberships, membershipRows, [userTeamMemberships.userId, userTeamMemberships.teamId], {
    role: sql`excluded.role`,
    updatedAt: sql`now()`,
  });
  console.log(`  memberships: ${membershipRows.length}`);

  // --- Work items --------------------------------------------------------
  // Deterministic ids (item:00001...) keep re-runs idempotent.
  const teamSlugs = TEAM_SEEDS.map((t) => t.slug);
  const memberEmails = MEMBERSHIP_SEEDS.map((m) => m.email);
  const itemRows = Array.from({ length: TARGET_ITEM_COUNT }, (_, i) => {
    const type = ITEM_TYPES[i % ITEM_TYPES.length];
    const teamSlug = teamSlugs[i % teamSlugs.length];
    const creatorEmail = memberEmails[i % memberEmails.length];
    // Spread statuses across the whole lifecycle for realistic dashboards.
    const status = STATUSES[i % STATUSES.length];
    const priority = PRIORITIES[(i >> 1) % PRIORITIES.length];
    const assigneeEmail =
      i % 3 === 0 ? null : memberEmails[(i + 2) % memberEmails.length];
    const dueAt = i % 4 === 0 ? null : new Date(Date.now() + (i % 30) * 86400000);
    return {
      id: seedUuid(`item:${i}`),
      title: `${TITLE_PATTERNS[type]} #${i + 1}`,
      description: `Seeded ${type.toLowerCase()} work item used for local development and pagination testing.`,
      type,
      priority,
      status,
      teamId: seedUuid(`team:${teamSlug}`),
      assigneeId: assigneeEmail ? seedUuid(`user:${assigneeEmail}`) : null,
      createdBy: seedUuid(`user:${creatorEmail}`),
      dueAt,
      version: 1,
    };
  });
  // Batch to keep statements reasonably sized.
  for (let i = 0; i < itemRows.length; i += 500) {
    const batch = itemRows.slice(i, i + 500);
    await db
      .insert(workItems)
      .values(batch)
      .onConflictDoUpdate({ target: [workItems.id], set: { updatedAt: sql`now()` } })
      .execute();
  }
  console.log(`  work_items: ${itemRows.length}`);

  // --- Comments + activity events (representative subset) ----------------
  const commentRows: any[] = [];
  const eventRows: any[] = [];
  for (let i = 0; i < 200; i++) {
    const itemId = seedUuid(`item:${i}`);
    const actorId = seedUuid(`user:${memberEmails[i % memberEmails.length]}`);
    commentRows.push({
      id: seedUuid(`comment:${i}`),
      workItemId: itemId,
      authorId: actorId,
      body: `Seeded comment ${i + 1} on this work item.`,
    });
    eventRows.push({
      id: seedUuid(`event:${i}:created`),
      workItemId: itemId,
      actorId,
      eventType: "ITEM_CREATED",
      metadata: { status: "OPEN" },
    });
    eventRows.push({
      id: seedUuid(`event:${i}:status`),
      workItemId: itemId,
      actorId,
      eventType: "STATUS_CHANGED",
      metadata: { before: "OPEN", after: STATUSES[i % STATUSES.length] },
    });
    eventRows.push({
      id: seedUuid(`event:${i}:priority`),
      workItemId: itemId,
      actorId,
      eventType: "PRIORITY_CHANGED",
      metadata: { before: "LOW", after: PRIORITIES[i % PRIORITIES.length] },
    });
  }
  await upsert(comments, commentRows, [comments.id], { body: sql`excluded.body` });
  await upsert(activityEvents, eventRows, [activityEvents.id], {
    metadata: sql`excluded.metadata`,
  });
  console.log(`  comments: ${commentRows.length}`);
  console.log(`  activity_events: ${eventRows.length}`);

  const [u] = await db.select({ c: sql<number>`count(*)::int` }).from(users);
  const [w] = await db.select({ c: sql<number>`count(*)::int` }).from(workItems);
  console.log(`\nSeeded totals -> users: ${u.c}, work_items: ${w.c}`);
  console.log("Demo login: any seeded email / password: (see docs — development only)");
}

main()
  .then(async () => {
    await pool.end();
  })
  .catch(async (e) => {
    console.error("SEED FAILED:", e.message);
    await pool.end();
    process.exit(1);
  });
