import type { TeamRole } from "../api/types";
import { ROLE_LABELS } from "./constants";

/**
 * Non-secret metadata for the seeded demo users.
 *
 * Source of truth: `backend/seed.ts` (`USER_SEEDS`, `MEMBERSHIP_SEEDS`,
 * `TEAM_SEEDS`) and the "Seeded Demo Users" table in `README.md`. This module is
 * the single place the login screen reads demo-account emails and team-scoped
 * roles from — do not duplicate the list in components.
 *
 * Presentation only: the API remains authoritative for authentication and for
 * every authorization decision. No passwords, tokens, or other secrets belong
 * in this metadata.
 */
export interface DemoMembership {
  /** Full team name as seeded (e.g. "Payments Operations"). */
  team: string;
  role: TeamRole;
}

export interface DemoAccount {
  name: string;
  email: string;
  /** Roles are team-scoped: a user can hold different roles in different teams. */
  memberships: DemoMembership[];
}

export const DEMO_ACCOUNTS: readonly DemoAccount[] = [
  {
    name: "Avery Chen",
    email: "avery@newtonite.dev",
    memberships: [
      { team: "Payments Operations", role: "ADMIN" },
      { team: "Platform Engineering", role: "ADMIN" },
    ],
  },
  {
    name: "Blake Rivera",
    email: "blake@newtonite.dev",
    memberships: [
      { team: "Payments Operations", role: "LEAD" },
      { team: "Customer Support", role: "MEMBER" },
    ],
  },
  {
    name: "Casey Morgan",
    email: "casey@newtonite.dev",
    memberships: [{ team: "Customer Support", role: "LEAD" }],
  },
  {
    name: "Devon Park",
    email: "devon@newtonite.dev",
    memberships: [{ team: "Compliance & Risk", role: "LEAD" }],
  },
  {
    name: "Emery Sutton",
    email: "emery@newtonite.dev",
    memberships: [{ team: "Platform Engineering", role: "LEAD" }],
  },
  {
    name: "Finley Brooks",
    email: "finley@newtonite.dev",
    memberships: [
      { team: "Payments Operations", role: "MEMBER" },
      { team: "Compliance & Risk", role: "MEMBER" },
    ],
  },
  {
    name: "Gray Nakamura",
    email: "gray@newtonite.dev",
    memberships: [{ team: "Customer Support", role: "MEMBER" }],
  },
  {
    name: "Harper Diaz",
    email: "harper@newtonite.dev",
    memberships: [
      { team: "Compliance & Risk", role: "MEMBER" },
      { team: "Platform Engineering", role: "MEMBER" },
    ],
  },
  {
    name: "Indigo Frost",
    email: "indigo@newtonite.dev",
    memberships: [{ team: "Payments Operations", role: "VIEWER" }],
  },
  {
    name: "Juniper Wells",
    email: "juniper@newtonite.dev",
    memberships: [{ team: "Customer Support", role: "VIEWER" }],
  },
];

/**
 * The documented default demo password (`README.md`, and the `DEMO_PASSWORD`
 * default in `backend/seed.ts`). Every seeded user shares it and it exists for
 * local development only.
 *
 * Exported so tests can assert the field was initialised from configuration
 * without ever printing the value.
 */
export const DEV_DEMO_PASSWORD = "newtonite-demo";

/**
 * Password prefilled into the login form for demo convenience.
 *
 * Development builds only: `vite build` replaces `import.meta.env.DEV` with
 * `false`, so the literal never reaches a production bundle. This gates on the
 * build mode, not the API environment — a production build pointed at a demo
 * API simply gets no prefill, which is the safe direction.
 */
export function getDemoPassword(): string {
  if (!import.meta.env.DEV) return "";
  return DEV_DEMO_PASSWORD;
}

/** Case-insensitive lookup by email. Returns `undefined` for unknown addresses. */
export function findDemoAccount(email: string): DemoAccount | undefined {
  const normalized = email.trim().toLowerCase();
  if (!normalized) return undefined;
  return DEMO_ACCOUNTS.find((account) => account.email === normalized);
}

/** "Payments Operations — Admin" lines for the selected account, in seed order. */
export function rolePreviewLines(account: DemoAccount): string[] {
  return account.memberships.map(
    (membership) => `${membership.team} — ${ROLE_LABELS[membership.role]}`,
  );
}
