/**
 * Structured logging helpers for application observability.
 *
 * Each log event carries a stable, machine-readable `event` name following the
 * hierarchical `domain.action.outcome` convention (e.g., `item.create.committed`)
 * so events can be filtered and alerted on by prefix.
 */

import { Logger } from "winston";

// Used only by `TransactionLogContext` below.
type TransactionOutcome = "committed" | "rolled_back" | "unknown";

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