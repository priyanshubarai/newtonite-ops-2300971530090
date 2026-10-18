import express from "express";
import { healthCheck } from "./health/health.js";
import { authRouter } from "./auth/routes.js";

/**
 * Application construction, separated from `listen` so tests (Supertest) can
 * import the fully-wired app without binding a port.
 */
const app = express();

app.use(express.json());

app.get("/health", healthCheck);
app.use("/auth", authRouter);

// Central 404 for unknown routes. Keeps error responses consistent JSON and
// avoids leaking stack traces.
app.use((_req, res) => {
  res.status(404).json({ error: "Not found" });
});

// Central error handler. Any `next(err)` from async middleware lands here.
// Log server-side only; return a generic body to the client.
app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  // eslint-disable-next-line no-console
  console.error("unhandled error");
  void err;
  if (!res.headersSent) {
    res.status(500).json({ error: "Internal server error" });
  }
});

export { app };
