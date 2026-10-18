import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MAX_ERROR_DETAIL_LENGTH,
  boundText,
  categorizeError,
  logEvent,
  redactSecrets,
  toStoredError,
  type WorkerLogRecord,
} from "./logging.js";

/**
 * Pure unit tests for log/error sanitisation (no database involved).
 *
 * These are the guard rails for the "no credentials or sensitive payloads in
 * logs" requirement: if redaction ever regresses, these fail before an error
 * message carrying a connection string could reach stdout or `last_error`.
 */

/** A value-free, duck-typed stand-in for the worker's error classes. */
function typedError(name: string, category: string, message: string): Error {
  return Object.assign(new Error(message), { name, category });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("redactSecrets", () => {
  it("removes a PostgreSQL connection string, including any embedded password", () => {
    const redacted = redactSecrets("connect failed: postgresql://neondb_owner:hunter2@ep-x.neon.tech/neondb");
    expect(redacted).toContain("postgres://[redacted]");
    expect(redacted).not.toContain("hunter2");
    expect(redacted).not.toContain("neondb_owner");
  });

  it("removes key=value credentials for common secret names", () => {
    for (const name of ["password", "PASSWORD", "pwd", "secret", "token", "api_key", "apiKey"]) {
      const redacted = redactSecrets(`${name}=sup3r-s3cret`);
      expect(redacted).not.toContain("sup3r-s3cret");
      expect(redacted.toLowerCase()).toContain("[redacted]");
    }
  });

  it("removes the token from an Authorization/Bearer header, not just the header name", () => {
    const redacted = redactSecrets("Authorization: Bearer abc123.def456.ghi789");
    expect(redacted).not.toContain("abc123");
    expect(redacted.toLowerCase()).toContain("[redacted]");
  });

  it("removes a JWT-shaped value", () => {
    const jwt =
      "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
    const redacted = redactSecrets(`rejected token ${jwt}`);
    expect(redacted).not.toContain(jwt);
    expect(redacted).toContain("[redacted-jwt]");
  });

  it("removes a long unbroken hex secret", () => {
    const secret = "a1b2c3d4e5".repeat(10); // 100 hex characters
    const redacted = redactSecrets(`signing key ${secret}`);
    expect(redacted).not.toContain(secret);
    expect(redacted).toContain("[redacted-hex]");
  });

  it("leaves ordinary identifiers such as UUIDs untouched", () => {
    const uuid = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";
    expect(redactSecrets(`job ${uuid} failed`)).toContain(uuid);
  });

  it("is idempotent, so already-redacted text is stable", () => {
    const once = redactSecrets("password=hunter2");
    expect(redactSecrets(once)).toBe(once);
  });
});

describe("boundText", () => {
  it("leaves short text unchanged", () => {
    expect(boundText("short")).toBe("short");
  });

  it("truncates long text at the configured bound", () => {
    const bounded = boundText("x".repeat(MAX_ERROR_DETAIL_LENGTH * 2));
    expect(bounded).toContain("...[truncated]");
    expect(bounded.length).toBeLessThan(MAX_ERROR_DETAIL_LENGTH + 30);
  });
});

describe("categorizeError", () => {
  it("prefers a declared, well-formed category", () => {
    expect(categorizeError(typedError("PermanentJobError", "INVALID_PAYLOAD", "boom"))).toBe(
      "INVALID_PAYLOAD",
    );
  });

  it("falls back to the error name, then the value type", () => {
    expect(categorizeError(new TypeError("boom"))).toBe("TypeError");
    expect(categorizeError(new Error("boom"))).toBe("Error");
    expect(categorizeError("boom")).toBe("string");
    expect(categorizeError(undefined)).toBe("undefined");
  });

  it("ignores a malformed category rather than emitting anything unexpected", () => {
    expect(categorizeError(typedError("Error", "not a category!", "boom"))).toBe("Error");
  });
});

describe("toStoredError", () => {
  it("prefixes the category when one is declared", () => {
    expect(toStoredError(typedError("PermanentJobError", "TEAM_MISMATCH", "wrong team"))).toBe(
      "TEAM_MISMATCH: wrong team",
    );
  });

  it("redacts credentials that appear inside an error message", () => {
    const stored = toStoredError(
      new Error("read failed against postgresql://neondb_owner:hunter2@ep-x.neon.tech/neondb"),
    );
    expect(stored).not.toContain("hunter2");
    expect(stored).not.toContain("neondb_owner");
    expect(stored).toContain("postgres://[redacted]");
  });

  it("bounds the persisted detail", () => {
    const stored = toStoredError(new Error("x".repeat(5000)));
    expect(stored).toContain("...[truncated]");
    expect(stored.length).toBeLessThan(MAX_ERROR_DETAIL_LENGTH + 40);
  });

  it("handles non-Error values without throwing", () => {
    expect(toStoredError("plain failure")).toContain("plain failure");
    expect(toStoredError(42)).toContain("thrown");
  });
});

describe("logEvent", () => {
  it("emits one JSON line with the record's primitive fields, dropping undefined", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    logEvent({
      event: "worker.unit",
      count: 3,
      ok: true,
      nothing: null,
      missing: undefined,
    });

    expect(spy).toHaveBeenCalledTimes(1);
    const line = String(spy.mock.calls[0]?.[0]);
    expect(JSON.parse(line)).toEqual({
      event: "worker.unit",
      count: 3,
      ok: true,
      nothing: null,
    });
  });

  it("never serialises a structured payload, even if one is passed by mistake", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    // A cast is required precisely because the typed API forbids this: the
    // runtime guard is what is under test.
    const accidental = { event: "worker.unit", payload: { secret: "S3CR3T" } } as unknown as WorkerLogRecord;
    logEvent(accidental);

    const line = String(spy.mock.calls[0]?.[0]);
    expect(line).toContain("[omitted]");
    expect(line).not.toContain("S3CR3T");
  });

  it("redacts secrets inside string fields", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    logEvent({ event: "worker.unit", detail: "password=hunter2" });

    const line = String(spy.mock.calls[0]?.[0]);
    expect(line).not.toContain("hunter2");
  });
});
