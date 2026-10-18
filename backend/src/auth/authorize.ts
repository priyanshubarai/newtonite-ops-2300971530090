import type { NextFunction, Request, Response } from "express";
import { getTeamRole } from "./repository.js";
import { roleCan, type Action } from "./policy.js";

/**
 * Team-scoped authorization.
 *
 * Two entry points, both built on the same policy:
 *
 * 1. `requireTeamPermission(action)` - an Express middleware factory for routes
 *    where the team id is a first-class part of the URL (e.g. /teams/:teamId/...).
 *    It reads the team id from the route params via `getTeamId`.
 *
 * 2. `authorizeTeamAction(...)` - a plain helper for handlers that must load a
 *    resource first (e.g. a work item) and then authorize against that
 *    resource's REAL team id from the database. This is the intended flow for
 *    future work-item routes: authenticate -> load resource -> authorize its
 *    team -> act.
 *
 * Neither trusts a client-supplied role. The role is always resolved from the
 * membership row for the concrete team id.
 */

export type AuthzResult =
  | { ok: true; role: NonNullable<import("./policy.js").TeamRole> }
  | { ok: false; status: 403 | 404 };

// Loose UUID check (any version/variant). Guards the DB query so a malformed
// id from a route param fails closed as 404 rather than throwing a Postgres
// "invalid input syntax for type uuid" error (which would surface as a 500).
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

/**
 * Authorize a user for an action within one specific team.
 *
 * - Malformed team id -> 404 (fail closed; never reaches the database).
 * - No membership row for that team -> 404. Returning 404 (not 403) for a team
 *   the caller is not a member of prevents cross-team resource enumeration:
 *   the caller cannot distinguish "exists but forbidden" from "does not exist".
 * - Membership exists but the role lacks the action -> 403.
 */
export async function authorizeTeamAction(
  userId: string,
  teamId: string,
  action: Action,
): Promise<AuthzResult> {
  if (!isUuid(userId) || !isUuid(teamId)) {
    return { ok: false, status: 404 };
  }
  const role = await getTeamRole(userId, teamId);
  if (!role) {
    return { ok: false, status: 404 };
  }
  if (!roleCan(role, action)) {
    return { ok: false, status: 403 };
  }
  return { ok: true, role };
}

function sendAuthzFailure(res: Response, status: 403 | 404) {
  if (status === 404) {
    return res.status(404).json({ error: "Resource not found" });
  }
  return res.status(403).json({ error: "Insufficient permissions" });
}

/**
 * Middleware factory requiring authentication plus a team-scoped permission.
 * Assumes `requireAuth` already ran (it responds 401 if `req.user` is absent).
 * On success it attaches the resolved role to `req.teamContext`.
 */
export function requireTeamPermission(
  action: Action,
  getTeamId: (req: Request) => string | undefined = (req) => {
    const param = req.params.teamId;
    // Express params are typed `string | string[]`; a route with a single
    // :teamId segment yields a string. Treat anything else as "no team".
    return typeof param === "string" ? param : undefined;
  },
) {
  return function teamPermissionMiddleware(
    req: Request,
    res: Response,
    next: NextFunction,
  ) {
    void (async () => {
      const user = req.user;
      if (!user) {
        return res.status(401).json({ error: "Authentication required" });
      }

      const teamId = getTeamId(req);
      if (!teamId) {
        // No team to scope to - fail closed.
        return res.status(404).json({ error: "Resource not found" });
      }

      const result = await authorizeTeamAction(user.id, teamId, action);
      if (!result.ok) {
        return sendAuthzFailure(res, result.status);
      }

      req.teamContext = { teamId, role: result.role };
      return next();
    })().catch(next);
  };
}
