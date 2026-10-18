import { randomUUID } from "node:crypto";
import { and, eq, inArray, sql, type SQL } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  addMembership,
  cleanupFixture,
  createTestTeam,
  createTestUser,
  createTestWorkItem,
  uniqueEmail,
  uniqueSlug,
} from "../auth/testFixtures.js";
import { db, pool } from "../db/index.js";
import { outboxJobs } from "../db/schema/outbox_jobs.js";
import { OUTBOX_JOB_TYPES } from "../items/outbox.js";
import { SUPPORTED_JOB_TYPES } from "./events.js";
import { PermanentJobError, TransientJobError, processOutboxJob } from "./handler.js";
import type { WorkerLogRecord } from "./logging.js";
import {
  claimOutboxJobs,
  findOutboxJobById,
  reclaimExpiredLeases,
  type OutboxJobRow,
} from "./repository.js";
import {
  resolveWorkerConfig,
  runOutboxOnce,
  startOutboxLoop,
  type WorkerConfig,
} from "./worker.js";

/**
 * Phase 8 integration tests for the transactional-outbox worker.
 *
 * Everything here runs against the **real** Neon PostgreSQL database through the
 * same `@neondatabase/serverless` driver the application uses, because the
 * guarantees that matter - concurrency-safe claiming (including
 * `FOR UPDATE SKIP LOCKED`), lease recovery, and enum-typed state transitions -
 * cannot be established with mocks.
 *
 * ## Test isolation
 *
 * The worker is driven with a **unique sentinel job type per run** for every
 * claiming/loop test, so a run can never claim (and mutate) a pending job that
 * belongs to another suite or to the demo dataset. Only jobs created by this
 * file are ever claimed, and every created job id is deleted in `afterEach`.
 * The real `work_item.*` handler is exercised directly against a throwaway
 * fixture work item.
 *
 * Note on "no destructive tests": this suite inserts and deletes only its own
 * rows. It never truncates a table, never resets the schema, and never touches
 * the seeded demo data.
 */

const SENTINEL_JOB_TYPE = `test.outbox.${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;

let teamId: string;
let userId: string;
let workItemId: string;

/** Every job this file inserts, so cleanup is exact. */
const createdJobIds: string[] = [];

function defaultPayload(): Record<string, unknown> {
  return {
    workItemId,
    teamId,
    actorId: userId,
    status: "OPEN",
    version: 1,
  };
}

interface JobOverrides {
  jobType?: string;
  payload?: unknown;
  status?: (typeof outboxJobs.$inferInsert)["status"];
  attemptCount?: number;
  maxAttempts?: number;
  /** `next_attempt_at`: a `Date`, or a SQL expression such as `sql\`now() + interval '1 hour'\``. */
  nextAttemptAt?: Date | SQL;
  /** `updated_at` (the lease timestamp): a `Date`, or a SQL expression for a stale value. */
  updatedAt?: Date | SQL;
}

async function insertJob(overrides: JobOverrides = {}): Promise<OutboxJobRow> {
  const [row] = await db
    .insert(outboxJobs)
    .values({
      jobType: overrides.jobType ?? SENTINEL_JOB_TYPE,
      payload: overrides.payload ?? defaultPayload(),
      status: overrides.status ?? "PENDING",
      attemptCount: overrides.attemptCount ?? 0,
      maxAttempts: overrides.maxAttempts ?? 5,
      ...(overrides.nextAttemptAt !== undefined
        ? { nextAttemptAt: overrides.nextAttemptAt }
        : {}),
      ...(overrides.updatedAt !== undefined ? { updatedAt: overrides.updatedAt } : {}),
    })
    .returning();

  createdJobIds.push(row.id);
  return row;
}

/** Seconds until the job becomes eligible, measured entirely by the database clock. */
async function secondsUntilEligible(jobId: string): Promise<number> {
  const rows = await db
    .select({
      seconds: sql<number>`extract(epoch from (${outboxJobs.nextAttemptAt} - now()))::float8`,
    })
    .from(outboxJobs)
    .where(eq(outboxJobs.id, jobId));
  return Number(rows[0]?.seconds ?? Number.NaN);
}

