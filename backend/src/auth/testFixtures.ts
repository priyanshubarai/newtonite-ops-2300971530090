import bcrypt from "bcryptjs";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../db/index.js";
import { users } from "../db/schema/users.js";
import { teams } from "../db/schema/teams.js";
import { userTeamMemberships } from "../db/schema/memberships.js";
import { workItems } from "../db/schema/work_items.js";
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

/** Delete work items belonging to any of the given teams (FK-safe cleanup). */
export async function deleteWorkItemsForTeams(teamIds: string[]): Promise<void> {
  if (teamIds.length === 0) return;
  await db.delete(workItems).where(inArray(workItems.teamId, teamIds));
}

/** Remove fixture rows in FK-safe order: work items, memberships, users, teams. */
export async function cleanupFixture(opts: {
  userIds?: string[];
  teamIds?: string[];
}): Promise<void> {
  const { userIds = [], teamIds = [] } = opts;
  // Work items reference teams and creator/assignee users with RESTRICT/set-null
  // foreign keys, so they must go first.
  await deleteWorkItemsForTeams(teamIds);
  for (const uid of userIds) {
    await db.delete(userTeamMemberships).where(eq(userTeamMemberships.userId, uid));
    await db.delete(users).where(eq(users.id, uid));
  }
  for (const tid of teamIds) {
    await clearTeamMemberships(tid);
    await db.delete(teams).where(eq(teams.id, tid));
  }
}
