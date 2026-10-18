import type { NextFunction, Request, RequestHandler, Response } from "express";

/**
 * Minimal HTTP error type used by the service layer so route handlers stay
 * thin. The central Express error handler maps an `ApiError` to its status
 * code with the existing `{ error: "..." }` body (plus optional `details` for
 * field-level validation feedback); anything else becomes a generic 500 that
 * never leaks stack traces, SQL, or environment values to the client.
 */
export class ApiError extends Error {
  readonly status: number;
  /**
   * Optional stable, machine-readable error code (e.g. `STALE_VERSION`).
   * Clients may branch on this without parsing the human-readable message.
   */
  readonly code?: string;
  /** Optional machine-readable field errors. Always client-safe. */
  readonly details?: unknown;

  constructor(status: number, message: string, details?: unknown, code?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.details = details;
    this.code = code;
  }
}

/** Convenience constructors for the common client-safe cases. */
export const badRequest = (message: string, details?: unknown) =>
  new ApiError(400, message, details);
export const forbidden = (message = "Insufficient permissions", details?: unknown) =>
  new ApiError(403, message, details);
export const notFound = (message = "Resource not found") => new ApiError(404, message);

/**
 * 409 Conflict with a stable code. Used for the concurrency/idempotency
 * guarantees: a stale version, an already-claimed item, an invalid workflow
 * transition, or reuse of an idempotency key with a different payload.
 */
export const conflict = (code: string, message: string) =>
  new ApiError(409, message, undefined, code);

/** Stable error codes shared with clients and asserted in tests. */
export const ERROR_CODES = {
  STALE_VERSION: "STALE_VERSION",
  IDEMPOTENCY_KEY_REUSED: "IDEMPOTENCY_KEY_REUSED",
  INVALID_IDEMPOTENCY_KEY: "INVALID_IDEMPOTENCY_KEY",
  ALREADY_ASSIGNED: "ALREADY_ASSIGNED",
  NOT_CLAIMABLE: "NOT_CLAIMABLE",
  INVALID_TRANSITION: "INVALID_TRANSITION",
} as const;

/**
 * Wrap an async route handler so any rejection (including a thrown `ApiError`)
 * is forwarded to Express's central error handler instead of becoming an
 * unhandled promise rejection.
 */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    void Promise.resolve(fn(req, res, next)).catch(next);
  };
}
