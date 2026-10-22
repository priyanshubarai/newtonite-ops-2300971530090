import bcrypt from "bcryptjs";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { users } from "../db/schema/users.js";
import { teams } from "../db/schema/teams.js";
import { userTeamMemberships } from "../db/schema/memberships.js";
import { workItems } from "../db/schema/work_items.js";
import { activityEvents } from "../db/schema/activity_events.js";
import { comments } from "../db/schema/comments.js";
import { idempotencyRecords } from "../db/schema/idempotency_records.js";
import { outboxJobs } from "../db/schema/outbox_jobs.js";
import { teamRoleEnum } from "../db/schema/enums.js";

type Role = (typeof teamRoleEnum.enumValues)[number];

/**
 * Self-contained integration-test fixtures.
 *
 * These create throwaway users/teams/memberships with unique identifiers and
 * clean them up afterwards, so the authorization tests never mutate the seeded
 * demo dataset and can exercise role changes and revocation safely.
 */

let counter = 0;
function uniqueSuffix(): string {
  counter += 1;
  return `${Date.now().toString(36)}-${counter}-${Math.random().toString(36).slice(2, 8)}`;
}

export const TEST_PASSWORD = "Sup3r-secret-test-pass";

export function uniqueEmail(prefix = "authtest"): string {
  return `${prefix}-${uniqueSuffix()}@example.test`;
}

export function uniqueSlug(prefix = "authtest"): string {
  return `${prefix}-${uniqueSuffix()}`;
}

export async function createTestUser(
  email: string,
  name: string,
  password: string = TEST_PASSWORD,
  isActive = true,
): Promise<string> {
  const passwordHash = await bcrypt.hash(password, 10);
  const [row] = await db
    .insert(users)
    .values({ email, name, passwordHash, isActive })
    .returning({ id: users.id });
  return row.id;
}

export async function createTestTeam(name: string, slug: string): Promise<string> {
  const [row] = await db.insert(teams).values({ name, slug }).returning({ id: teams.id });
  return row.id;
}

export async function addMembership(userId: string, teamId: string, role: Role): Promise<void> {
  await db.insert(userTeamMemberships).values({ userId, teamId, role });
}

export async function removeMembership(userId: string, teamId: string): Promise<void> {
  await db
    .delete(userTeamMemberships)
    .where(
      and(
        eq(userTeamMemberships.userId, userId),
        eq(userTeamMemberships.teamId, teamId),
      ),
    );
}

/** Delete any membership rows for a team regardless of which user owns them. */
async function clearTeamMemberships(teamId: string): Promise<void> {
  await db.delete(userTeamMemberships).where(eq(userTeamMemberships.teamId, teamId));
}

/** Inserts a throwaway work item and returns its id. */
export async function createTestWorkItem(opts: {
  teamId: string;
  createdBy: string;
  title?: string;
  description?: string | null;
  type?: (typeof workItems.$inferInsert)["type"];
  priority?: (typeof workItems.$inferInsert)["priority"];
  status?: (typeof workItems.$inferInsert)["status"];
  assigneeId?: string | null;
  dueAt?: Date | null;
}): Promise<string> {
  const [row] = await db
    .insert(workItems)
    .values({
      teamId: opts.teamId,
      createdBy: opts.createdBy,
      title: opts.title ?? "Test work item",
      description: opts.description ?? null,
      type: opts.type ?? "TASK",
      priority: opts.priority ?? "MEDIUM",
      status: opts.status ?? "OPEN",
      assigneeId: opts.assigneeId ?? null,
      dueAt: opts.dueAt ?? null,
    })
    .returning({ id: workItems.id });
  return row.id;
}

/** Read one work-item row (used to assert version/status/assignee after a call). */
export async function getWorkItemRow(id: string) {
  const rows = await db.select().from(workItems).where(eq(workItems.id, id)).limit(1);
  return rows[0] ?? null;
}

/** Activity events for a work item, oldest first. */
export async function listActivityEvents(workItemId: string) {
  return db
    .select()
    .from(activityEvents)
    .where(eq(activityEvents.workItemId, workItemId))
    .orderBy(asc(activityEvents.createdAt));
}

export async function countActivityEvents(workItemId: string): Promise<number> {
  const rows = await db
    .select({ value: sql<number>`count(*)::int` })
    .from(activityEvents)
    .where(eq(activityEvents.workItemId, workItemId));
  return rows[0]?.value ?? 0;
}

/** Count outbox jobs enqueued for a work item (matched on the payload join key). */
export async function countOutboxJobs(workItemId: string): Promise<number> {
  const rows = await db
    .select({ value: sql<number>`count(*)::int` })
    .from(outboxJobs)
    .where(sql`${outboxJobs.payload}->>'workItemId' = ${workItemId}`);
  return rows[0]?.value ?? 0;
}

/**
 * Remove a fixture's work-item *graph* in FK-safe order. Activity events and
 * comments reference work items with `ON DELETE RESTRICT`, so they must go
 * first; outbox jobs have no FK, so they are matched on their payload join key.
 */
async function clearWorkItemGraph(teamIds: string[]): Promise<void> {
  if (teamIds.length === 0) return;

  const owned = await db
    .select({ id: workItems.id })
    .from(workItems)
    .where(inArray(workItems.teamId, teamIds));
  const itemIds = owned.map((r) => r.id);

  if (itemIds.length > 0) {
    await db.delete(activityEvents).where(inArray(activityEvents.workItemId, itemIds));
    await db.delete(comments).where(inArray(comments.workItemId, itemIds));
    const idList = sql.join(
      itemIds.map((id) => sql`${id}`),
      sql`, `,
    );
    await db.delete(outboxJobs).where(sql`${outboxJobs.payload}->>'workItemId' IN (${idList})`);
  }
  await db.delete(workItems).where(inArray(workItems.teamId, teamIds));
}

/** Remove fixture rows in FK-safe order: item graph, idempotency, memberships, users, teams. */
export async function cleanupFixture(opts: {
  userIds?: string[];
  teamIds?: string[];
}): Promise<void> {
  const { userIds = [], teamIds = [] } = opts;

  // Work-item graph first: activity events/comments reference items, and items
  // reference teams/users with RESTRICT/set-null.
  await clearWorkItemGraph(teamIds);

  for (const uid of userIds) {
    // Idempotency records reference users with RESTRICT.
    await db.delete(idempotencyRecords).where(eq(idempotencyRecords.userId, uid));
    await db.delete(userTeamMemberships).where(eq(userTeamMemberships.userId, uid));
    await db.delete(users).where(eq(users.id, uid));
  }
  for (const tid of teamIds) {
    await clearTeamMemberships(tid);
    await db.delete(teams).where(eq(teams.id, tid));
  }
}
