import { pool } from "./db/index.js";
import { categorizeError, logEvent, toStoredError } from "./outbox/logging.js";
import { resolveWorkerConfig, startOutboxLoop } from "./outbox/worker.js";

/**
 * Outbox worker process entry point.
 *
 * This is a **separate process** from the HTTP API (`src/index.ts`): it never
 * imports the Express app and the API never starts a worker, so there is exactly
 * one worker per process that runs this file and the API's latency is unaffected
 * by polling.
 *
 *   npm run worker
 *
 * Configuration comes from the environment (see `config/env.ts`); every outbox
 * variable has a sensible default, so no extra configuration is required to run
 * it locally.
 *
 * ## Shutdown
 *
 * `SIGINT` (Ctrl+C) and `SIGTERM` set the loop to stop claiming, let the
 * in-flight iteration finish, close the connection pool, and let the process
 * exit with a zero status. If the process is killed outright, any job left in
 * `PROCESSING` is not lost: it is recovered by lease reclaim once its lease
 * expires (`OUTBOX_LEASE_TIMEOUT_MS`).
 *
 * ## Robustness
 *
 * A `unhandledRejection` listener is registered so an unforeseen rejection is
 * reported (as a value-free category) instead of terminating the process.
 * Individual poll and job failures are already handled inside the loop.
 */

function main(): void {
  const config = resolveWorkerConfig();
  const loop = startOutboxLoop(config);

  let shuttingDown = false;

  async function shutdown(signal: string): Promise<void> {
    if (shuttingDown) return;
    shuttingDown = true;

    logEvent({ event: "worker.shutdown_requested", signal });
    try {
      await loop.stop();
      await pool.end();
      logEvent({ event: "worker.shutdown_complete", signal });
      // Let the event loop drain rather than hard-exiting, so buffered log
      // output is not truncated.
      process.exitCode = 0;
    } catch (cause) {
      logEvent({
        event: "worker.shutdown_failed",
        signal,
        category: categorizeError(cause),
        detail: toStoredError(cause),
      });
      process.exitCode = 1;
    }
  }

  process.on("SIGINT", () => {
    void shutdown("SIGINT");
  });
  process.on("SIGTERM", () => {
    void shutdown("SIGTERM");
  });
  process.on("unhandledRejection", (reason) => {
    // Log the category only - a rejection reason can carry arbitrary values.
    logEvent({ event: "worker.unhandled_rejection", category: categorizeError(reason) });
  });
}

main();
