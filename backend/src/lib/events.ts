/**
 * Centralized event names and structured logging helpers for application observability.
 *
 * Event names are stable, machine-readable identifiers. They use a hierarchical
 * naming convention: `domain.action.outcome` (e.g., `item.create.committed`).
 * This allows filtering and alerting on event prefixes.
 */

import { Logger } from "winston";

// Service identifiers
export const SERVICE_API = "api";
export const SERVICE_OUTBOX_WORKER = "outbox-worker";

// Event name constants
export const EVENTS = {
  // Request processing stages
  REQUEST_RECEIVED: "request.received",
  REQUEST_AUTHENTICATED: "request.authenticated",
  REQUEST_AUTHORIZED: "request.authorized",
  REQUEST_VALIDATED: "request.validated",
  MUTATION_STARTED: "mutation.started",
  TRANSACTION_STARTED: "transaction.started",
  TRANSACTION_COMMITTED: "transaction.committed",
  TRANSACTION_ROLLED_BACK: "transaction.rolled_back",
  TRANSACTION_OUTCOME_UNKNOWN: "transaction.outcome_unknown",
  BUSINESS_OPERATION_COMPLETED: "business.operation_completed",
  HTTP_RESPONSE_SENT: "http.response_sent",

  // Item lifecycle events
  ITEM_CREATE_COMMITTED: "item.create.committed",
  ITEM_UPDATE_COMMITTED: "item.update.committed",
  ITEM_UPDATE_NOOP: "item.update.noop",
  ITEM_CLAIM_COMMITTED: "item.claim.committed",
  ITEM_CLAIM_LOST_RACE: "item.claim.lost_race",
  ITEM_CLAIM_NOT_CLAIMABLE: "item.claim.not_claimable",
  ITEM_TRANSITION_COMMITTED: "item.transition.committed",
  ITEM_TRANSITION_STALE_VERSION: "item.transition.stale_version",
  ITEM_TRANSITION_INVALID: "item.transition.invalid",
  ITEM_TRANSITION_UNAUTHORIZED: "item.transition.unauthorized",
  COMMENT_CREATE_COMMITTED: "comment.create.committed",

  // Idempotency events
  IDEMPOTENCY_REPLAY: "idempotency.replay",
  IDEMPOTENCY_KEY_REUSED: "idempotency.key_reused",

  // Activity/outbox events within transaction
  ACTIVITY_INSERTED_IN_TRANSACTION: "activity.inserted_in_transaction",
  OUTBOX_INSERTED_IN_TRANSACTION: "outbox.inserted_in_transaction",
  IDEMPOTENCY_RECORD_WRITEN: "idempotency.record_written",

  // Outbox lifecycle events
  OUTBOX_JOB_ENQUEUED: "outbox.job.enqueued",
  OUTBOX_JOB_CLAIMED: "outbox.job.claimed",
  OUTBOX_JOB_PROCESSING: "outbox.job.processing",
  OUTBOX_JOB_ACKNOWLEDGED: "outbox.job.acknowledged",
  OUTBOX_JOB_RETRY_SCHEDULED: "outbox.job.retry_scheduled",
  OUTBOX_JOB_FAILED: "outbox.job.failed",
  OUTBOX_JOB_STATE_LOST: "outbox.job.state_lost",
  OUTBOX_JOB_LEASE_RECOVERED: "outbox.job.lease_recovered",
  OUTBOX_JOB_LEASE_EXHAUSTED: "outbox.job.lease_exhausted",

  // Worker lifecycle
  WORKER_STARTED: "worker.started",
  WORKER_BATCH: "worker.batch",
  WORKER_ITERATION_FAILED: "worker.iteration_failed",
  WORKER_SHUTDOWN_REQUESTED: "worker.shutdown_requested",
  WORKER_SHUTDOWN_COMPLETE: "worker.shutdown_complete",
  WORKER_SHUTDOWN_FAILED: "worker.shutdown_failed",
  WORKER_UNHANDLED_REJECTION: "worker.unhandled_rejection",
} as const;

// Transaction outcome types
export type TransactionOutcome = "committed" | "rolled_back" | "unknown";

// Structured log context for transaction outcomes
export interface TransactionLogContext {
  requestId?: string;
  operation: string;
  itemId?: string;
  teamId?: string;
  transactionOutcome: TransactionOutcome;
  durationMs: number;
  businessChangeCommitted: boolean;
  activityEventsWritten: number;
  outboxJobsInserted: number;
  idempotencyRecordWritten: boolean;
}

