import express from "express";
import cors from "cors";
import { healthCheck } from "./health/health.js";
import { authRouter } from "./auth/routes.js";
import { itemsRouter } from "./items/routes.js";
import { ApiError } from "./common/errors.js";
import { getCorsOrigins, validateCorsConfig } from "./config/env.js";
import { logger } from "./lib/logger.js";
import { requestIdMiddleware, accessLogMiddleware, requestContextMiddleware } from "./lib/morgan.js";

/**
 * Application construction, separated from `listen` so tests (Supertest) can
 * import the fully-wired app without binding a port.
 */
const app = express();

// Validate CORS configuration at startup (fails fast in production if misconfigured)
validateCorsConfig();

// Request ID middleware - must be first to ensure request ID is available for all downstream middleware
app.use(requestIdMiddleware);

// Morgan HTTP access logging - after request ID middleware so request ID is available
app.use(accessLogMiddleware);

// Request context middleware - attaches request ID to response locals for downstream use
app.use(requestContextMiddleware);

// CORS middleware - configured from environment variable
const corsOrigins = getCorsOrigins();
app.use(
  cors({
    origin: corsOrigins,
    credentials: true, // Allow cookies/auth headers
    methods: ["GET", "POST", "PATCH", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "Idempotency-Key"],
    maxAge: 86400, // 24 hours
  })
);

app.use(express.json());

app.get("/health", healthCheck);
app.use("/auth", authRouter);
app.use("/items", itemsRouter);

// Central 404 for unknown routes. Keeps error responses consistent JSON and
// avoids leaking stack traces.
app.use((_req, res) => {
  res.status(404).json({ error: "Not found" });
});

/**
 * Extract an explicit client error status from a non-`ApiError` failure.
 *
 * Express body-parsing middleware (and a few similar middleware) reject a
 * request by throwing an error that carries its own 4xx status - e.g. malformed
 * JSON (`400 entity.parse.failed`) or an oversized body (`413 entity.too.large`).
 * Such a failure is the caller's fault, not a server fault, so it must not be
 * mislabelled as a 500. Only an integer status in the 4xx range is honoured.
 */
function clientErrorStatus(err: unknown): number | undefined {
  if (typeof err !== "object" || err === null) return undefined;
  const candidate = err as { status?: unknown; statusCode?: unknown };
  const raw =
    typeof candidate.status === "number" ? candidate.status : candidate.statusCode;
  return typeof raw === "number" && Number.isInteger(raw) && raw >= 400 && raw < 500
    ? raw
    : undefined;
}

/**
 * Sanitize an error for logging, removing sensitive information.
 */
function sanitizeErrorForLogging(err: unknown): Record<string, unknown> {
  if (err instanceof Error) {
    return {
      name: err.name,
      message: err.message,
      stack: err.stack,
    };
  }
  if (typeof err === "object" && err !== null) {
    return { value: String(err) };
  }
  return { value: String(err) };
}

/**
 * Central error handler. Any `next(err)` from async middleware lands here.
 * An `ApiError` carries an intentional client-safe status/message; a middleware
 * error with its own 4xx status keeps that status with a generic message;
 * anything else is an unexpected failure. Log server-side only; never leak
 * stack traces, SQL, or environment values to the client.
 */
app.use((err: unknown, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const requestId = (req as import("./lib/morgan.js").RequestWithId).requestId;
  const logContext = { requestId };

  if (err instanceof ApiError) {
    // Expected client errors (4xx) - log at debug/info level, not error
    const logLevel = err.status >= 500 ? "error" : err.status >= 400 ? "debug" : "info";
    logger.log(logLevel, "Request error", {
      ...logContext,
      status: err.status,
      code: err.code,
      message: err.message,
    });

    // Keep the established `{ error }` body and add the optional stable `code`
    // and client-safe field `details` when present.
    const body: Record<string, unknown> = { error: err.message };
    if (err.code) body.code = err.code;
    if (err.details !== undefined) body.details = err.details;
    res.status(err.status).json(body);
    return;
  }

  const status = clientErrorStatus(err);
  if (status !== undefined) {
    // Client errors from middleware (malformed JSON, oversized body, etc.)
    logger.debug("Client error", {
      ...logContext,
      status,
      message: err instanceof Error ? err.message : String(err),
    });

    // A malformed JSON body must be a 400, an oversized body a 413 - never a
    // 500. The message is generic and never echoes parser/SQL internals.
    const message =
      status === 413
        ? "Payload too large"
        : status === 415
          ? "Unsupported media type"
          : "Invalid request";
    res.status(status).json({ error: message });
    return;
  }

  // Unexpected server error - log with full context at error level
  logger.error("Unhandled server error", {
    ...logContext,
    error: sanitizeErrorForLogging(err),
  });

  if (!res.headersSent) {
    res.status(500).json({ error: "Internal server error" });
  }
});

export { app };