import type { NewActivityEvent, WorkItemRow, WorkItemUpdate } from "./repository.js";

/**
 * Activity-event derivation.
 *
 * Every successful work-item mutation writes at least one append-only activity
 * event, in the same transaction as the mutation. Events follow the existing
 * `activity_events` schema: `work_item_id`, `actor_id`, `event_type`, and a
 * single `metadata` JSONB column holding before/after values (Phase 2 note).
 */

export type ActivityEventType = NewActivityEvent["eventType"];

export interface DerivedEvent {
  eventType: ActivityEventType;
  metadata: Record<string, unknown>;
}

/** Fields a client may change through `PATCH`, in a stable order. */
const EDITABLE_FIELDS = [
  "title",
  "description",
  "type",
  "priority",
  "assigneeId",
  "dueAt",
] as const;

function normalize(value: unknown): unknown {
  return value instanceof Date ? value.toISOString() : value;
}

function valuesEqual(a: unknown, b: unknown): boolean {
  return normalize(a) === normalize(b);
}

/**
 * Derive the activity events for a PATCH. One event per changed category:
 * a priority change, an assignee change, and/or a general field change
 * (`ITEM_UPDATED`) carrying the before/after values of the changed fields.
 * Returns an empty array when the patch is a no-op, so the caller can skip the
 * write entirely rather than bumping the version for nothing.
 */
export function deriveUpdateEvents(before: WorkItemRow, patch: WorkItemUpdate): DerivedEvent[] {
  const changed: Array<{ field: string; before: unknown; after: unknown }> = [];
  for (const field of EDITABLE_FIELDS) {
    if (!(field in patch)) continue;
    const after = patch[field] ?? null;
    const prev = before[field] ?? null;
    if (!valuesEqual(prev, after)) changed.push({ field, before: prev, after });
  }
  if (changed.length === 0) return [];

  const events: DerivedEvent[] = [];

  const priority = changed.find((c) => c.field === "priority");
  if (priority) {
    events.push({
      eventType: "PRIORITY_CHANGED",
      metadata: { before: { priority: priority.before }, after: { priority: priority.after } },
    });
  }

  const assignee = changed.find((c) => c.field === "assigneeId");
  if (assignee) {
    events.push({
      eventType: "ASSIGNEE_CHANGED",
      metadata: {
        before: { assigneeId: assignee.before },
        after: { assigneeId: assignee.after },
      },
    });
  }

  const general = changed.filter((c) => c.field !== "priority" && c.field !== "assigneeId");
  if (general.length > 0) {
    const beforeMap: Record<string, unknown> = {};
    const afterMap: Record<string, unknown> = {};
    for (const c of general) {
      beforeMap[c.field] = c.before;
      afterMap[c.field] = c.after;
    }
    events.push({ eventType: "ITEM_UPDATED", metadata: { before: beforeMap, after: afterMap } });
  }

  return events;
}

/**
 * A compact, non-secret snapshot of a work item for `ITEM_CREATED`. The
 * description is intentionally omitted to keep event payloads small; the item
 * itself remains the source of truth for its content.
 */
export function itemSnapshot(row: WorkItemRow): Record<string, unknown> {
  return {
    title: row.title,
    type: row.type,
    priority: row.priority,
    status: row.status,
    teamId: row.teamId,
    assigneeId: row.assigneeId,
    dueAt: row.dueAt ? row.dueAt.toISOString() : null,
  };
}

export function assigneeChangedEvent(
  before: string | null,
  after: string | null,
  via: "claim" | "update",
): DerivedEvent {
  return {
    eventType: "ASSIGNEE_CHANGED",
    metadata: { before: { assigneeId: before }, after: { assigneeId: after }, via },
  };
}

export function statusChangedEvent(before: string, after: string): DerivedEvent {
  return {
    eventType: "STATUS_CHANGED",
    metadata: { before: { status: before }, after: { status: after } },
  };
}

export function itemCreatedEvent(row: WorkItemRow): DerivedEvent {
  return { eventType: "ITEM_CREATED", metadata: { after: itemSnapshot(row) } };
}
