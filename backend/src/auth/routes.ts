import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "./middleware.js";
import { verifyPassword } from "./password.js";
import { signAuthToken } from "./tokens.js";
import {
  findUserByEmailWithHash,
  findUserById,
  getMembershipsForUser,
} from "./repository.js";
import { logger } from "../lib/logger.js";
import { env } from "../config/env.js";

export const authRouter = Router();

// Generic failure body/message reused for every login failure so that the
// response never discloses whether an email exists or an account is disabled.
const GENERIC_LOGIN_ERROR = "Invalid email or password";

const loginSchema = z.object({
  email: z
    .string({ required_error: "email is required" })
    .trim()
    .toLowerCase()
    .email("email must be a valid email address"),
  password: z
    .string({ required_error: "password is required" })
    .min(1, "password must not be empty"),
});

/**
 * POST /auth/login
 *
 * Accepts { email, password }. On success returns a short-lived bearer token
 * in an HttpOnly cookie plus the safe user profile. Every failure mode - unknown email, wrong
 * password, deactivated account - returns the same generic 401 so account
 * existence is never leaked.
 */
authRouter.post("/login", (req, res) => {
  const requestId = (req as import("../lib/morgan.js").RequestWithId).requestId;
  void (async () => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      logger.debug("Login validation failed", { requestId, error: parsed.error.flatten().fieldErrors });
      return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten().fieldErrors });
    }

    const { email, password } = parsed.data;

    const user = await findUserByEmailWithHash(email);
    if (!user) {
      // Burn comparable time on a dummy compare so a missing account and a
      // wrong password are indistinguishable by response timing.
      await verifyPassword(password, "$2b$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidi");
      logger.info("Login failed: user not found", { requestId, tag: "AUTH" });
      return res.status(401).json({ error: GENERIC_LOGIN_ERROR });
    }

    const passwordOk = await verifyPassword(password, user.passwordHash);
    if (!passwordOk) {
      logger.info("Login failed: invalid password", { requestId, userId: user.id, tag: "AUTH" });
      return res.status(401).json({ error: GENERIC_LOGIN_ERROR });
    }

    if (!user.isActive) {
      logger.info("Login failed: account inactive", { requestId, userId: user.id, tag: "AUTH" });
      return res.status(401).json({ error: GENERIC_LOGIN_ERROR });
    }

    const token = signAuthToken(user.id);
    logger.info("Login successful", { requestId, userId: user.id, tag: "AUTH" });
    
    // Set token in HttpOnly cookie
    const isProduction = process.env.NODE_ENV === "production";
    res.cookie("auth_token", token, {
      httpOnly: true,
      secure: isProduction,
      sameSite: "strict",
      maxAge: env.JWT_EXPIRES_IN * 1000, // JWT_EXPIRES_IN is in seconds
      path: "/",
    });
    
    return res.status(200).json({
      tokenType: "Bearer",
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
      },
    });
  })().catch((err) => {
    // Do not leak stack traces or SQL details to the client.
    logger.error("Login error", { requestId, error: err instanceof Error ? err.message : String(err) });
    res.status(500).json({ error: "Internal server error" });
    void err;
  });
});

/**
 * POST /auth/logout
 *
 * Clears the auth cookie.
 */
authRouter.post("/logout", (req, res) => {
  res.clearCookie("auth_token", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
  });
  return res.status(200).json({ message: "Logged out successfully" });
});

/**
 * GET /me
 *
 * Requires authentication. Returns the authenticated user's safe fields plus
 * their team memberships (loaded fresh from the database, not from the token).
 */
authRouter.get("/me", requireAuth, (req, res) => {
  const requestId = (req as import("../lib/morgan.js").RequestWithId).requestId;
  void (async () => {
    const authUser = req.user!;
    const user = await findUserById(authUser.id);
    if (!user) {
      logger.warn("Session validation failed: user not found", { requestId, userId: authUser.id, tag: "AUTH" });
      return res.status(401).json({ error: "Invalid or expired token" });
    }
    const memberships = await getMembershipsForUser(user.id);
    logger.debug("Session validated", { requestId, userId: user.id, tag: "AUTH" });
    return res.status(200).json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        isActive: user.isActive,
      },
      memberships,
    });
  })().catch((err) => {
    logger.error("Session validation error", { requestId, error: err instanceof Error ? err.message : String(err) });
    res.status(500).json({ error: "Internal server error" });
    void err;
  });
});
