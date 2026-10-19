import { env } from "../config/env.js";
import { computeBackoffMs } from "./backoff.js";
import { SUPPORTED_JOB_TYPES } from "./events.js";
import { PermanentJobError, processOutboxJob } from "./handler.js";
import {
  categorizeError,
  logEvent,
  toStoredError,
  type WorkerLogFn,
  type WorkerLogRecord,
} from "./logging.js";
import {
  claimOutboxJobs,
  failJob,
  markJobCompleted,
  reclaimExpiredLeases,
  rescheduleJob,
  type OutboxJobRow,
} from "./repository.js";
import { logger } from "../lib/logger.js";
import { logWorkerEvent, logOutboxJobEvent, type OutboxJobLogContext, type WorkerLogContext } from "../lib/events.js";

/**
 * The outbox worker loop.
 *
 * One iteration (`runOutboxOnce`) does exactly three things:
 *
 * 1. recover abandoned claims (leases that outlived `leaseTimeoutMs`);
 * 2. claim a bounded batch of eligible jobs;
 * 3. process each claimed job and record the outcome - `COMPLETED`, back to
 *    `PENDING` with backoff, or terminal `FAILED`.
 *
 * Claiming and processing are deliberately separated: the claim transaction is
 * short and its row locks are released before any handler work happens, so no
 * database lock is ever held across a slow operation.
 *
 * The loop (`startOutboxLoop`) is a poller with a bounded interval. It is a
 * *separate process* from the HTTP server (`src/worker.ts` vs `src/index.ts`), so
 * running it never affects API latency and there is exactly one worker per
 * process that starts it.
 *
 * Delivery is **at-least-once**, by construction: a process can finish the
 * handler work and crash before `markJobCompleted` commits, and the lease
 * recovery will then hand the same job to another attempt. Handlers must
 * therefore be idempotent (see `handler.ts`).
 */

export interface WorkerConfig {
  /** Job types this worker may claim. Defaults to every supported type. */
  jobTypes: readonly string[];
  /** Maximum jobs claimed per iteration. */
  batchSize: number;
  /** Delay between iterations when a batch is not full. */
  pollIntervalMs: number;
  /** First-attempt backoff base; later attempts double, with jitter. */
  backoffBaseMs: number;
  /** Backoff ceiling. */
  backoffMaxMs: number;
  /** How long a `PROCESSING` job may be untouched before it is reclaimed. */
  leaseTimeoutMs: number;
  /** Job processor. Injectable so worker mechanics can be tested in isolation. */
  processJob: (job: OutboxJobRow) => Promise<unknown>;
  /** Structured log sink. Injectable so tests can capture records. */
  log: WorkerLogFn;
  /** Worker instance identifier for correlation. */
  workerId: string;
}

/**
 * Build a complete configuration, taking operational values from the validated
 * environment (`config/env.ts`) unless a caller overrides them. The defaults
 * therefore live in exactly one place: the environment schema.
 */
export function resolveWorkerConfig(overrides: Partial<WorkerConfig> = {}): WorkerConfig {
  return {
    jobTypes: overrides.jobTypes ?? SUPPORTED_JOB_TYPES,
    batchSize: overrides.batchSize ?? env.OUTBOX_BATCH_SIZE,
    pollIntervalMs: overrides.pollIntervalMs ?? env.OUTBOX_POLL_INTERVAL_MS,
    backoffBaseMs: overrides.backoffBaseMs ?? env.OUTBOX_BACKOFF_BASE_MS,
    backoffMaxMs: overrides.backoffMaxMs ?? env.OUTBOX_BACKOFF_MAX_MS,
    leaseTimeoutMs: overrides.leaseTimeoutMs ?? env.OUTBOX_LEASE_TIMEOUT_MS,
    processJob: overrides.processJob ?? processOutboxJob,
    log: overrides.log ?? logEvent,
    workerId: overrides.workerId ?? `worker-${process.pid}-${Date.now()}`,
  };
}

export interface WorkerRunSummary {
  /** Jobs claimed in this iteration. */
  claimed: number;
  /** Jobs that completed successfully. */
  processed: number;
  /** Jobs rescheduled for another attempt. */
  retried: number;
  /** Jobs moved to terminal `FAILED`. */
  failed: number;
  /** Jobs whose state transition lost a race (already reclaimed/completed). */
  skipped: number;
  /** Abandoned claims returned to `PENDING`. */
  reclaimed: number;
  /** Abandoned claims that were terminated because attempts were exhausted. */
  leasesExhausted: number;
}

/**
 * Logging must never be able to break the worker, so every log call inside the
 * loop goes through this guard.
 */
function safeLog(config: WorkerConfig, record: WorkerLogRecord): void {
  try {
    config.log(record);
  } catch {
    // A failing log sink is not a reason to lose a job.
  }
}

/**
 * Run a single worker iteration to completion.
 *
 * Never throws for a *job* failure - those are recorded on the job row. A
 * database-level failure (e.g. the claim query cannot run) does propagate, and
 * the loop treats it as a failed poll rather than a fatal error.
 */
