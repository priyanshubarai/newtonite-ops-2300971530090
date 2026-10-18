import { and, eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { users } from "../db/schema/users.js";
import { teams } from "../db/schema/teams.js";
import { userTeamMemberships } from "../db/schema/memberships.js";
import { isTeamRole, type TeamRole } from "./policy.js";
import type { AuthUser } from "./types.js";

/**
 * Database-backed identity and membership lookups.
 *
 * Roles and memberships are always read fresh from PostgreSQL here rather than
 * being trusted from a token claim. That means a role change or membership
 * revocation is honoured on the very next request without waiting for a token
 * to expire.
 */

/** Fetch a user by id, projecting only safe fields (never the password hash). */
export async function findUserById(id: string): Promise<AuthUser | null> {
  const rows = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      isActive: users.isActive,
    })
    .from(users)
    .where(eq(users.id, id))
    .limit(1);

  const row = rows[0];
  return row ? { ...row } : null;
}

/**
 * Fetch a user by email for login. Includes the password hash because login
 * must verify it, but the result is never returned to a client. Email is
 * lower-cased to match the seed's normalization convention.
 */
export async function findUserByEmailWithHash(email: string): Promise<
  | { id: string; email: string; name: string; isActive: boolean; passwordHash: string }
  | null
> {
  const rows = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      isActive: users.isActive,
      passwordHash: users.passwordHash,
    })
    .from(users)
    .where(eq(users.email, email.toLowerCase()))
    .limit(1);

  const row = rows[0];
  return row ? { ...row } : null;
}

/**
 * Resolve a user's role in one specific team. Returns `null` when the user is
 * not a member of that team or the stored value is not a recognised role
 * (fail closed).
 */
export async function getTeamRole(userId: string, teamId: string): Promise<TeamRole | null> {
  const rows = await db
    .select({ role: userTeamMemberships.role })
    .from(userTeamMemberships)
    .where(
      and(
        eq(userTeamMemberships.userId, userId),
        eq(userTeamMemberships.teamId, teamId),
      ),
    )
    .limit(1);

  const role = rows[0]?.role;
  return isTeamRole(role) ? role : null;
}

export interface MembershipSummary {
  teamId: string;
  teamName: string;
  teamSlug: string;
  role: TeamRole;
}

/** Load all of a user's team memberships with team names, for `GET /me`. */
export async function getMembershipsForUser(userId: string): Promise<MembershipSummary[]> {
  const rows = await db
    .select({
      teamId: teams.id,
      teamName: teams.name,
      teamSlug: teams.slug,
      role: userTeamMemberships.role,
    })
    .from(userTeamMemberships)
    .innerJoin(teams, eq(userTeamMemberships.teamId, teams.id))
    .where(eq(userTeamMemberships.userId, userId));

  return rows
    .filter((r): r is MembershipSummary & { role: TeamRole } => isTeamRole(r.role))
    .map((r) => ({
      teamId: r.teamId,
      teamName: r.teamName,
      teamSlug: r.teamSlug,
      role: r.role,
    }));
}
