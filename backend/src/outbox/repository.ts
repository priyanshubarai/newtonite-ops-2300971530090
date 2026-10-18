import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { outboxJobs } from "../db/schema/outbox_jobs.js";
import { SUPPORTED_JOB_TYPES } from "./events.js";

/**
 * Outbox persistence: claiming, completion, retry scheduling, terminal failure,
 * and lease recovery.
 *
 * Every function here uses only the columns that already exist in
 * `outbox_jobs` (added in Phase 2, written by Phase 5). No column was invented:
 *
 * | Column            | Use in the worker                                     |
 * |-------------------|-------------------------------------------------------|
 * | `status`          | `PENDING` -> `PROCESSING` -> `COMPLETED`/`FAILED`     |
 * | `next_attempt_at` | eligibility time; now + backoff after a retry          |
 * | `attempt_count`   | incremented on each claim (leases consume an attempt)  |
 * | `max_attempts`    | per-job attempt bound                                  |
 * | `processed_at`    | set on terminal states                                 |
 * | `last_error`      | redacted, bounded failure detail                       |
 * | `updated_at`      | **lease timestamp** - set at claim time (`now()`)      |
 *
 * **Lease design.** The schema has a `PROCESSING` status but no dedicated lock
 * columns, so `updated_at` (maintained by the worker as the database clock at
 * each state change) is used as the lease start. A row left in `PROCESSING`
 * longer than the configured lease timeout is considered abandoned and is
 * recovered by `reclaimExpiredLeases`.
 *
 * All timestamps are produced by the **database** clock (`now()`), never the
 * worker process clock, so lease arithmetic cannot drift with host clock skew.
 */

export type OutboxJobRow = typeof outboxJobs.$inferSelect;

/** Default claim batch when a caller does not specify one. */
export const DEFAULT_CLAIM_BATCH_SIZE = 10;

export interface ClaimOutboxOptions {
  /** Job types eligible for this claim. Defaults to every supported type. */
  jobTypes?: readonly string[];
  batchSize?: number;
}

/**
 * Claim up to `batchSize` eligible jobs and mark them `PROCESSING`.
 *
 * The candidates are selected with `FOR UPDATE SKIP LOCKED` inside a short
 * transaction, then updated in the same transaction. Concurrency safety comes
 * from the database: a second worker running this at the same time skips rows
 * that the first has already locked, so the two claims return **disjoint**
 * sets even though both may observe the rows as `PENDING` in their snapshot.
 *
 * Eligibility is evaluated in one place:
 * - `status = 'PENDING'` - not already claimed, completed, or failed;
 * - `attempt_count < max_attempts` - the attempt budget is not exhausted;
 * - `next_attempt_at <= now()` - the retry/backoff delay has elapsed;
 * - `job_type` is one of the requested (by default, supported) types.
 *
 * The transaction contains only these two statements - no processing happens
 * while the row locks are held.
 */
export async function claimOutboxJobs(
  options: ClaimOutboxOptions = {},
): Promise<OutboxJobRow[]> {
  const jobTypes = options.jobTypes ?? SUPPORTED_JOB_TYPES;
  const batchSize = options.batchSize ?? DEFAULT_CLAIM_BATCH_SIZE;

  if (jobTypes.length === 0 || batchSize <= 0) {
    return [];
  }

  return db.transaction(async (tx) => {
    const candidates = await tx
      .select({ id: outboxJobs.id })
      .from(outboxJobs)
      .where(
        and(
          eq(outboxJobs.status, "PENDING"),
          sql`${outboxJobs.attemptCount} < ${outboxJobs.maxAttempts}`,
          sql`${outboxJobs.nextAttemptAt} <= now()`,
          inArray(outboxJobs.jobType, [...jobTypes]),
        ),
      )
      // Oldest-eligible first, tie-broken by creation order for a stable queue.
      .orderBy(asc(outboxJobs.nextAttemptAt), asc(outboxJobs.createdAt))
      .limit(batchSize)
      .for("update", { skipLocked: true });

    if (candidates.length === 0) {
      return [];
    }

    return tx
      .update(outboxJobs)
      .set({
        status: "PROCESSING",
        attemptCount: sql`${outboxJobs.attemptCount} + 1`,
        updatedAt: sql`now()`,
      })
      .where(
        inArray(
          outboxJobs.id,
          candidates.map((row) => row.id),
        ),
      )
      .returning();
  });
}

