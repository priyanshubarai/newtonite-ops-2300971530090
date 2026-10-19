import { createHash } from "node:crypto";
import type { Request, Response } from "express";
import { and, eq, sql } from "drizzle-orm";
import { db, type TxClient } from "../db/index.js";
import { idempotencyRecords } from "../db/schema/idempotency_records.js";
import { badRequest, conflict, ERROR_CODES } from "./errors.js";
import { logger } from "../lib/logger.js";
import { logTransactionOutcome, logTransactionStarted, logIdempotencyEvent, type TransactionLogContext } from "../lib/events.js";

/**
 * Database-backed idempotency for mutation endpoints.
 *
 * A client may send an `Idempotency-Key` header. The first request that uses a
 * key performs the mutation and stores the outcome; any later request with the
 * same key (per user + operation) replays the stored status/body instead of
 * mutating again. Reuse with a different payload is rejected.
 *
 * Concurrency is handled with PostgreSQL primitives, not application state:
 *
 * 1. `pg_advisory_xact_lock(hashtext(scope:key))` is the first statement of the
 *    transaction. It serializes every request that shares a (scope, key) for
 *    the life of the transaction and is released automatically on
 *    commit/rollback. A duplicate that arrives while the winner is still
 *    running blocks here, then reads the committed result below - so a racing
 *    duplicate never performs a second mutation. The lock lives in PostgreSQL,
 *    so this works across multiple application processes.
 * 2. The unique index `ir_scope_key_unique (scope, key)` is a database-enforced
 *    backstop guaranteeing two rows for the same key can never both exist.
 * 3. The idempotency record is written **inside the same transaction** as the
 *    business mutation, its activity event, and its outbox job, so all of them
 *    commit together (or none do). A request is never marked `COMPLETED` before
 *    the business work commits.
 *
 * A failed mutation (validation/authorization/conflict) throws, rolling back
 * the transaction and therefore the idempotency record too - a failure is never
 * cached as a success.
 */

export const IDEMPOTENCY_HEADER = "idempotency-key";

/** Upper bound on the key length; keys are opaque client strings. */
export const IDEMPOTENCY_KEY_MAX_LENGTH = 255;

/** Retention hint stored on the record. No automated purge runs in this phase. */
const RETENTION_MS = 24 * 60 * 60 * 1000;

export interface MutationResult {
  status: number;
  body: unknown;
}

/**
 * Deterministic JSON for hashing: object keys are sorted, `undefined` values
 * dropped, and `Date`s normalized to ISO strings, so two semantically equal
 * payloads fingerprint identically regardless of key order.
 */
export function stableStringify(value: unknown): string {
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record)
    .filter((k) => record[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(record[k])}`).join(",")}}`;
}

/** Stable request fingerprint over the operation, its params, and its payload. */
export function requestFingerprint(
  operation: string,
  params: unknown,
  payload: unknown,
): string {
  return createHash("sha256")
    .update(stableStringify({ operation, params, payload }))
    .digest("hex");
}

function scopeFor(userId: string, operation: string): string {
  return `user:${userId}:${operation}`;
}

/**
 * Run a mutation, applying idempotency when an `Idempotency-Key` is present.
 *
 * `business` receives a transaction handle and must perform the work-item
 * change, activity event, and outbox insert on it. It returns the HTTP status
 * and body to send (and to store for replay).
 */