// Outbox job log context
export interface OutboxJobLogContext {
  jobId: string;
  jobType: string;
  workerId?: string;
  attempt: number;
  maxAttempts?: number;
  durationMs?: number;
  retryScheduledAt?: string; // ISO timestamp
  outcome?: "acknowledged" | "retry_scheduled" | "dead_lettered" | "lease_recovered" | "state_lost";
  category?: string;
  permanent?: boolean;
  delayMs?: number;
}

// Worker lifecycle log context
export interface WorkerLogContext {
  workerId?: string;
  batchSize?: number;
  pollIntervalMs?: number;
  leaseTimeoutMs?: number;
  backoffBaseMs?: number;
  backoffMaxMs?: number;
  jobTypes?: string[];
  claimed?: number;
  processed?: number;
  retried?: number;
  failed?: number;
  skipped?: number;
  reclaimed?: number;
  exhausted?: number;
  leasesExhausted?: number;
  category?: string;
}

// Conflict/rejection log context
export interface ConflictLogContext {
  requestId?: string;
  operation: string;
  itemId?: string;
  teamId?: string;
  conflictType: "lost_race" | "not_claimable" | "stale_version" | "invalid_transition" | "unauthorized" | "idempotency_key_reused";
  message: string;
}

/**
 * Create a structured log event with common fields.
 */
export function createLogEvent(
  level: "error" | "warn" | "info" | "http" | "debug",
  service: string,
  event: string,
  context: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    timestamp: new Date().toISOString(),
    level,
    service,
    event,
    ...context,
  };
}

/**
 * Log a transaction outcome event with standardized fields.
 * Call this AFTER the transaction commits/rolls back.
 */
export function logTransactionOutcome(
  logger: Logger,
  context: TransactionLogContext
): void {
  const { transactionOutcome, durationMs, ...rest } = context;
  const level = transactionOutcome === "committed" ? "info" : "warn";
  logger.log(level, "Transaction outcome", {
    ...rest,
    event: transactionOutcome === "committed" ? "transaction.committed" : "transaction.rolled_back",
    transactionOutcome,
    durationMs,
  });
}

/**
 * Log a transaction started event.
 */
export function logTransactionStarted(
  logger: Logger,
  context: { requestId?: string; operation: string; itemId?: string; teamId?: string }
): void {
  logger.info("Transaction started", {
    ...context,
    event: "transaction.started",
  });
}

/**
 * Log an activity event inserted within transaction.
 */
export function logActivityInsertedInTransaction(
  logger: Logger,
  context: { requestId?: string; itemId?: string; eventType: string }
): void {
  logger.debug("Activity event inserted in transaction", {
    ...context,
    event: "activity.inserted_in_transaction",
  });
}

/**
 * Log an outbox job inserted within transaction.
 */
export function logOutboxInsertedInTransaction(
  logger: Logger,
  context: { requestId?: string; itemId?: string; jobType: string }
): void {
  logger.debug("Outbox job inserted in transaction", {
    ...context,
    event: "outbox.inserted_in_transaction",
  });
}

/**
 * Log an outbox job lifecycle event.
 */
export function logOutboxJobEvent(
  logger: Logger,
  level: "error" | "warn" | "info" | "debug",
  event: string,
  context: OutboxJobLogContext
): void {
  logger.log(level, "Outbox job event", {
    ...context,
    event,
  });
}

/**
 * Log a worker lifecycle event.
 */
export function logWorkerEvent(
  logger: Logger,
  level: "error" | "warn" | "info" | "debug",
  event: string,
  context: WorkerLogContext = {}
): void {
  logger.log(level, "Worker event", {
    ...context,
    event,
  });
}

/**
 * Log a conflict/rejection event (expected business conflicts).
 */
export function logConflictEvent(
  logger: Logger,
  context: ConflictLogContext
): void {
  logger.warn("Conflict event", {
    ...context,
    event: "conflict." + context.conflictType,
  });
}

/**
 * Log an idempotency event.
 */
export function logIdempotencyEvent(
  logger: Logger,
  event: "replay" | "key_reused",
  context: { requestId?: string; operation: string; key: string }
): void {
  const level = event === "replay" ? "info" : "warn";
  logger.log(level, "Idempotency event", {
    ...context,
    event: "idempotency." + event,
  });
}

/**
 * Log a business operation completion.
 */
export function logBusinessOperation(
  logger: Logger,
  context: {
    requestId?: string;
    operation: string;
    itemId?: string;
    teamId?: string;
    userId?: string;
    actorName?: string;
    message: string;
  }
): void {
  logger.info(context.message, {
    ...context,
    event: "business.operation_completed",
  });
}