/**
 * A hermetic worker configuration. `jobTypes` defaults to this run's sentinel so
 * a test can never accidentally claim a real producer job.
 */
function testConfig(overrides: Partial<WorkerConfig> = {}): WorkerConfig {
  return resolveWorkerConfig({
    jobTypes: [SENTINEL_JOB_TYPE],
    batchSize: 10,
    pollIntervalMs: 10,
    backoffBaseMs: 5,
    backoffMaxMs: 10,
    leaseTimeoutMs: 60_000,
    log: () => {},
    ...overrides,
  });
}

function withProcessor(
  config: WorkerConfig,
  processJob: (job: OutboxJobRow) => Promise<unknown>,
): WorkerConfig {
  return { ...config, processJob };
}

async function waitFor(predicate: () => boolean, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("timed out waiting for condition");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

beforeAll(async () => {
  teamId = await createTestTeam("Outbox Worker Team", uniqueSlug("outbox-worker"));
  userId = await createTestUser(uniqueEmail("outbox-worker"), "Outbox Worker", undefined, true);
  await addMembership(userId, teamId, "MEMBER");
  workItemId = await createTestWorkItem({ teamId, createdBy: userId, title: "Worker fixture item" });
});

afterEach(async () => {
  const ids = createdJobIds.splice(0);
  if (ids.length > 0) {
    await db.delete(outboxJobs).where(inArray(outboxJobs.id, ids));
  }
});

afterAll(async () => {
  const ids = createdJobIds.splice(0);
  if (ids.length > 0) {
    await db.delete(outboxJobs).where(inArray(outboxJobs.id, ids));
  }
  await cleanupFixture({ userIds: [userId], teamIds: [teamId] });
  await pool.end();
});

describe("claiming", () => {
  it("claims an eligible pending job and consumes exactly one attempt", async () => {
    const job = await insertJob({ maxAttempts: 5 });

    const claimed = await claimOutboxJobs({ jobTypes: [SENTINEL_JOB_TYPE], batchSize: 10 });
    const mine = claimed.find((row) => row.id === job.id);

    expect(mine).toBeDefined();
    expect(mine?.status).toBe("PROCESSING");
    expect(mine?.attemptCount).toBe(1);

    const persisted = await findOutboxJobById(job.id);
    expect(persisted?.status).toBe("PROCESSING");
    expect(persisted?.attemptCount).toBe(1);
    expect(persisted?.processedAt).toBeNull();
  });

  it("does not claim a job scheduled in the future", async () => {
    const job = await insertJob({ nextAttemptAt: sql`now() + interval '1 hour'` });

    const claimed = await claimOutboxJobs({ jobTypes: [SENTINEL_JOB_TYPE], batchSize: 50 });

    expect(claimed.map((row) => row.id)).not.toContain(job.id);
    expect((await findOutboxJobById(job.id))?.status).toBe("PENDING");
  });

  it("does not claim a job whose attempt budget is already exhausted", async () => {
    const job = await insertJob({ attemptCount: 2, maxAttempts: 2 });

    const claimed = await claimOutboxJobs({ jobTypes: [SENTINEL_JOB_TYPE], batchSize: 50 });

    expect(claimed.map((row) => row.id)).not.toContain(job.id);
    expect((await findOutboxJobById(job.id))?.status).toBe("PENDING");
  });

  it("does not claim jobs that are already completed or failed", async () => {
    const completed = await insertJob({ status: "COMPLETED" });
    const failed = await insertJob({ status: "FAILED" });

    const claimed = await claimOutboxJobs({ jobTypes: [SENTINEL_JOB_TYPE], batchSize: 50 });
    const ids = claimed.map((row) => row.id);

    expect(ids).not.toContain(completed.id);
    expect(ids).not.toContain(failed.id);
  });

  it("respects the batch size", async () => {
    await insertJob({});
    await insertJob({});
    await insertJob({});

    const claimed = await claimOutboxJobs({ jobTypes: [SENTINEL_JOB_TYPE], batchSize: 2 });

    expect(claimed).toHaveLength(2);
  });

  it("does not claim job types it was not asked to claim", async () => {
    const job = await insertJob({
      jobType: OUTBOX_JOB_TYPES.ITEM_CREATED,
      payload: defaultPayload(),
    });

    const claimed = await claimOutboxJobs({ jobTypes: [SENTINEL_JOB_TYPE], batchSize: 50 });

    expect(claimed.map((row) => row.id)).not.toContain(job.id);
    expect((await findOutboxJobById(job.id))?.status).toBe("PENDING");
  });

  it("returns nothing when the requested job-type list is empty", async () => {
    await insertJob({});
    const claimed = await claimOutboxJobs({ jobTypes: [], batchSize: 10 });
    expect(claimed).toEqual([]);
  });
});

describe("concurrent claiming (real database)", () => {
  it("skips rows locked by another open transaction (deterministic SKIP LOCKED proof)", async () => {
    const locked = await insertJob({});
    const free = await insertJob({});

    let signalLocked: () => void = () => {};
    const lockAcquired = new Promise<void>((resolve) => {
      signalLocked = resolve;
    });
    let releaseLock: () => void = () => {};
    const holdLock = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });

    // A second "worker" takes a row-level lock and holds its transaction open.
    const holder = db.transaction(async (tx) => {
      await tx
        .select({ id: outboxJobs.id })
        .from(outboxJobs)
        .where(and(eq(outboxJobs.id, locked.id), eq(outboxJobs.status, "PENDING")))
        .for("update", { skipLocked: true });
      signalLocked();
      await holdLock;
    });

    try {
      await lockAcquired;

      // A real claim must skip the locked row and take only the free one.
      const claimed = await claimOutboxJobs({ jobTypes: [SENTINEL_JOB_TYPE], batchSize: 50 });
      const ids = claimed.map((row) => row.id);

      expect(ids).not.toContain(locked.id);
      expect(ids).toContain(free.id);
    } finally {
      releaseLock();
      await holder;
    }

    // Releasing the lock leaves the row claimable, not lost.
    const afterRelease = await claimOutboxJobs({ jobTypes: [SENTINEL_JOB_TYPE], batchSize: 50 });
    expect(afterRelease.map((row) => row.id)).toContain(locked.id);
  });

  it("never returns the same job to two concurrent claims", async () => {
    const jobs = await Promise.all([
      insertJob({}),
      insertJob({}),
      insertJob({}),
      insertJob({}),
      insertJob({}),
      insertJob({}),
    ]);
    const expected = new Set(jobs.map((job) => job.id));

    const claims = await Promise.all([
      claimOutboxJobs({ jobTypes: [SENTINEL_JOB_TYPE], batchSize: 2 }),
      claimOutboxJobs({ jobTypes: [SENTINEL_JOB_TYPE], batchSize: 2 }),
      claimOutboxJobs({ jobTypes: [SENTINEL_JOB_TYPE], batchSize: 2 }),
      claimOutboxJobs({ jobTypes: [SENTINEL_JOB_TYPE], batchSize: 2 }),
    ]);

    const claimedIds = claims.flat().map((row) => row.id);

    // The property that matters: no job is handed out twice.
    expect(new Set(claimedIds).size).toBe(claimedIds.length);
    // Every id is one of ours, and the concurrent claims cover all six jobs.
    expect(claimedIds.every((id) => expected.has(id))).toBe(true);
    expect(new Set(claimedIds)).toEqual(expected);

    const rows = await db
      .select({ status: outboxJobs.status, attemptCount: outboxJobs.attemptCount })
      .from(outboxJobs)
      .where(inArray(outboxJobs.id, [...expected]));

    expect(rows).toHaveLength(6);
    for (const row of rows) {
      expect(row.status).toBe("PROCESSING");
      // Exactly one claim -> each job consumed exactly one attempt.
      expect(row.attemptCount).toBe(1);
    }
  });
});

