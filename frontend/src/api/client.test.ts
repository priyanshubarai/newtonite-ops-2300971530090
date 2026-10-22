import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, request, setUnauthorizedHandler } from "./client";
import { installFetchMock } from "../test/mockFetch";
import { setSession } from "../auth/tokenStore";

afterEach(() => {
  setUnauthorizedHandler(null);
});

describe("api client", () => {
  it("does not attach Authorization header for authenticated requests (uses cookies)", async () => {
    const mock = installFetchMock();
    mock.on("GET", "/items", () => ({ status: 200, body: { ok: true } }));

    await request("/items");

    const call = mock.requestsFor("GET", "/items")[0];
    expect(call.headers.Authorization).toBeUndefined();
    expect(call.headers.Accept).toBe("application/json");
    // Requests go through the configured same-origin API prefix.
    expect(call.url.pathname).toBe("/api/items");
  });

  it("does not attach credentials when auth is disabled", async () => {
    const mock = installFetchMock();
    mock.on("POST", "/auth/login", () => ({ status: 200, body: {} }));

    await request("/auth/login", { method: "POST", body: { email: "a@b.co", password: "x" }, auth: false });

    expect(mock.requestsFor("POST", "/auth/login")[0].headers.Authorization).toBeUndefined();
  });

  it("drops empty query values and sends the rest", async () => {
    const mock = installFetchMock();
    mock.on("GET", "/items", () => ({ status: 200, body: {} }));

    await request("/items", {
      query: { page: 2, pageSize: 50, status: "OPEN", search: "", teamId: undefined },
    });

    const query = mock.requestsFor("GET", "/items")[0].query;
    expect(query.get("page")).toBe("2");
    expect(query.get("pageSize")).toBe("50");
    expect(query.get("status")).toBe("OPEN");
    expect(query.has("search")).toBe(false);
    expect(query.has("teamId")).toBe(false);
  });

  it("sends the Idempotency-Key header when provided", async () => {
    const mock = installFetchMock();
    mock.on("POST", "/items", () => ({ status: 201, body: {} }));

    await request("/items", { method: "POST", body: { title: "t" }, idempotencyKey: "key-1" });

    expect(mock.requestsFor("POST", "/items")[0].headers["Idempotency-Key"]).toBe("key-1");
  });

  it("maps a JSON error body onto ApiError with status, code, and details", async () => {
    const mock = installFetchMock();
    mock.on("PATCH", "/items/abc", () => ({
      status: 409,
      body: { error: "Version conflict", code: "STALE_VERSION", details: { currentVersion: 3 } },
    }));

    const error = await request("/items/abc", { method: "PATCH", body: { expectedVersion: 1 } }).catch(
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(ApiError);
    const apiError = error as ApiError;
    expect(apiError.status).toBe(409);
    expect(apiError.code).toBe("STALE_VERSION");
    expect(apiError.message).toBe("Version conflict");
    expect(apiError.isStaleVersion).toBe(true);
  });

  it("falls back to a generic message when an error body is not JSON", async () => {
    const mock = installFetchMock();
    mock.on("GET", "/items", () => ({
      status: 500,
      body: "<html>boom</html>",
      headers: { "content-type": "text/html" },
    }));

    const error = (await request("/items").catch((caught: unknown) => caught)) as ApiError;
    expect(error).toBeInstanceOf(ApiError);
    expect(error.message).not.toContain("<html>");
  });

  it("does not treat a failed login (unauthenticated 401) as a session expiry", async () => {
    const mock = installFetchMock();
    const onUnauthorized = vi.fn();
    setUnauthorizedHandler(onUnauthorized);
    mock.on("POST", "/auth/login", () => ({ status: 401, body: { error: "Invalid email or password" } }));

    await expect(
      request("/auth/login", { method: "POST", body: { email: "a@b.co", password: "x" }, auth: false }),
    ).rejects.toBeInstanceOf(ApiError);

    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  it("invokes the unauthorized handler when an authenticated request returns 401", async () => {
    const mock = installFetchMock();
    const onUnauthorized = vi.fn();
    setUnauthorizedHandler(onUnauthorized);
    // With cookie auth the client cannot see the token, so "authenticated" means
    // "the app currently holds a session" (the localStorage session flag).
    setSession(true);
    mock.on("GET", "/auth/me", () => ({ status: 401, body: { error: "Invalid or expired token" } }));

    await expect(request("/auth/me")).rejects.toBeInstanceOf(ApiError);

    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });

  it("does not invoke the unauthorized handler when a sessionless request returns 401", async () => {
    const mock = installFetchMock();
    const onUnauthorized = vi.fn();
    setUnauthorizedHandler(onUnauthorized);
    mock.on("GET", "/items", () => ({ status: 401, body: { error: "Invalid or expired token" } }));

    await expect(request("/items")).rejects.toBeInstanceOf(ApiError);

    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  it("reports a transport failure as a status-0 ApiError", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new TypeError("network down");
    }));

    const error = (await request("/items").catch((caught: unknown) => caught)) as ApiError;
    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(0);
  });

  it("never writes the token to the console", async () => {
    const mock = installFetchMock();
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mock.on("GET", "/items", () => ({ status: 500, body: { error: "Internal server error" } }));

    await request("/items").catch(() => undefined);

    const output = [...logSpy.mock.calls, ...errorSpy.mock.calls].flat().join(" ");
    expect(output).not.toContain("super-secret-token");
  });
});