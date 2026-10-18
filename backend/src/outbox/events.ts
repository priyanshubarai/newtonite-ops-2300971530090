import { z } from "zod";
import { workStatusEnum } from "../db/schema/enums.js";
import { OUTBOX_JOB_TYPES } from "../items/outbox.js";

/**
 * The outbox event contract, verified against the Phase 5 producer.
 *
 * The producer (`src/items/outbox.ts#buildOutboxJob`) writes a `job_type` from
 * `OUTBOX_JOB_TYPES` and a payload of exactly
 * `{ workItemId, teamId, actorId, status, version }`. This module is the
 * consumer's mirror of that contract: it reuses the producer's constants rather
 * than redefining them, so the two cannot drift.
 *
 * `status` is validated against the database `work_status` enum, so adding a
 * workflow state in the schema is automatically reflected here.
 */

/** Every job type the worker knows how to process. */
export const SUPPORTED_JOB_TYPES = [
  OUTBOX_JOB_TYPES.ITEM_CREATED,
  OUTBOX_JOB_TYPES.ITEM_UPDATED,
  OUTBOX_JOB_TYPES.ITEM_CLAIMED,
  OUTBOX_JOB_TYPES.ITEM_TRANSITIONED,
] as const;

export type SupportedJobType = (typeof SUPPORTED_JOB_TYPES)[number];

export function isSupportedJobType(value: string): value is SupportedJobType {
  return (SUPPORTED_JOB_TYPES as readonly string[]).includes(value);
}

/**
 * The payload shape a supported event must have.
 *
 * `.strict()` (matching the API body-validation convention) rejects unknown keys
 * so a producer/consumer mismatch surfaces as a permanent failure instead of
 * being silently ignored. Note that `status`/`version` are the *event-time*
 * snapshot: they are validated structurally but are deliberately **not**
 * compared with the current row, because the work item legitimately advances
 * after the event is enqueued.
 */
export const outboxPayloadSchema = z
  .object({
    workItemId: z.string().uuid(),
    teamId: z.string().uuid(),
    actorId: z.string().uuid(),
    status: z.enum(workStatusEnum.enumValues),
    version: z.number().int().positive(),
  })
  .strict();

export type OutboxPayload = z.infer<typeof outboxPayloadSchema>;

export type PayloadParseResult =
  | { ok: true; payload: OutboxPayload }
  | { ok: false; issues: string };

/**
 * Validate a stored payload.
 *
 * Reports only field paths and validation messages - never the offending value -
 * so the result is safe to persist in `last_error` or write to a log. Zod's
 * default messages describe the expected shape and the received *type*, not the
 * received value.
 */
export function parseOutboxPayload(value: unknown): PayloadParseResult {
  const result = outboxPayloadSchema.safeParse(value);
  if (result.success) {
    return { ok: true, payload: result.data };
  }

  const issues = result.error.issues
    .map((issue) => {
      const path = issue.path.join(".");
      return path ? `${path}: ${issue.message}` : issue.message;
    })
    .join("; ");

  return { ok: false, issues: issues || "payload failed schema validation" };
}