describe("processing outcomes", () => {
  it("marks a successfully processed job complete", async () => {
    const job = await insertJob({});

    const summary = await runOutboxOnce(
      withProcessor(testConfig(), async () => undefined),
    );

    expect(summary.claimed).toBe(1);
    expect(summary.processed).toBe(1);
    expect(summary.failed).toBe(0);
    expect(summary.retried).toBe(0);

    const persisted = await findOutboxJobById(job.id);
    expect(persisted?.status).toBe("COMPLETED");
    expect(persisted?.processedAt).not.toBeNull();
    expect(persisted?.lastError).toBeNull();
  });

  it("reschedules a transient failure with backoff and does not retry it early", async () => {
    const job = await insertJob({ maxAttempts: 5 });

    const summary = await runOutboxOnce(
      withProcessor(
        testConfig({ backoffBaseMs: 60_000, backoffMaxMs: 600_000 }),
        async () => {
          throw new TransientJobError("LOOKUP_FAILED", "the database was temporarily unavailable");
        },
      ),
    );

    expect(summary.retried).toBe(1);
    expect(summary.failed).toBe(0);

    const persisted = await findOutboxJobById(job.id);
    expect(persisted?.status).toBe("PENDING");
    expect(persisted?.attemptCount).toBe(1);
    expect(persisted?.processedAt).toBeNull();
    expect(persisted?.lastError).toContain("LOOKUP_FAILED");

    // Backoff is bounded exponential with jitter: between base/2 (30s) and max (600s).
    const delaySeconds = await secondsUntilEligible(job.id);
    expect(delaySeconds).toBeGreaterThan(25);
    expect(delaySeconds).toBeLessThanOrEqual(600);

    // And the job is genuinely not claimable straight away.
    const claimed = await claimOutboxJobs({ jobTypes: [SENTINEL_JOB_TYPE], batchSize: 50 });
    expect(claimed.map((row) => row.id)).not.toContain(job.id);
  });

  it("fails a job immediately on a permanent error, without consuming the retry budget", async () => {
    const job = await insertJob({ maxAttempts: 10 });

    const summary = await runOutboxOnce(
      withProcessor(testConfig(), async () => {
        throw new PermanentJobError("INVALID_PAYLOAD", "payload failed validation");
      }),
    );

    expect(summary.failed).toBe(1);
    expect(summary.retried).toBe(0);

    const persisted = await findOutboxJobById(job.id);
    expect(persisted?.status).toBe("FAILED");
    expect(persisted?.processedAt).not.toBeNull();
    expect(persisted?.lastError).toContain("INVALID_PAYLOAD");
    // Only one attempt was made even though ten were available.
    expect(persisted?.attemptCount).toBe(1);
  });

  it("enforces the maximum attempt count for repeated transient failures", async () => {
    const job = await insertJob({ maxAttempts: 2 });
    const transient = async () => {
      throw new TransientJobError("LOOKUP_FAILED", "still failing transiently");
    };

    const first = await runOutboxOnce(
      withProcessor(testConfig({ backoffBaseMs: 1, backoffMaxMs: 2 }), transient),
    );
    expect(first.retried).toBe(1);
    expect((await findOutboxJobById(job.id))?.status).toBe("PENDING");

    const second = await runOutboxOnce(
      withProcessor(testConfig({ backoffBaseMs: 1, backoffMaxMs: 2 }), transient),
    );
    expect(second.failed).toBe(1);
    expect(second.retried).toBe(0);

    const persisted = await findOutboxJobById(job.id);
    expect(persisted?.status).toBe("FAILED");
    expect(persisted?.attemptCount).toBe(2);

    // Exhausted jobs are never claimed again.
    const claimed = await claimOutboxJobs({ jobTypes: [SENTINEL_JOB_TYPE], batchSize: 50 });
    expect(claimed.map((row) => row.id)).not.toContain(job.id);
  });

  it("handles an invalid payload safely and stores no payload contents", async () => {
    const marker = "S3CR3T-PAYLOAD-MARKER";
    const job = await insertJob({
      payload: { workItemId: randomUUID(), teamId, actorId: userId, status: "OPEN", version: 1, secret: marker },
      maxAttempts: 1,
    });

    const summary = await runOutboxOnce(
      withProcessor(testConfig(), async () => {
        throw new PermanentJobError("INVALID_PAYLOAD", "payload failed validation (secret: unexpected key)");
      }),
    );

    expect(summary.failed).toBe(1);

    const persisted = await findOutboxJobById(job.id);
    expect(persisted?.status).toBe("FAILED");
    // The failure is recorded, but never the payload itself.
    expect(persisted?.lastError).toContain("INVALID_PAYLOAD");
    expect(persisted?.lastError ?? "").not.toContain(marker);
  });
});

