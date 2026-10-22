import { ApiError, isApiError } from "../api/client";

/**
 * Helpers for turning an unknown thrown value into UI-friendly information.
 * The backend is the authority on validation; these only shape its response.
 */

export function statusOf(error: unknown): number | null {
  return isApiError(error) ? error.status : null;
}

export function codeOf(error: unknown): string | null {
  return isApiError(error) ? error.code ?? null : null;
}

export function isStaleVersion(error: unknown): boolean {
  return error instanceof ApiError && error.isStaleVersion;
}

export function isForbidden(error: unknown): boolean {
  return statusOf(error) === 403;
}

export function isNotFound(error: unknown): boolean {
  return statusOf(error) === 404;
}

/**
 * Extract per-field validation messages from a 400 response body
 * (`{ error, details: { fieldErrors: { title: [...] } } }`).
 */
export function fieldErrorsFrom(error: unknown): Record<string, string> {
  if (!isApiError(error)) return {};
  const details = error.details;
  if (!details || typeof details !== "object") return {};
  const fieldErrors = (details as { fieldErrors?: unknown }).fieldErrors;
  if (!fieldErrors || typeof fieldErrors !== "object") return {};

  const result: Record<string, string> = {};
  for (const [field, messages] of Object.entries(fieldErrors as Record<string, unknown>)) {
    if (Array.isArray(messages) && typeof messages[0] === "string") {
      result[field] = messages[0];
    }
  }
  return result;
}

/**
 * A safe, user-facing message for an error. Prefers the backend's own message
 * (which never contains secrets) and falls back to a generic sentence.
 */
export function errorMessage(error: unknown, fallback = "Something went wrong. Please try again."): string {
  if (isApiError(error)) {
    if (error.status === 0) return error.message;
    return error.message || fallback;
  }
  return fallback;
}
