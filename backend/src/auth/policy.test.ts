import { describe, expect, it } from "vitest";
import {
  canApproveTransition,
  canClaimItem,
  canCreateItem,
  canEditItem,
  canManageMembership,
  canView,
  isTeamRole,
  roleCan,
  type Action,
  type TeamRole,
} from "./policy.js";

/**
 * Unit tests for the team-scoped authorization policy.
 *
 * These exercise the actual policy code paths (not a re-statement of the spec
 * table as static assertions): each case calls the real predicate and asserts
 * the boolean result. No database is required.
 */

const ALL_ROLES: TeamRole[] = ["VIEWER", "MEMBER", "LEAD", "ADMIN"];

// The approved authorization matrix, expressed as expectations.
// action -> roles that are ALLOWED.
const EXPECTED: Record<Action, TeamRole[]> = {
  view: ["VIEWER", "MEMBER", "LEAD", "ADMIN"],
  create_item: ["MEMBER", "LEAD", "ADMIN"],
  edit_item: ["MEMBER", "LEAD", "ADMIN"],
  claim_item: ["MEMBER", "LEAD", "ADMIN"],
  approve_transition: ["LEAD", "ADMIN"],
  manage_membership: ["ADMIN"],
};

const ALL_ACTIONS = Object.keys(EXPECTED) as Action[];

describe("policy: role/action matrix", () => {
  // Table-driven over every (action, role) combination.
  for (const action of ALL_ACTIONS) {
    for (const role of ALL_ROLES) {
      const allowed = EXPECTED[action].includes(role);
      it(`${role} ${allowed ? "CAN" : "CANNOT"} ${action}`, () => {
        expect(roleCan(role, action)).toBe(allowed);
      });
    }
  }
});

describe("policy: named helpers match the matrix", () => {
  it("canView allows every role", () => {
    for (const role of ALL_ROLES) expect(canView(role)).toBe(true);
  });

  it("canCreateItem / canEditItem / canClaimItem allow MEMBER and above", () => {
    for (const role of ALL_ROLES) {
      const allowed = role !== "VIEWER";
      expect(canCreateItem(role)).toBe(allowed);
      expect(canEditItem(role)).toBe(allowed);
      expect(canClaimItem(role)).toBe(allowed);
    }
  });

  it("canApproveTransition allows LEAD and ADMIN only", () => {
    expect(canApproveTransition("VIEWER")).toBe(false);
    expect(canApproveTransition("MEMBER")).toBe(false);
    expect(canApproveTransition("LEAD")).toBe(true);
    expect(canApproveTransition("ADMIN")).toBe(true);
  });

  it("canManageMembership allows ADMIN only", () => {
    expect(canManageMembership("VIEWER")).toBe(false);
    expect(canManageMembership("MEMBER")).toBe(false);
    expect(canManageMembership("LEAD")).toBe(false);
    expect(canManageMembership("ADMIN")).toBe(true);
  });
});

describe("policy: fails closed on missing or malformed input", () => {
  it("denies everything for null / undefined role", () => {
    for (const action of ALL_ACTIONS) {
      expect(roleCan(null, action)).toBe(false);
      expect(roleCan(undefined, action)).toBe(false);
    }
  });

  it("denies everything for an unknown role string", () => {
    for (const action of ALL_ACTIONS) {
      expect(roleCan("SUPERUSER" as TeamRole, action)).toBe(false);
      expect(roleCan("" as TeamRole, action)).toBe(false);
    }
  });
});

describe("policy: isTeamRole type guard", () => {
  it("accepts each valid role", () => {
    for (const role of ALL_ROLES) expect(isTeamRole(role)).toBe(true);
  });

  it("rejects non-roles", () => {
    expect(isTeamRole("OWNER")).toBe(false);
    expect(isTeamRole("viewer")).toBe(false); // case-sensitive
    expect(isTeamRole(42)).toBe(false);
    expect(isTeamRole(null)).toBe(false);
    expect(isTeamRole(undefined)).toBe(false);
    expect(isTeamRole({})).toBe(false);
  });
});
