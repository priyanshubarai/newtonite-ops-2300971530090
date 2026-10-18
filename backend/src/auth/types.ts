import type { TeamRole } from "./policy.js";

/**
 * The authenticated principal attached to a request by the auth middleware.
 * Only safe, non-sensitive fields are exposed here - never the password hash.
 */
export interface AuthUser {
  id: string;
  email: string;
  name: string;
  isActive: boolean;
}

/** The membership role resolved for the team a request is scoped to. */
export interface TeamContext {
  teamId: string;
  role: TeamRole;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Set by `requireAuth`. Absent on unauthenticated requests. */
      user?: AuthUser;
      /** Set by team-authorization middleware once a team role is resolved. */
      teamContext?: TeamContext;
    }
  }
}

export {};
