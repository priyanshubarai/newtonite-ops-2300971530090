import express from "express";
import { healthCheck } from "./health/health.js";
import { authRouter } from "./auth/routes.js";
import { itemsRouter } from "./items/routes.js";
import { ApiError } from "./common/errors.js";

/**
 * Application construction, separated from `listen` so tests (Supertest) can
 * import the fully-wired app without binding a port.
 */
const app = express();

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

// Central error handler. Any `next(err)` from async middleware lands here.
// An `ApiError` carries an intentional client-safe status/message; a middleware
// error with its own 4xx status keeps that status with a generic message;
// anything else is an unexpected failure. Log server-side only; never leak
// stack traces, SQL, or environment values to the client.
app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (err instanceof ApiError) {
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

  // eslint-disable-next-line no-console
  console.error("unhandled error");
  void err;
  if (!res.headersSent) {
    res.status(500).json({ error: "Internal server error" });
  }
});

export { app };
