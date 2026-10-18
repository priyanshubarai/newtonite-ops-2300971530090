import { teamRoleEnum } from "../db/schema/enums.js";

export type TeamRole = (typeof teamRoleEnum.enumValues)[number];

/**
 * Team-scoped authorization policy.
 *
 * Every permission check takes an explicit role and an explicit team context.
 * There is deliberately no global "admin everywhere" bypass: a role is always
 * interpreted for one specific team, so a LEAD in team A has no authority in
 * team B. Route handlers must obtain the role by loading the membership row
 * for the resource's real team id (see `getTeamRole`), never from a
 * client-supplied role or team id.
 */

// Actions that require a team-scoped permission check.
export type Action =
  | "view"
  | "create_item"
  | "edit_item"
  | "claim_item"
  | "approve_transition"
  | "manage_membership";

// Approved authorization matrix. Membership is the lowest tier that can act on
// ordinary items; approval requires LEAD+; membership management requires ADMIN.
const ROLE_PERMISSIONS: Record<TeamRole, readonly Action[]> = {
  VIEWER: ["view"],
  MEMBER: ["view", "create_item", "edit_item", "claim_item"],
  LEAD: ["view", "create_item", "edit_item", "claim_item", "approve_transition"],
  ADMIN: [
    "view",
    "create_item",
    "edit_item",
    "claim_item",
    "approve_transition",
    "manage_membership",
  ],
};

/** Does this role permit this action within its own team? Fails closed. */
export function roleCan(role: TeamRole | null | undefined, action: Action): boolean {
  if (!role) return false;
  const allowed = ROLE_PERMISSIONS[role];
  if (!allowed) return false;
  return allowed.includes(action);
}

/**
 * Type guard mapping an arbitrary string (e.g. a database enum value) to a
 * known role. Used so malformed or unexpected data fails closed rather than
 * silently granting access.
 */
export function isTeamRole(value: unknown): value is TeamRole {
  return (
    typeof value === "string" &&
    (teamRoleEnum.enumValues as readonly string[]).includes(value)
  );
}

// Named helpers so route handlers read as intent rather than raw comparisons.
export const canView = (role: TeamRole | null | undefined) => roleCan(role, "view");
export const canCreateItem = (role: TeamRole | null | undefined) =>
  roleCan(role, "create_item");
export const canEditItem = (role: TeamRole | null | undefined) =>
  roleCan(role, "edit_item");
export const canClaimItem = (role: TeamRole | null | undefined) =>
  roleCan(role, "claim_item");
export const canApproveTransition = (role: TeamRole | null | undefined) =>
  roleCan(role, "approve_transition");
export const canManageMembership = (role: TeamRole | null | undefined) =>
  roleCan(role, "manage_membership");
