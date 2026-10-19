import { app } from "./app.js";
import { env } from "./config/env.js";
import { pool } from "./db/index.js";
import { logger } from "./lib/logger.js";

/**
 * API server entry point with graceful shutdown.
 *
 * Handles SIGTERM and SIGINT to stop accepting new connections,
 * allow in-flight requests to complete, and close the database pool.
 */
function main(): void {
  const server = app.listen(env.PORT, () => {
    logger.info("Server running", { port: env.PORT });
  });

  let shuttingDown = false;

  async function shutdown(signal: string): Promise<void> {
    if (shuttingDown) return;
    shuttingDown = true;

    logger.info("Shutdown requested", { signal });

    // Stop accepting new connections
    server.close(async () => {
      try {
        // Close database pool
        await pool.end();
        logger.info("Shutdown complete", { signal });
        process.exitCode = 0;
      } catch (cause) {
        logger.error("Shutdown failed", { signal, error: cause instanceof Error ? cause.message : String(cause) });
        process.exitCode = 1;
      }
    });

    // Force shutdown after timeout
    setTimeout(() => {
      logger.warn("Forced shutdown after timeout", { signal });
      process.exit(1);
    }, 10_000).unref();
  }

  process.on("SIGINT", () => {
    void shutdown("SIGINT");
  });

  process.on("SIGTERM", () => {
    void shutdown("SIGTERM");
  });

  process.on("unhandledRejection", (reason) => {
    logger.error("Unhandled rejection", { error: reason instanceof Error ? reason.message : String(reason) });
  });
}

main();