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
  /** Optional machine-readable field errors. Always client-safe. */
  readonly details?: unknown;

  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.details = details;
  }
}

/** Convenience constructors for the common client-safe cases. */
export const badRequest = (message: string, details?: unknown) =>
  new ApiError(400, message, details);
export const forbidden = (message = "Insufficient permissions") => new ApiError(403, message);
export const notFound = (message = "Resource not found") => new ApiError(404, message);

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
