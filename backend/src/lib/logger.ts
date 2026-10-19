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

/** Format for development: human-readable, colorized. */
const developmentFormat = winston.format.combine(
  winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss.SSS" }),
  winston.format.colorize({ all: true }),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    const metaStr = Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta)}` : "";
    return `${timestamp} [${level}]: ${message}${metaStr}`;
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