/**
 * Record a successful delivery. Guarded on `status = 'PROCESSING'` so a row that
 * another worker has already reclaimed or completed is never clobbered.
 * Returns false when the guard did not match (the caller lost the row).
 */
export async function markJobCompleted(jobId: string): Promise<boolean> {
  const rows = await db
    .update(outboxJobs)
    .set({
      status: "COMPLETED",
      processedAt: sql`now()`,
      updatedAt: sql`now()`,
      lastError: null,
    })
    .where(and(eq(outboxJobs.id, jobId), eq(outboxJobs.status, "PROCESSING")))
    .returning({ id: outboxJobs.id });

  return rows.length > 0;
}

/**
 * Schedule a retry: back to `PENDING` with `next_attempt_at = now() + delay`.
 * The delay is applied by the database clock. Guarded on `PROCESSING`.
 */
export async function rescheduleJob(
  jobId: string,
  delayMs: number,
  errorDetail: string,
): Promise<boolean> {
  const delay = Number.isFinite(delayMs) && delayMs > 0 ? Math.floor(delayMs) : 1;

  const rows = await db
    .update(outboxJobs)
    .set({
      status: "PENDING",
      nextAttemptAt: sql`now() + (${delay}::int * interval '1 millisecond')`,
      lastError: errorDetail,
      updatedAt: sql`now()`,
    })
    .where(and(eq(outboxJobs.id, jobId), eq(outboxJobs.status, "PROCESSING")))
    .returning({ id: outboxJobs.id });

  return rows.length > 0;
}

/**
 * Terminal failure: the job will not be attempted again. Guarded on
 * `PROCESSING`. Used for permanent payload/schema errors and for exhausted
 * attempts, so a malformed or repeatedly failing event cannot loop forever.
 */
export async function failJob(jobId: string, errorDetail: string): Promise<boolean> {
  const rows = await db
    .update(outboxJobs)
    .set({
      status: "FAILED",
      processedAt: sql`now()`,
      updatedAt: sql`now()`,
      lastError: errorDetail,
    })
    .where(and(eq(outboxJobs.id, jobId), eq(outboxJobs.status, "PROCESSING")))
    .returning({ id: outboxJobs.id });

  return rows.length > 0;
}

export interface ReclaimResult {
  /** Abandoned claims returned to `PENDING` for another attempt. */
  reclaimed: number;
  /** Abandoned claims whose attempt budget was already exhausted. */
  exhausted: number;
}

/**
 * Recover abandoned claims.
 *
 * A job is abandoned when it has been `PROCESSING` for longer than the lease
 * timeout - i.e. its worker crashed, was killed, or lost the database
 * connection between claiming and recording an outcome.
 *
 * Because a claim consumes an attempt, a job that keeps crashing the worker
 * cannot loop forever: once its attempts are exhausted the abandoned claim is
 * moved straight to `FAILED` instead of back to `PENDING`.
 */
export async function reclaimExpiredLeases(leaseTimeoutMs: number): Promise<ReclaimResult> {
  const lease = Number.isFinite(leaseTimeoutMs) && leaseTimeoutMs > 0 ? Math.floor(leaseTimeoutMs) : 1;
  const exhausted = sql`${outboxJobs.attemptCount} >= ${outboxJobs.maxAttempts}`;

  const rows = await db
    .update(outboxJobs)
    .set({
      status: sql`CASE WHEN ${exhausted} THEN 'FAILED'::outbox_status ELSE 'PENDING'::outbox_status END`,
      processedAt: sql`CASE WHEN ${exhausted} THEN now() ELSE ${outboxJobs.processedAt} END`,
      lastError: sql`CASE WHEN ${exhausted} THEN 'Lease expired and attempts were exhausted' ELSE ${outboxJobs.lastError} END`,
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(outboxJobs.status, "PROCESSING"),
        sql`${outboxJobs.updatedAt} < now() - (${lease}::int * interval '1 millisecond')`,
      ),
    )
    .returning({ status: outboxJobs.status });

  return {
    reclaimed: rows.filter((row) => row.status === "PENDING").length,
    exhausted: rows.filter((row) => row.status === "FAILED").length,
  };
}

/** Read one job by id (used by tests and operator queries). */
export async function findOutboxJobById(jobId: string): Promise<OutboxJobRow | null> {
  const rows = await db.select().from(outboxJobs).where(eq(outboxJobs.id, jobId)).limit(1);
  return rows[0] ?? null;
}