export async function runOutboxOnce(config: WorkerConfig): Promise<WorkerRunSummary> {
  const summary: WorkerRunSummary = {
    claimed: 0,
    processed: 0,
    retried: 0,
    failed: 0,
    skipped: 0,
    reclaimed: 0,
    leasesExhausted: 0,
  };

  const workerContext: WorkerLogContext = {
    workerId: config.workerId,
    batchSize: config.batchSize,
    pollIntervalMs: config.pollIntervalMs,
    leaseTimeoutMs: config.leaseTimeoutMs,
    backoffBaseMs: config.backoffBaseMs,
    backoffMaxMs: config.backoffMaxMs,
    jobTypes: [...config.jobTypes],
  };

  // Recover first, so anything rescued in this iteration is claimable below.
  const reclaim = await reclaimExpiredLeases(config.leaseTimeoutMs);
  summary.reclaimed = reclaim.reclaimed;
  summary.leasesExhausted = reclaim.exhausted;
  if (reclaim.reclaimed > 0 || reclaim.exhausted > 0) {
    logWorkerEvent(logger, "info", "outbox.job.lease_recovered", {
      ...workerContext,
      reclaimed: reclaim.reclaimed,
      exhausted: reclaim.exhausted,
    });
    safeLog(config, {
      event: "worker.leases_recovered",
      reclaimed: reclaim.reclaimed,
      exhausted: reclaim.exhausted,
    });
  }

  const jobs = await claimOutboxJobs({
    jobTypes: config.jobTypes,
    batchSize: config.batchSize,
  });
  summary.claimed = jobs.length;

  for (const job of jobs) {
    // `claimOutboxJobs` already incremented the attempt counter, so this is the
    // attempt currently being executed. Reaching the bound here means this was
    // the final permitted attempt.
    const attemptsExhausted = job.attemptCount >= job.maxAttempts;

    // Log job claimed
    logOutboxJobEvent(logger, "info", "outbox.job.claimed", {
      jobId: job.id,
      jobType: job.jobType,
      workerId: config.workerId,
      attempt: job.attemptCount,
      maxAttempts: job.maxAttempts,
    });

    try {
      logOutboxJobEvent(logger, "debug", "outbox.job.processing", {
        jobId: job.id,
        jobType: job.jobType,
        workerId: config.workerId,
        attempt: job.attemptCount,
        maxAttempts: job.maxAttempts,
      });

      await config.processJob(job);

      if (await markJobCompleted(job.id)) {
        summary.processed += 1;
        logOutboxJobEvent(logger, "info", "outbox.job.acknowledged", {
          jobId: job.id,
          jobType: job.jobType,
          workerId: config.workerId,
          attempt: job.attemptCount,
          maxAttempts: job.maxAttempts,
          durationMs: 0, // Not tracked currently
        });
        safeLog(config, {
          event: "worker.job_completed",
          jobId: job.id,
          jobType: job.jobType,
          attempt: job.attemptCount,
          maxAttempts: job.maxAttempts,
        });
      } else {
        summary.skipped += 1;
        logOutboxJobEvent(logger, "warn", "outbox.job.state_lost", {
          jobId: job.id,
          jobType: job.jobType,
          workerId: config.workerId,
          attempt: job.attemptCount,
          maxAttempts: job.maxAttempts,
          category: "state_lost",
        });
        safeLog(config, {
          event: "worker.job_state_lost",
          jobId: job.id,
          jobType: job.jobType,
        });
      }
    } catch (cause) {
      const permanent = cause instanceof PermanentJobError;
      const category = categorizeError(cause);
      const detail = toStoredError(cause);

      if (permanent || attemptsExhausted) {
        const recorded = await failJob(job.id, detail);
        if (recorded) {
          summary.failed += 1;
          logOutboxJobEvent(logger, "error", "outbox.job.failed", {
            jobId: job.id,
            jobType: job.jobType,
            workerId: config.workerId,
            attempt: job.attemptCount,
            maxAttempts: job.maxAttempts,
            category,
            permanent,
            outcome: "dead_lettered",
          });
          safeLog(config, {
            event: "worker.job_failed",
            jobId: job.id,
            jobType: job.jobType,
            attempt: job.attemptCount,
            maxAttempts: job.maxAttempts,
            category,
            permanent,
          });
        } else {
          summary.skipped += 1;
          safeLog(config, { event: "worker.job_state_lost", jobId: job.id, category });
        }
      } else {
        const delayMs = computeBackoffMs(job.attemptCount, config.backoffBaseMs, config.backoffMaxMs);
        const recorded = await rescheduleJob(job.id, delayMs, detail);
        if (recorded) {
          summary.retried += 1;
          const retryScheduledAt = new Date(Date.now() + delayMs).toISOString();
          logOutboxJobEvent(logger, "warn", "outbox.job.retry_scheduled", {
            jobId: job.id,
            jobType: job.jobType,
            workerId: config.workerId,
            attempt: job.attemptCount,
            maxAttempts: job.maxAttempts,
            category,
            delayMs,
            retryScheduledAt,
            outcome: "retry_scheduled",
          });
          safeLog(config, {
            event: "worker.job_retry_scheduled",
            jobId: job.id,
            jobType: job.jobType,
            attempt: job.attemptCount,
            maxAttempts: job.maxAttempts,
            category,
            delayMs,
          });
        } else {
          summary.skipped += 1;
          safeLog(config, { event: "worker.job_state_lost", jobId: job.id, category });
        }
      }
    }
  }

  return summary;
}