describe("lease recovery", () => {
  it("returns an abandoned claim to PENDING once its lease expires", async () => {
    const stale = await insertJob({
      status: "PROCESSING",
      attemptCount: 1,
      maxAttempts: 5,
      updatedAt: sql`now() - interval '10 minutes'`,
    });
    const fresh = await insertJob({
      status: "PROCESSING",
      attemptCount: 1,
      maxAttempts: 5,
      updatedAt: sql`now()`,
    });

    const result = await reclaimExpiredLeases(60_000);

    expect(result.reclaimed).toBeGreaterThanOrEqual(1);
    expect((await findOutboxJobById(stale.id))?.status).toBe("PENDING");
    // A live lease is left alone.
    expect((await findOutboxJobById(fresh.id))?.status).toBe("PROCESSING");

    // The recovered job is claimable again.
    const claimed = await claimOutboxJobs({ jobTypes: [SENTINEL_JOB_TYPE], batchSize: 50 });
    expect(claimed.map((row) => row.id)).toContain(stale.id);
  });

  it("terminates an abandoned claim whose attempts are exhausted", async () => {
    const job = await insertJob({
      status: "PROCESSING",
      attemptCount: 2,
      maxAttempts: 2,
      updatedAt: sql`now() - interval '10 minutes'`,
    });

    const result = await reclaimExpiredLeases(60_000);

    expect(result.exhausted).toBeGreaterThanOrEqual(1);

    const persisted = await findOutboxJobById(job.id);
    expect(persisted?.status).toBe("FAILED");
    expect(persisted?.processedAt).not.toBeNull();
    expect(persisted?.lastError).toContain("Lease expired");
  });
});