export async function runIdempotentMutation(
  req: Request,
  res: Response,
  operation: string,
  payload: unknown,
  business: (tx: TxClient) => Promise<MutationResult>,
): Promise<void> {
  const header = req.header(IDEMPOTENCY_HEADER);
  const key = typeof header === "string" ? header.trim() : "";
  const requestId = (req as Request & { requestId?: string }).requestId;
  const startTime = Date.now();

  // No key: still run inside a transaction so the mutation, its activity event,
  // and its outbox job commit atomically.
  if (key === "") {
    logTransactionStarted(logger, { requestId, operation });
    try {
      const result = await db.transaction(business);
      logTransactionOutcome(logger, {
        requestId,
        operation,
        transactionOutcome: "committed",
        durationMs: Date.now() - startTime,
        businessChangeCommitted: true,
        activityEventsWritten: 0, // Unknown here, but service can log details
        outboxJobsInserted: 0,
        idempotencyRecordWritten: false,
      });
      res.status(result.status).json(result.body);
      return;
    } catch (error) {
      logTransactionOutcome(logger, {
        requestId,
        operation,
        transactionOutcome: "rolled_back",
        durationMs: Date.now() - startTime,
        businessChangeCommitted: false,
        activityEventsWritten: 0,
        outboxJobsInserted: 0,
        idempotencyRecordWritten: false,
      });
      throw error;
    }
  }

  if (key.length > IDEMPOTENCY_KEY_MAX_LENGTH) {
    throw badRequest(
      `Idempotency-Key must be at most ${IDEMPOTENCY_KEY_MAX_LENGTH} characters`,
    );
  }

  const userId = req.user!.id;
  const scope = scopeFor(userId, operation);
  const requestHash = requestFingerprint(operation, req.params, payload);
  const expiresAt = new Date(Date.now() + RETENTION_MS);

  logTransactionStarted(logger, { requestId, operation });

  const outcome = await db.transaction(async (tx) => {
    // 1. Serialize all requests sharing this (scope, key).
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${`${scope}:${key}`})::bigint)`,
    );

    const existing = (
      await tx
        .select()
        .from(idempotencyRecords)
        .where(and(eq(idempotencyRecords.scope, scope), eq(idempotencyRecords.key, key)))
        .limit(1)
    )[0];

    if (existing) {
      if (existing.requestHash !== requestHash) {
        // Same key, different request: refuse without running anything.
        return { kind: "key_reused" as const };
      }
      if (existing.state === "COMPLETED") {
        // Same key, same request: replay the original outcome verbatim.
        logIdempotencyEvent(logger, "replay", { requestId, operation, key });
        return {
          kind: "replay" as const,
          status: existing.statusCode ?? 200,
          body: existing.responseBody,
        };
      }
      // A leftover non-COMPLETED record (e.g. a process died mid-flight before
      // commit could not have left one, but be defensive) is reclaimed.
      await tx
        .update(idempotencyRecords)
        .set({ requestHash, state: "IN_PROGRESS", statusCode: null, responseBody: null, expiresAt })
        .where(eq(idempotencyRecords.id, existing.id));
    } else {
      await tx.insert(idempotencyRecords).values({
        userId,
        scope,
        key,
        requestHash,
        state: "IN_PROGRESS",
        expiresAt,
      });
    }

    // 2. Perform the business mutation on the SAME transaction.
    const result = await business(tx);

    // 3. Record the outcome before committing. Only now is the request
    //    "successful".
    await tx
      .update(idempotencyRecords)
      .set({
        state: "COMPLETED",
        statusCode: result.status,
        responseBody: result.body as object,
        expiresAt,
      })
      .where(and(eq(idempotencyRecords.scope, scope), eq(idempotencyRecords.key, key)));

    return { kind: "executed" as const, status: result.status, body: result.body };
  });

  if (outcome.kind === "key_reused") {
    logIdempotencyEvent(logger, "key_reused", { requestId, operation, key });
    throw conflict(
      ERROR_CODES.IDEMPOTENCY_KEY_REUSED,
      "Idempotency-Key was already used with a different request payload",
    );
  }

  // Transaction committed successfully
  logTransactionOutcome(logger, {
    requestId,
    operation,
    transactionOutcome: "committed",
    durationMs: Date.now() - startTime,
    businessChangeCommitted: true,
    activityEventsWritten: 0,
    outboxJobsInserted: 0,
    idempotencyRecordWritten: true,
  });

  res.status(outcome.status).json(outcome.body);
}
