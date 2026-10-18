import type { NextFunction, Request, Response } from "express";
import { verifyAuthToken } from "./tokens.js";
import { findUserById } from "./repository.js";

/**
 * Express middleware工厂 that authenticates a request via a short-lived bearer
 * token. On success it attaches the freshly-loaded user to `req.user`. On any
 * failure it responds 401 and does not call the next handler.
 *
 * The authenticated user id comes only from the verified token's `sub` claim -
 * never from a client-supplied id in the body, query, or headers. The user is
 * then re-read from the database so deactivated accounts are rejected even if
 * their token has not yet expired.
 */
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  void (async () => {
    const header = req.headers.authorization;
    if (!header || !header.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Authentication required" });
    }

    const token = header.slice("Bearer ".length).trim();
    if (!token) {
      return res.status(401).json({ error: "Authentication required" });
    }

    const userId = verifyAuthToken(token);
    if (!userId) {
      return res.status(401).json({ error: "Invalid or expired token" });
    }

    const user = await findUserById(userId);
    if (!user || !user.isActive) {
      // Treat an unknown or deactivated subject the same as an invalid token so
      // the response does not disclose account state.
      return res.status(401).json({ error: "Invalid or expired token" });
    }

    req.user = user;
    return next();
  })().catch(next);
}