export interface OutboxLoopHandle {
  /**
   * Stop claiming new jobs and resolve once the in-flight iteration has
   * finished. Safe to call more than once.
   */
  stop(): Promise<void>;
}

/**
 * Start polling. Returns a handle whose `stop()` implements the graceful
 * shutdown contract:
 *
 * - no new batch is claimed after `stop()` is called;
 * - a batch already in flight is allowed to finish (so no job is left stranded
 *   mid-flight - if the process is interrupted anyway, the lease recovery in
 *   the next worker picks it up);
 * - the loop's timer is cleared, so nothing keeps the event loop alive.
 */
export function startOutboxLoop(config: WorkerConfig): OutboxLoopHandle {
  let stopping = false;
  let wakeFromSleep: (() => void) | null = null;
  let resolveFinished: () => void = () => {};
  const finished = new Promise<void>((resolve) => {
    resolveFinished = resolve;
  });

  const workerContext: WorkerLogContext = {
    workerId: config.workerId,
    batchSize: config.batchSize,
    pollIntervalMs: config.pollIntervalMs,
    leaseTimeoutMs: config.leaseTimeoutMs,
    backoffBaseMs: config.backoffBaseMs,
    backoffMaxMs: config.backoffMaxMs,
    jobTypes: [...config.jobTypes],
  };

  logWorkerEvent(logger, "info", "worker.started", workerContext);
  safeLog(config, {
    event: "worker.started",
    batchSize: config.batchSize,
    pollIntervalMs: config.pollIntervalMs,
    leaseTimeoutMs: config.leaseTimeoutMs,
    backoffBaseMs: config.backoffBaseMs,
    backoffMaxMs: config.backoffMaxMs,
    jobTypes: config.jobTypes.join(","),
  });

  // Interruptible sleep: `stop()` wakes it immediately instead of waiting out
  // the full poll interval.
  const sleep = (ms: number): Promise<void> =>
    new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        wakeFromSleep = null;
        resolve();
      }, ms);
      wakeFromSleep = () => {
        clearTimeout(timer);
        wakeFromSleep = null;
        resolve();
      };
    });

  const loop = async (): Promise<void> => {
    try {
      while (!stopping) {
        try {
          const summary = await runOutboxOnce(config);
          if (
            summary.claimed > 0 ||
            summary.reclaimed > 0 ||
            summary.leasesExhausted > 0
          ) {
            logWorkerEvent(logger, "debug", "worker.batch", {
              ...workerContext,
              claimed: summary.claimed,
              processed: summary.processed,
              retried: summary.retried,
              failed: summary.failed,
              skipped: summary.skipped,
              reclaimed: summary.reclaimed,
              leasesExhausted: summary.leasesExhausted,
            });
            safeLog(config, { event: "worker.batch", ...summary });
          }
        } catch (cause) {
          // A failed poll must not kill the worker; log the category and try
          // again after the poll interval.
          logWorkerEvent(logger, "error", "worker.iteration_failed", {
            ...workerContext,
            category: categorizeError(cause),
          });
          safeLog(config, {
            event: "worker.iteration_failed",
            category: categorizeError(cause),
            detail: toStoredError(cause),
          });
        }

        if (stopping) break;
        await sleep(config.pollIntervalMs);
      }
    } finally {
      logWorkerEvent(logger, "info", "worker.shutdown_complete", workerContext);
      safeLog(config, { event: "worker.stopped" });
      resolveFinished();
    }
  };

  // `loop` cannot reject: job failures are handled per job, poll failures are
  // caught per iteration, and logging is guarded. The catch is belt-and-braces
  // against an unhandled rejection.
  void loop().catch((cause) => {
    logWorkerEvent(logger, "error", "worker.unhandled_rejection", {
      ...workerContext,
      category: categorizeError(cause),
    });
    safeLog(config, {
      event: "worker.unhandled_rejection",
      category: categorizeError(cause),
      detail: toStoredError(cause),
    });
    resolveFinished();
  });

  return {
    async stop(): Promise<void> {
      if (stopping) {
        await finished;
        return;
      }
      logWorkerEvent(logger, "info", "worker.shutdown_requested", workerContext);
      stopping = true;
      // Wake the poller so shutdown is prompt.
      wakeFromSleep?.();
      await finished;
    },
  };
}
