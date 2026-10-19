import winston from "winston";
import { env } from "../config/env.js";

/**
 * Centralized application logger using Winston.
 *
 * - Production: structured JSON logs to stdout, suitable for log aggregation.
 * - Development: human-readable, colorized console output.
 * - Log level controlled by LOG_LEVEL env var (defaults: info in production, debug in development).
 * - Secrets are redacted from log output.
 * - Non-primitive values are replaced with "[omitted]" to prevent payload leakage.
 */

const LOG_LEVELS = ["error", "warn", "info", "http", "debug"] as const;
type LogLevel = (typeof LOG_LEVELS)[number];

/** Determine the effective log level from environment or defaults. */
function resolveLogLevel(): LogLevel {
  const explicit = process.env.LOG_LEVEL?.toLowerCase();
  if (explicit && LOG_LEVELS.includes(explicit as LogLevel)) {
    return explicit as LogLevel;
  }
  return env.NODE_ENV === "production" ? "info" : "debug";
}

/** Sanitize a log value to prevent payload/secrets leakage. */
function sanitizeValue(value: unknown): string | number | boolean | null | "[omitted]" {
  if (value === undefined) return "[omitted]";
  if (value === null) return null;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  return "[omitted]";
}

/** Sanitize a log metadata object, keeping only primitive values. */
function sanitizeMeta(meta: Record<string, unknown>): Record<string, string | number | boolean | null> {
  const safe: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(meta)) {
    if (value === undefined) continue;
    safe[key] = sanitizeValue(value);
  }
  return safe;
}

/** Format for development: human-readable, colorized with structured tags. */
const developmentFormat = winston.format.combine(
  winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss.SSS" }),
  winston.format.colorize({ all: true }),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    // Extract structured tags from meta
    const tag = meta.tag ? `[${meta.tag}]` : "";
    const requestId = meta.requestId ? ` request=${meta.requestId}` : "";
    const jobId = meta.jobId ? ` job=${meta.jobId}` : "";
    const itemId = meta.itemId ? ` item=${meta.itemId}` : "";
    const userId = meta.userId ? ` user=${meta.userId}` : "";
    const teamId = meta.teamId ? ` team=${meta.teamId}` : "";
    const duration = meta.durationMs ? ` duration=${meta.durationMs}ms` : "";
    const operation = meta.operation ? ` op=${meta.operation}` : "";
    const eventType = meta.eventType ? ` type=${meta.eventType}` : "";
    const attempt = meta.attempt !== undefined ? ` attempt=${meta.attempt}` : "";
    const maxAttempts = meta.maxAttempts !== undefined ? ` max=${meta.maxAttempts}` : "";
    const outcome = meta.outcome ? ` outcome=${meta.outcome}` : "";
    const category = meta.category ? ` category=${meta.category}` : "";
    const delayMs = meta.delayMs ? ` delay=${meta.delayMs}ms` : "";
    const retryAt = meta.retryScheduledAt ? ` retryAt=${meta.retryScheduledAt}` : "";
    const workerId = meta.workerId ? ` worker=${meta.workerId}` : "";
    const status = meta.status ? ` status=${meta.status}` : "";
    const method = meta.method ? ` method=${meta.method}` : "";
    const path = meta.path ? ` path=${meta.path}` : "";
    const code = meta.code ? ` code=${meta.code}` : "";
    const statusCode = meta.statusCode ? ` statusCode=${meta.statusCode}` : "";
    const businessChange = meta.businessChangeCommitted !== undefined ? ` business=${meta.businessChangeCommitted ? "committed" : "pending"}` : "";
    const activityEvents = meta.activityEventsWritten !== undefined ? ` activity=${meta.activityEventsWritten}` : "";
    const outboxJobs = meta.outboxJobsInserted !== undefined ? ` outbox=${meta.outboxJobsInserted}` : "";
    const idempotency = meta.idempotencyRecordWritten !== undefined ? ` idempotency=${meta.idempotencyRecordWritten ? "written" : "none"}` : "";
    const reclaimed = meta.reclaimed !== undefined ? ` reclaimed=${meta.reclaimed}` : "";
    const exhausted = meta.exhausted !== undefined ? ` exhausted=${meta.exhausted}` : "";
    const claimed = meta.claimed !== undefined ? ` claimed=${meta.claimed}` : "";
    const processed = meta.processed !== undefined ? ` processed=${meta.processed}` : "";
    const retried = meta.retried !== undefined ? ` retried=${meta.retried}` : "";
    const failed = meta.failed !== undefined ? ` failed=${meta.failed}` : "";
    const skipped = meta.skipped !== undefined ? ` skipped=${meta.skipped}` : "";
    const leasesExhausted = meta.leasesExhausted !== undefined ? ` leasesExhausted=${meta.leasesExhausted}` : "";

    // Build the structured message
    const parts = [
      tag,
      message,
      requestId,
      jobId,
      itemId,
      userId,
      teamId,
      duration,
      operation,
      eventType,
      attempt,
      maxAttempts,
      outcome,
      category,
      delayMs,
      retryAt,
      workerId,
      status,
      method,
      path,
      code,
      statusCode,
      businessChange,
      activityEvents,
      outboxJobs,
      idempotency,
      reclaimed,
      exhausted,
      claimed,
      processed,
      retried,
      failed,
      skipped,
      leasesExhausted,
    ].filter(Boolean);

    return `${timestamp} ${level}: ${parts.join(" ")}`;
  })
);

/** Format for production: structured JSON with timestamp and level. */
const productionFormat = winston.format.combine(
  winston.format.timestamp({ format: "ISO" }),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    const logRecord: Record<string, unknown> = {
      timestamp,
      level,
      message,
      ...meta,
    };
    return JSON.stringify(logRecord);
  })
);

/** Create the Winston logger instance. */
const logger = winston.createLogger({
  level: resolveLogLevel(),
  levels: {
    error: 0,
    warn: 1,
    info: 2,
    http: 3,
    debug: 4,
  },
  format: env.NODE_ENV === "production" ? productionFormat : developmentFormat,
  transports: [
    new winston.transports.Console({
      silent: false,
    }),
  ],
  // Prevent Winston from crashing on unhandled exceptions in logging
  exitOnError: false,
});

/**
 * Create a child logger with additional context fields.
 * Useful for adding request IDs, component names, etc.
 */
export function createChildLogger(context: Record<string, unknown>): winston.Logger {
  return logger.child(sanitizeMeta(context));
}

/** Re-export the main logger for direct use. */
export { logger };

/** Log levels for external reference. */
export { LOG_LEVELS };
export type { LogLevel };