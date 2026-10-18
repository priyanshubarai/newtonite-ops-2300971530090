import { findWorkItemById } from "../items/repository.js";
import { isSupportedJobType, parseOutboxPayload } from "./events.js";
import type { OutboxJobRow } from "./repository.js";

/**
 * Outbox job processing.
 *
 * ## What this handler actually does
 *
 * There is no approved downstream integration (no email, webhook, or external
 * service), and inventing one would mean claiming a delivery that never
 * happened. So the handler performs the *real, verifiable* internal work that a
 * consumer of these events must do before an event can be acknowledged:
 *
 * 1. confirm the event type is one the worker supports;
 * 2. validate the payload against the Phase 5 event contract;
 * 3. load the referenced work item and confirm it exists;
 * 4. confirm the event's team matches the work item's team (a structural
 *    invariant: the producer builds the payload from the row it just wrote, so
 *    a mismatch means the record is corrupt).
 *
 * That is an acknowledgement, not a notification. The worker therefore reports
 * "processed/validated" - never "delivered".
 *
 * ## Idempotency
 *
 * Steps 1-4 are pure reads and validations, so running them twice has no effect
 * whatsoever: the handler is idempotent by construction. Combined with the
 * `PENDING` -> `PROCESSING` -> `COMPLETED` guard in the repository, a duplicate
 * delivery cannot produce a duplicate downstream effect.
 *
 * ## Failure classification
 *
 * - `PermanentJobError` - the event can never succeed (unknown type, malformed
 *   payload, missing work item, corrupt team reference). The worker fails the
 *   job immediately: retrying a malformed event forever is the failure mode this
 *   prevents.
 * - `TransientJobError` - the event could succeed later (a read failed because
 *   the database was briefly unavailable). The worker retries with backoff,
 *   bounded by `max_attempts`.
 *
 * Neither error carries payload contents in its message, so `last_error` and
 * the worker log stay free of event data.
 */

/** Stable, value-free failure categories used by logs and `last_error`. */
export const HANDLER_ERROR_CATEGORIES = {
  UNSUPPORTED_JOB_TYPE: "UNSUPPORTED_JOB_TYPE",
  INVALID_PAYLOAD: "INVALID_PAYLOAD",
  DANGLING_REFERENCE: "DANGLING_REFERENCE",
  TEAM_MISMATCH: "TEAM_MISMATCH",
  LOOKUP_FAILED: "LOOKUP_FAILED",
} as const;

export type HandlerErrorCategory =
  (typeof HANDLER_ERROR_CATEGORIES)[keyof typeof HANDLER_ERROR_CATEGORIES];

/**
 * A failure that will never succeed on retry. The worker moves the job straight
 * to `FAILED` (dead-letter) regardless of the remaining attempt budget.
 */
export class PermanentJobError extends Error {
  readonly category: HandlerErrorCategory;

  constructor(category: HandlerErrorCategory, message: string) {
    super(message);
    this.name = "PermanentJobError";
    this.category = category;
  }
}

/**
 * A failure that may succeed later. The worker reschedules with backoff unless
 * the attempt budget is exhausted.
 */
export class TransientJobError extends Error {
  readonly category: HandlerErrorCategory;

  constructor(category: HandlerErrorCategory, message: string) {
    super(message);
    this.name = "TransientJobError";
    this.category = category;
  }
}

export interface HandlerAcknowledgement {
  jobId: string;
  jobType: string;
  /** The work item the event refers to (internal; never written to a log). */
  workItemId: string;
}

/**
 * Validate and acknowledge one claimed job.
 *
 * Must be called with a row already claimed (`PROCESSING`). It performs no
 * database writes - the worker owns the state transition.
 */
export async function processOutboxJob(job: OutboxJobRow): Promise<HandlerAcknowledgement> {
  if (!isSupportedJobType(job.jobType)) {
    throw new PermanentJobError(
      HANDLER_ERROR_CATEGORIES.UNSUPPORTED_JOB_TYPE,
      "event type is not supported by this worker",
    );
  }

  const parsed = parseOutboxPayload(job.payload);
  if (!parsed.ok) {
    // `parsed.issues` contains field paths and validation messages only - never
    // the offending values - so it is safe to persist.
    throw new PermanentJobError(
      HANDLER_ERROR_CATEGORIES.INVALID_PAYLOAD,
      `payload failed validation (${parsed.issues})`,
    );
  }

  const { workItemId, teamId } = parsed.payload;

  let existing: Awaited<ReturnType<typeof findWorkItemById>>;
  try {
    existing = await findWorkItemById(workItemId);
  } catch {
    // A read failure is retryable; the message must not include the driver
    // error, which could contain connection details.
    throw new TransientJobError(
      HANDLER_ERROR_CATEGORIES.LOOKUP_FAILED,
      "could not read the referenced work item",
    );
  }

  if (!existing) {
    throw new PermanentJobError(
      HANDLER_ERROR_CATEGORIES.DANGLING_REFERENCE,
      "the referenced work item no longer exists",
    );
  }

  if (existing.teamId !== teamId) {
    throw new PermanentJobError(
      HANDLER_ERROR_CATEGORIES.TEAM_MISMATCH,
      "the referenced work item belongs to a different team than the event claims",
    );
  }

  return { jobId: job.id, jobType: job.jobType, workItemId };
}
