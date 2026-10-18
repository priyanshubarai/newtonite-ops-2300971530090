import { getToken } from "../auth/tokenStore";
import type { ApiErrorBody } from "./types";

/**
 * The single typed HTTP client for the backend API.
 *
 * Centralising requests here keeps authentication, error parsing, and query
 * building in one place, and means components never construct raw URLs or read
 * the token themselves.
 *
 * Security notes:
 * - The bearer token is attached from the in-memory token store only; it is
 *   never written to localStorage/sessionStorage and never logged.
 * - Response bodies are only parsed, never logged, so no sensitive payload is
 *   echoed to the console.
 * - A 401 on an *authenticated* request (one that carried a token) clears the
 *   session via the registered handler, returning the user to the login screen.
 *   A 401 on an unauthenticated request (e.g. a bad login) does not, because
 *   that is an expected application error rather than a session expiry.
 */

const RAW_BASE_URL = import.meta.env.VITE_API_URL ?? "/api";
const BASE_URL = RAW_BASE_URL.replace(/\/+$/, "");

/** Stable, machine-readable error codes used by the backend. */
export const ERROR_CODES = {
  STALE_VERSION: "STALE_VERSION",
  IDEMPOTENCY_KEY_REUSED: "IDEMPOTENCY_KEY_REUSED",
  ALREADY_ASSIGNED: "ALREADY_ASSIGNED",
  NOT_CLAIMABLE: "NOT_CLAIMABLE",
  INVALID_TRANSITION: "INVALID_TRANSITION",
} as const;

/** An error returned by the API (or a transport failure), with status + code. */
export class ApiError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly details?: unknown;

  constructor(status: number, message: string, code?: string, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }

  get isUnauthorized(): boolean {
    return this.status === 401;
  }

  get isStaleVersion(): boolean {
    return this.status === 409 && this.code === ERROR_CODES.STALE_VERSION;
  }
}

export function isApiError(value: unknown): value is ApiError {
  return value instanceof ApiError;
}

let unauthorizedHandler: (() => void) | null = null;

/**
 * Register the callback invoked when an authenticated request is rejected with
 * 401 (an expired or revoked session). The auth layer uses this to clear the
 * client-held session and route back to login.
 */
export function setUnauthorizedHandler(handler: (() => void) | null): void {
  unauthorizedHandler = handler;
}

type QueryValue = string | number | boolean | undefined | null;

export interface RequestOptions {
  method?: "GET" | "POST" | "PATCH";
  /** JSON request body. Omitted for GET/claim. */
  body?: unknown;
  /** Query parameters. `undefined`, `null`, and `""` values are dropped. */
  query?: Record<string, QueryValue>;
  /** Value for the `Idempotency-Key` header, when the operation supports it. */
  idempotencyKey?: string;
  signal?: AbortSignal;
  /** Set false for requests that must not require/attach a token (login). */
  auth?: boolean;
}

function buildQuery(query: Record<string, QueryValue> | undefined): string {
  if (!query) return "";
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === "") continue;
    params.set(key, String(value));
  }
  const encoded = params.toString();
  return encoded ? `?${encoded}` : "";
}

function defaultMessage(status: number): string {
  switch (status) {
    case 400:
      return "The request was rejected as invalid.";
    case 401:
      return "Your session has expired. Please sign in again.";
    case 403:
      return "You do not have permission to perform this action.";
    case 404:
      return "The requested resource was not found.";
    case 409:
      return "The request conflicted with the current state of the item.";
    case 413:
      return "The request was too large.";
    default:
      return "The request failed. Please try again.";
  }
}

async function readErrorBody(res: Response): Promise<ApiErrorBody | null> {
  const contentType = res.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return null;
  try {
    const parsed: unknown = await res.json();
    if (parsed && typeof parsed === "object" && "error" in parsed) {
      return parsed as ApiErrorBody;
    }
    return null;
  } catch {
    return null;
  }
}

/** Perform an API request and return the parsed JSON body. */
export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = "GET", body, query, idempotencyKey, signal, auth = true } = options;

  const token = auth ? getToken() : null;
  const headers: Record<string, string> = { Accept: "application/json" };
  if (auth && token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;

  const url = `${BASE_URL}${path}${buildQuery(query)}`;

  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
  } catch (cause) {
    // Aborted requests are the caller's concern; anything else is a transport
    // failure surfaced as a normal (retryable) API error.
    if (cause instanceof DOMException && cause.name === "AbortError") throw cause;
    throw new ApiError(0, "Could not reach the server. Check your connection and try again.");
  }

  if (!res.ok) {
    if (res.status === 401 && token) unauthorizedHandler?.();
    const errorBody = await readErrorBody(res);
    throw new ApiError(
      res.status,
      errorBody?.error ?? defaultMessage(res.status),
      errorBody?.code,
      errorBody?.details,
    );
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}