describe("at-least-once delivery and idempotency", () => {
  it("delivers a completed job once, even when the worker runs again", async () => {
    const job = await insertJob({});
    const effects: string[] = [];
    const config = withProcessor(testConfig(), async (claimed) => {
      effects.push(claimed.id);
    });

    const first = await runOutboxOnce(config);
    expect(first.processed).toBe(1);
    expect(effects).toEqual([job.id]);

    const second = await runOutboxOnce(config);
    expect(second.claimed).toBe(0);
    // No duplicate downstream effect on the second pass.
    expect(effects).toEqual([job.id]);
    expect((await findOutboxJobById(job.id))?.status).toBe("COMPLETED");
  });

  it("the real handler is idempotent when the same event is delivered twice", async () => {
    const job = await insertJob({
      jobType: OUTBOX_JOB_TYPES.ITEM_TRANSITIONED,
      payload: defaultPayload(),
    });
    const row = await findOutboxJobById(job.id);
    expect(row).not.toBeNull();

    const first = await processOutboxJob(row as OutboxJobRow);
    const second = await processOutboxJob(row as OutboxJobRow);

    expect(second).toEqual(first);
  });
});

describe("the real work-item handler", () => {
  it("validates and acknowledges every supported producer event type", async () => {
    for (const jobType of Object.values(OUTBOX_JOB_TYPES)) {
      const job = await insertJob({ jobType, payload: defaultPayload() });
      const row = await findOutboxJobById(job.id);

      const acknowledgement = await processOutboxJob(row as OutboxJobRow);

      expect(acknowledgement).toEqual({ jobId: job.id, jobType, workItemId });
      expect(SUPPORTED_JOB_TYPES).toContain(jobType);
    }
  });

  it("rejects a payload that does not match the event contract", async () => {
    const marker = "S3CR3T-NOT-A-UUID";
    const job = await insertJob({
      jobType: OUTBOX_JOB_TYPES.ITEM_CREATED,
      payload: { workItemId: marker },
    });
    const row = await findOutboxJobById(job.id);

    await expect(processOutboxJob(row as OutboxJobRow)).rejects.toBeInstanceOf(PermanentJobError);
    await processOutboxJob(row as OutboxJobRow).catch((error: unknown) => {
      expect(error).toBeInstanceOf(PermanentJobError);
      expect((error as PermanentJobError).category).toBe("INVALID_PAYLOAD");
      // The offending value is never echoed back.
      expect((error as Error).message).not.toContain(marker);
    });
  });

  it("rejects an event whose work item no longer exists", async () => {
    const job = await insertJob({
      jobType: OUTBOX_JOB_TYPES.ITEM_CREATED,
      payload: { ...defaultPayload(), workItemId: randomUUID() },
    });
    const row = await findOutboxJobById(job.id);

    await expect(processOutboxJob(row as OutboxJobRow)).rejects.toMatchObject({
      name: "PermanentJobError",
      category: "DANGLING_REFERENCE",
    });
  });

  it("rejects an event whose team does not match the work item", async () => {
    const job = await insertJob({
      jobType: OUTBOX_JOB_TYPES.ITEM_UPDATED,
      payload: { ...defaultPayload(), teamId: randomUUID() },
    });
    const row = await findOutboxJobById(job.id);

    await expect(processOutboxJob(row as OutboxJobRow)).rejects.toMatchObject({
      name: "PermanentJobError",
      category: "TEAM_MISMATCH",
    });
  });

  it("rejects a job type it does not support", async () => {
    const job = await insertJob({
      jobType: "work_item.deleted",
      payload: defaultPayload(),
    });
    const row = await findOutboxJobById(job.id);

    await expect(processOutboxJob(row as OutboxJobRow)).rejects.toMatchObject({
      name: "PermanentJobError",
      category: "UNSUPPORTED_JOB_TYPE",
    });
  });

  it("is the processor wired in by the production configuration", () => {
    expect(resolveWorkerConfig().processJob).toBe(processOutboxJob);
  });
});

