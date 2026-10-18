import { pgTable, text, timestamp, uuid, jsonb, integer, index } from "drizzle-orm/pg-core";
import { outboxStatusEnum } from "./enums";

export const outboxJobs = pgTable(
  "outbox_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    jobType: text("job_type").notNull(),
    payload: jsonb("payload").notNull(),
    status: outboxStatusEnum("status").notNull().default("PENDING"),
    attemptCount: integer("attempt_count").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(10),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdateFn(() => new Date()),
  },
  (table) => ({
    // Pending jobs by status and next eligible processing time.
    statusNextAttemptIdx: index("oj_status_next_attempt_idx").on(table.status, table.nextAttemptAt),
    statusIdx: index("oj_status_idx").on(table.status),
    nextAttemptAtIdx: index("oj_next_attempt_at_idx").on(table.nextAttemptAt),
    jobTypeIdx: index("oj_job_type_idx").on(table.jobType),
  }),
);
