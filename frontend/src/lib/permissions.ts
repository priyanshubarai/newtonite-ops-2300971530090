import type { Membership, TeamRole } from "../api/types";

/**
 * Role capability helpers mirroring `backend/src/auth/policy.ts`.
 *
 * These exist only to avoid offering controls that would certainly be
 * rejected; the backend re-checks every request and is the real authority.
 */

const CREATE_ITEM_ROLES: readonly TeamRole[] = ["MEMBER", "LEAD", "ADMIN"];
const EDIT_ITEM_ROLES: readonly TeamRole[] = ["MEMBER", "LEAD", "ADMIN"];
const APPROVE_ROLES: readonly TeamRole[] = ["LEAD", "ADMIN"];

export function canCreateItem(role: TeamRole | null): boolean {
  return role !== null && CREATE_ITEM_ROLES.includes(role);
}

export function canEditItem(role: TeamRole | null): boolean {
  return role !== null && EDIT_ITEM_ROLES.includes(role);
}

export function canClaimItem(role: TeamRole | null): boolean {
  return role !== null && EDIT_ITEM_ROLES.includes(role);
}

export function canApproveTransition(role: TeamRole | null): boolean {
  return role !== null && APPROVE_ROLES.includes(role);
}

/** Role the user holds in a given team, or null when not a member. */
export function roleForTeam(
  memberships: readonly Membership[],
  teamId: string | null | undefined,
): TeamRole | null {
  if (!teamId) return null;
  return memberships.find((m) => m.teamId === teamId)?.role ?? null;
}

/** Teams where the user may create work items. */
export function teamsWhereUserCanCreate(
  memberships: readonly Membership[],
): Membership[] {
  return memberships.filter((m) => canCreateItem(m.role));
}