describe("worker loop", () => {
  it("exits cleanly when stopped while idle", async () => {
    const loop = startOutboxLoop(testConfig({ pollIntervalMs: 5 }));
    await loop.stop();
    await loop.stop(); // idempotent
  });

  it("stops claiming during shutdown and lets the in-flight job finish", async () => {
    const jobs = await Promise.all([insertJob({}), insertJob({}), insertJob({})]);

    let handlerStarted = false;
    let releaseHandler: () => void = () => {};
    const holdHandler = new Promise<void>((resolve) => {
      releaseHandler = resolve;
    });
    const processed: string[] = [];

    const config = withProcessor(
      testConfig({ batchSize: 1, pollIntervalMs: 10 }),
      async (job) => {
        handlerStarted = true;
        processed.push(job.id);
        await holdHandler;
      },
    );

    const loop = startOutboxLoop(config);
    await waitFor(() => handlerStarted);
    expect(processed).toHaveLength(1);

    // Request shutdown while the handler is still holding the job.
    const stopping = loop.stop();

    // Nothing new may be claimed while shutdown is in progress.
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(processed).toHaveLength(1);

    releaseHandler();
    await stopping;

    // The in-flight job was allowed to complete ...
    const finished = await findOutboxJobById(processed[0] as string);
    expect(finished?.status).toBe("COMPLETED");

    // ... and the jobs it had not claimed were left untouched.
    const pending = await db
      .select({ id: outboxJobs.id })
      .from(outboxJobs)
      .where(
        and(
          inArray(
            outboxJobs.id,
            jobs.map((job) => job.id),
          ),
          eq(outboxJobs.status, "PENDING"),
        ),
      );
    expect(pending).toHaveLength(2);

    // After shutdown settles, still no further claims.
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(processed).toHaveLength(1);
  });
});

