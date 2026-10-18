import { vi } from "vitest";

/**
 * A tiny fetch stub for component tests.
 *
 * Requests still flow through the real API client, so header/URL/body handling
 * and error parsing are exercised; only the network boundary is replaced.
 * Plain objects are used instead of `Response`/`Headers` so the stub does not
 * depend on fetch globals being present in the jsdom environment.
 */

export interface MockRequest {
  method: string;
  path: string;
  url: URL;
  query: URLSearchParams;
  body: unknown;
  headers: Record<string, string>;
}

export interface MockReply {
  status?: number;
  body?: unknown;
  /** Extra headers, e.g. a non-JSON content type. */
  headers?: Record<string, string>;
}

export type MockHandler = (request: MockRequest) => MockReply | Promise<MockReply>;

interface FakeResponse {
  ok: boolean;
  status: number;
  headers: { get: (name: string) => string | null };
  json: () => Promise<unknown>;
  text: () => Promise<string>;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function makeResponse(reply: MockReply): FakeResponse {
  const status = reply.status ?? 200;
  const headers: Record<string, string> = {
    "content-type": "application/json",
    ...(reply.headers ?? {}),
  };
  const body = reply.body ?? {};
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (name: string) => headers[name.toLowerCase()] ?? null,
    },
    json: async () => body,
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
  };
}

export interface FetchMock {
  fetch: typeof fetch;
  calls: MockRequest[];
  /** Register a handler for a method + exact path (or a custom pattern). */
  on: (method: string, path: string | RegExp, handler: MockHandler) => FetchMock;
  /** Requests seen for a method + exact path. */
  requestsFor: (method: string, path: string) => MockRequest[];
}

export function createFetchMock(): FetchMock {
  const routes: Array<{ method: string; pattern: RegExp; handler: MockHandler }> = [];
  const calls: MockRequest[] = [];

  const fn = vi.fn(async (input: unknown, init?: RequestInit): Promise<FakeResponse> => {
    const raw =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : String((input as { url?: string })?.url ?? input);

    const url = new URL(raw, "http://localhost:3000");
    const method = (init?.method ?? "GET").toUpperCase();
    const headers = (init?.headers ?? {}) as Record<string, string>;

    // The client prefixes requests with the configured API base (by default the
    // same-origin "/api" proxy). Strip it so tests can register the backend's
    // own paths; `url` keeps the full value for assertions.
    const path = url.pathname.replace(/^\/api(?=\/|$)/, "") || "/";

    let body: unknown;
    if (typeof init?.body === "string") {
      try {
        body = JSON.parse(init.body);
      } catch {
        body = init.body;
      }
    }

    const request: MockRequest = {
      method,
      path,
      url,
      query: url.searchParams,
      body,
      headers,
    };
    calls.push(request);

    for (const route of routes) {
      if (route.method === method && route.pattern.test(path)) {
        return makeResponse(await route.handler(request));
      }
    }

    throw new Error(`Unexpected request in test: ${method} ${path}`);
  });

  const mock: FetchMock = {
    fetch: fn as unknown as typeof fetch,
    calls,
    on(method, path, handler) {
      routes.push({
        method: method.toUpperCase(),
        pattern: typeof path === "string" ? new RegExp(`^${escapeRegExp(path)}$`) : path,
        handler,
      });
      return mock;
    },
    requestsFor(method, path) {
      return calls.filter((call) => call.method === method.toUpperCase() && call.path === path);
    },
  };

  return mock;
}

/** Install a fetch mock on the global object for the current test. */
export function installFetchMock(): FetchMock {
  const mock = createFetchMock();
  vi.stubGlobal("fetch", mock.fetch);
  return mock;
}
