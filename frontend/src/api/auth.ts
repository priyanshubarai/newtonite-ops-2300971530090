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