describe("observability", () => {
  it("logs a structured batch summary with success, retry, and failure counts", async () => {
    const succeed = await insertJob({});
    const retry = await insertJob({ maxAttempts: 5 });
    const dead = await insertJob({ maxAttempts: 1 });

    const records: WorkerLogRecord[] = [];
    const config = withProcessor(
      testConfig({ batchSize: 10, pollIntervalMs: 5, log: (record) => records.push(record) }),
      async (job) => {
        if (job.id === retry.id) {
          throw new TransientJobError("LOOKUP_FAILED", "temporary");
        }
        if (job.id === dead.id) {
          throw new PermanentJobError("INVALID_PAYLOAD", "malformed");
        }
        expect(job.id).toBe(succeed.id);
      },
    );

    const loop = startOutboxLoop(config);
    await waitFor(() => records.some((record) => record.event === "worker.batch"));
    await loop.stop();

    const batch = records.find((record) => record.event === "worker.batch");
    expect(batch).toBeDefined();
    expect(Number(batch?.processed)).toBe(1);
    expect(Number(batch?.retried)).toBe(1);
    expect(Number(batch?.failed)).toBe(1);

    expect(records.some((record) => record.event === "worker.started")).toBe(true);
    expect(records.some((record) => record.event === "worker.stopped")).toBe(true);
  });

  it("never logs payload contents or credentials, and never persists them", async () => {
    const payloadMarker = "S3CR3T-PAYLOAD-MARKER";
    const job = await insertJob({
      payload: { ...defaultPayload(), secretMarker: payloadMarker },
      maxAttempts: 1,
    });

    const records: WorkerLogRecord[] = [];
    const summary = await runOutboxOnce(
      withProcessor(
        testConfig({ log: (record) => records.push(record) }),
        async () => {
          throw new TransientJobError(
            "LOOKUP_FAILED",
            "connect failed: postgresql://neondb_owner:hunter2@ep-x.neon.tech/neondb",
          );
        },
      ),
    );

    expect(summary.failed).toBe(1); // maxAttempts = 1 -> terminal

    const logged = JSON.stringify(records);
    expect(logged).not.toContain(payloadMarker);
    expect(logged).not.toContain("hunter2");
    expect(logged).not.toContain("neondb_owner");
    expect(logged).toContain("LOOKUP_FAILED");

    const persisted = await findOutboxJobById(job.id);
    expect(persisted?.lastError).toContain("LOOKUP_FAILED");
    expect(persisted?.lastError ?? "").not.toContain(payloadMarker);
    expect(persisted?.lastError ?? "").not.toContain("hunter2");
  });
});

describe("worker configuration", () => {
  it("resolves production defaults from the environment", () => {
    const config = resolveWorkerConfig();

    expect(config.processJob).toBe(processOutboxJob);
    expect([...config.jobTypes]).toEqual([...SUPPORTED_JOB_TYPES]);
    expect(config.batchSize).toBeGreaterThan(0);
    expect(config.pollIntervalMs).toBeGreaterThan(0);
    expect(config.leaseTimeoutMs).toBeGreaterThan(0);
    expect(config.backoffBaseMs).toBeGreaterThan(0);
    expect(config.backoffMaxMs).toBeGreaterThanOrEqual(config.backoffBaseMs);
  });

  it("honours explicit overrides", () => {
    const config = resolveWorkerConfig({
      batchSize: 3,
      pollIntervalMs: 7,
      leaseTimeoutMs: 1234,
    });

    expect(config.batchSize).toBe(3);
    expect(config.pollIntervalMs).toBe(7);
    expect(config.leaseTimeoutMs).toBe(1234);
  });
});
