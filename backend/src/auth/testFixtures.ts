import bcrypt from "bcryptjs";
import { and, eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { users } from "../db/schema/users.js";
import { teams } from "../db/schema/teams.js";
import { userTeamMemberships } from "../db/schema/memberships.js";
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

/** Remove fixture rows in FK-safe order: memberships, then users, then teams. */
export async function cleanupFixture(opts: {
  userIds?: string[];
  teamIds?: string[];
}): Promise<void> {
  const { userIds = [], teamIds = [] } = opts;
  for (const uid of userIds) {
    await db.delete(userTeamMemberships).where(eq(userTeamMemberships.userId, uid));
    await db.delete(users).where(eq(users.id, uid));
  }
  for (const tid of teamIds) {
    await clearTeamMemberships(tid);
    await db.delete(teams).where(eq(teams.id, tid));
  }
}
