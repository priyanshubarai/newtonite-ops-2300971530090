import { pgTable, text, timestamp, uuid, jsonb, integer, index, uniqueIndex } from "drizzle-orm/pg-core";
import { idempotencyStateEnum } from "./enums.js";
import { users } from "./users.js";

export const idempotencyRecords = pgTable(
  "idempotency_records",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "restrict" }),
    scope: text("scope").notNull(),
    key: text("key").notNull(),
    requestHash: text("request_hash").notNull(),
    state: idempotencyStateEnum("state").notNull().default("IN_PROGRESS"),
    statusCode: integer("status_code"),
    responseBody: jsonb("response_body"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdateFn(() => new Date()),
  },
  (table) => ({
    // Unique idempotency scope and key.
    scopeKeyUnique: uniqueIndex("ir_scope_key_unique").on(table.scope, table.key),
    scopeIdx: index("ir_scope_idx").on(table.scope),
    keyIdx: index("ir_key_idx").on(table.key),
    expiresAtIdx: index("ir_expires_at_idx").on(table.expiresAt),
    createdAtIdx: index("ir_created_at_idx").on(table.createdAt),
  }),
);
