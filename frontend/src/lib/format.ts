/** Small, dependency-free formatting helpers. */

/** Format an ISO timestamp for display, or an em dash when absent/invalid. */
export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Format an ISO timestamp as a date only, or an em dash when absent. */
export function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
  });
}

/** Is this due date in the past relative to now? */
export function isOverdue(value: string | null | undefined, now = Date.now()): boolean {
  if (!value) return false;
  const time = new Date(value).getTime();
  return !Number.isNaN(time) && time < now;
}

/**
 * Convert an ISO string to the value shape a `datetime-local` input expects
 * (`YYYY-MM-DDTHH:mm` in local time), or `""` when absent.
 */
export function isoToDateTimeLocal(value: string | null | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}

/**
 * Convert a `datetime-local` input value to an ISO string (or `null` when
 * blank). `new Date("YYYY-MM-DDTHH:mm")` is interpreted as local time, which is
 * what the user expects to have typed.
 */
export function dateTimeLocalToIso(value: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

/** True when a string is a well-formed UUID (used for assignee id inputs). */export function isUuid(value: string): boolean {
  return /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(
    value,
  );
}

/** Show an opaque id (e.g. an assignee) in a compact, readable form. */
export function shortId(id: string, length = 8): string {
  return id.length <= length ? id : `${id.slice(0, length)}…`;
}
