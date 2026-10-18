/**
 * Log-safe serialisation for the outbox worker.
 *
 * Two rules are enforced structurally, not by convention:
 *
 * 1. **No structured payloads in logs.** `logEvent` only emits primitives; any
 *    object or array value (for example a job payload) is replaced with
 *    `"[omitted]"`. There is no code path that can print the payload.
 * 2. **No secrets in logs or in persisted error text.** Every string value and
 *    every error message passes through `redactSecrets` before it is written,
 *    so a connection string, password, bearer token, or long hex secret that
 *    happens to appear inside an error message cannot leak.
 *
 * Error *categories* are stable identifiers (e.g. `INVALID_PAYLOAD`) and never
 * contain values, so a category is always safe to log and persist.
 */

/** Longest persisted/logged error detail. Keeps a pathological message bounded. */
export const MAX_ERROR_DETAIL_LENGTH = 500;

const REDACTION_RULES: ReadonlyArray<readonly [RegExp, string]> = [
  // PostgreSQL connection strings (with or without an embedded password).
  [/\bpostgres(?:ql)?:\/\/\S+/gi, "postgres://[redacted]"],
  // Bearer credentials. This rule must run before the key=value rule so that an
  // `Authorization: Bearer <token>` header has its *token* removed rather than
  // just the header name being replaced.
  [/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer [redacted]"],
  // key=value / key: value style credentials.
  [
    /\b(password|passwd|pwd|secret|token|api[_-]?key|authorization)\b\s*[=:]\s*["']?[^\s"',;]+/gi,
    "$1=[redacted]",
  ],
  // JWT-shaped values (three base64url segments starting with the "eyJ" header).
  [
    /\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{2,}/g,
    "[redacted-jwt]",
  ],
  // A long unbroken hex run is treated as a raw secret (e.g. a 96-char
  // JWT_SECRET). UUIDs are hyphenated and shorter, so they are not affected.
  [/\b[0-9a-fA-F]{40,}\b/g, "[redacted-hex]"],
];

/** Replace anything that looks like a credential with a stable placeholder. */
export function redactSecrets(text: string): string {
  let out = text;
  for (const [pattern, replacement] of REDACTION_RULES) {
    out = out.replace(pattern, replacement);
  }
  return out;
}

/** Truncate a detail string to the persistence bound. */
export function boundText(text: string, maxLength = MAX_ERROR_DETAIL_LENGTH): string {
  return text.length <= maxLength ? text : `${text.slice(0, maxLength)}...[truncated]`;
}

function errorName(err: unknown): string {
  if (err instanceof Error && err.name) return err.name;
  if (typeof err === "object" && err !== null) {
    const name = (err as { constructor?: { name?: unknown } }).constructor?.name;
    if (typeof name === "string" && name) return name;
  }
  return typeof err;
}

/** Read a stable, log-safe `category` off an error if it declares one. */
function errorCategory(err: unknown): string | null {
  if (typeof err !== "object" || err === null) return null;
  const category = (err as { category?: unknown }).category;
  return typeof category === "string" && /^[A-Z0-9_]{1,64}$/.test(category) ? category : null;
}

/**
 * A stable, value-free classification of a failure for logs and metrics-style
 * counting. Never includes a message, so it is always safe to emit.
 */
export function categorizeError(err: unknown): string {
  return errorCategory(err) ?? errorName(err);
}

/**
 * A redacted, bounded description for `last_error` and log `detail` fields.
 * Includes the category (when present) plus the redacted message.
 */
export function toStoredError(err: unknown): string {
  const category = errorCategory(err);
  const raw =
    err instanceof Error
      ? err.message
      : typeof err === "string"
        ? err
        : `${errorName(err)} thrown`;
  const detail = boundText(redactSecrets(raw));
  return category ? `${category}: ${detail}` : `${errorName(err)}: ${detail}`;
}

/** A log record: `event` plus flat primitive fields. */
export type WorkerLogRecord = { event: string } & Record<
  string,
  string | number | boolean | null | undefined
>;

export type WorkerLogFn = (record: WorkerLogRecord) => void;

/**
 * Emit one structured JSON log line. Non-primitive values are replaced rather
 * than serialised, so a payload can never reach the log even by mistake.
 */
export const logEvent: WorkerLogFn = (record) => {
  const safe: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(record)) {
    if (value === undefined) continue;
    if (value === null) {
      safe[key] = null;
    } else if (typeof value === "string") {
      safe[key] = redactSecrets(value);
    } else if (typeof value === "number" || typeof value === "boolean") {
      safe[key] = value;
    } else {
      // Arrays/objects (i.e. a structured payload) are never emitted.
      safe[key] = "[omitted]";
    }
  }
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(safe));
};
