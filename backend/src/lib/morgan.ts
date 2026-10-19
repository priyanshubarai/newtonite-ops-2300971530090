import express from "express";
import morgan from "morgan";
import { logger } from "./logger.js";

/**
 * Morgan HTTP request logging middleware integrated with Winston.
 *
 * - Logs method, path, status, response time, content length, and request ID.
 * - Uses Winston as the output destination via a stream adapter.
 * - Generates/validates request IDs for correlation.
 * - Excludes health check endpoints from access logs to avoid noise.
 * - Excludes sensitive headers, query strings, and request/response bodies.
 * - Returns the request ID in the X-Request-ID response header.
 */

const REQUEST_ID_HEADER = "x-request-id";

/** Type augmentation for Express Request to include request ID and start time. */
export interface RequestWithId extends express.Request {
  requestId?: string;
  _startTime?: number;
}

/** Morgan stream adapter that writes to Winston at the 'http' level. */
const morganStream = {
  write: (message: string) => {
    // Morgan includes a trailing newline; trim it.
    const trimmed = message.trim();
    if (trimmed) {
      logger.http(trimmed);
    }
  },
};

/** Custom Morgan token for request ID. */
morgan.token("request-id", (req: express.Request) => {
  return (req as RequestWithId).requestId ?? "";
});

/** Custom Morgan token for response content length. */
morgan.token("res-content-length", (_req: express.Request, res: express.Response) => {
  const header = res.getHeader("content-length");
  return header === undefined ? "" : String(header);
});

/** Custom Morgan token for response time in milliseconds. */
morgan.token("response-time-ms", (req: express.Request, _res: express.Response) => {
  const start = (req as RequestWithId)._startTime;
  if (!start) return "";
  const ms = Date.now() - start;
  return `${ms}ms`;
});

/** Custom Morgan token for the request method + path (no query string). */
morgan.token("method-path", (req: express.Request) => {
  return `${req.method} ${req.originalUrl?.split("?")[0] ?? req.path}`;
});

/** Check if a request should be excluded from access logs. */
function shouldExcludeFromAccessLog(req: express.Request): boolean {
  // Exclude health check endpoints
  if (req.path === "/health") return true;
  return false;
}

/** Middleware to assign/validate request ID and record start time. */
export function requestIdMiddleware(req: express.Request, res: express.Response, next: express.NextFunction): void {
  // Record start time for response time calculation
  (req as RequestWithId)._startTime = Date.now();

  // Get or generate request ID
  const suppliedId = req.get("x-request-id");
  let requestId: string;

  if (suppliedId && validateRequestId(suppliedId)) {
    requestId = suppliedId;
  } else {
    requestId = generateRequestId();
  }

  (req as RequestWithId).requestId = requestId;

  // Set response header for client-side correlation
  res.setHeader("x-request-id", requestId);

  next();
}

/** Morgan middleware for HTTP access logging. */
export const accessLogMiddleware = morgan(
  // Format: method path status response-time content-length request-id
  ':method :method-path :status :response-time-ms :res-content-length :request-id',
  {
    stream: morganStream,
    skip: shouldExcludeFromAccessLog,
  }
);

/** Attach request ID to the logger for downstream application logs. */
export function requestContextMiddleware(req: express.Request, res: express.Response, next: express.NextFunction): void {
  const reqWithId = req as RequestWithId;
  if (reqWithId.requestId) {
    // Add request ID to the logger context for downstream logs
    res.locals.requestId = reqWithId.requestId;
  }
  next();
}

/** Generate a simple request ID. */
function generateRequestId(): string {
  return crypto.randomUUID();
}

/** Validate a caller-supplied request ID (alphanumeric + hyphens, reasonable length). */
function validateRequestId(id: string): boolean {
  return /^[a-zA-Z0-9-]{1,64}$/.test(id);
}