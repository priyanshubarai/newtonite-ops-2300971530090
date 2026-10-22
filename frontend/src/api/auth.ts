import { request } from "./client";
import type { LoginResponse, MeResponse } from "./types";

/** `POST /auth/login` - exchange credentials for a bearer token. */
export function login(email: string, password: string): Promise<LoginResponse> {
  return request<LoginResponse>("/auth/login", {
    method: "POST",
    body: { email, password },
    // Login must never attach a token nor trigger the session-expiry handler.
    auth: false,
  });
}

/** `GET /auth/me` - the authenticated user and their fresh team memberships. */
export function fetchMe(signal?: AbortSignal): Promise<MeResponse> {
  return request<MeResponse>("/auth/me", { signal });
}

/**
 * `POST /auth/logout` - end the server session.
 *
 * The auth token lives in an HttpOnly cookie, so clearing client-side state
 * alone would leave a valid credential sitting in the browser. The server
 * clears the cookie here, which is what actually ends the session.
 *
 * `auth: false` because the endpoint does not need the token - it clears it -
 * and because a 401 here must not be mistaken for an expired session.
 */
export function logout(): Promise<{ message?: string }> {
  return request<{ message?: string }>("/auth/logout", {
    method: "POST",
    auth: false,
  });
}
