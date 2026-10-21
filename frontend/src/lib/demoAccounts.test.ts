import { describe, expect, it } from "vitest";
import { TEAM_ROLES } from "../api/types";
import {
  DEMO_ACCOUNTS,
  findDemoAccount,
  getDemoPassword,
  rolePreviewLines,
} from "../lib/demoAccounts";

/**
 * The demo-account metadata is the single source the login screen reads from.
 * These tests pin its shape to the seeded data documented in the README:
 * 10 users, team-scoped roles, and non-secret fields only.
 */
describe("demoAccounts", () => {
  it("contains the ten seeded users with unique emails", () => {
    expect(DEMO_ACCOUNTS).toHaveLength(10);
    const emails = DEMO_ACCOUNTS.map((account) => account.email);
    expect(new Set(emails).size).toBe(emails.length);
    expect(emails.every((email) => email.endsWith("@newtonite.dev"))).toBe(true);
  });

  it("only exposes non-secret metadata", () => {
    for (const account of DEMO_ACCOUNTS) {
      expect(Object.keys(account).sort()).toEqual(["email", "memberships", "name"]);
      expect(JSON.stringify(account)).not.toMatch(/password|token/i);
    }
  });

  it("keeps every membership on a known role and team", () => {
    for (const account of DEMO_ACCOUNTS) {
      expect(account.memberships.length).toBeGreaterThan(0);
      for (const membership of account.memberships) {
        expect(TEAM_ROLES).toContain(membership.role);
        expect(membership.team.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it("represents multi-team users with one entry per team", () => {
    const multiTeam = DEMO_ACCOUNTS.filter((account) => account.memberships.length > 1);
    expect(multiTeam.map((account) => account.email).sort()).toEqual([
      "avery@newtonite.dev",
      "blake@newtonite.dev",
      "finley@newtonite.dev",
      "harper@newtonite.dev",
    ]);
  });

  it("finds accounts case-insensitively and ignores surrounding whitespace", () => {
    expect(findDemoAccount("  AVERY@NEWTONITE.DEV ")?.name).toBe("Avery Chen");
    expect(findDemoAccount("nobody@newtonite.dev")).toBeUndefined();
    expect(findDemoAccount("")).toBeUndefined();
  });

  it("labels roles with their team and human-readable role", () => {
    const avery = findDemoAccount("avery@newtonite.dev");
    expect(avery).toBeDefined();
    expect(rolePreviewLines(avery!)).toEqual([
      "Payments Operations — Admin",
      "Platform Engineering — Admin",
    ]);
  });

  it("provides the documented password only in development builds", () => {
    // Vitest runs with Vite's development flag; the production build strips it.
    expect(import.meta.env.DEV).toBe(true);
    expect(getDemoPassword()).toBe("newtonite-demo");
  });
});
