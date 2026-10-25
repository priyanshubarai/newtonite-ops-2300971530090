import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { env } from "../config/env.js";

// Use standard pg Pool (works with both local PostgreSQL and Neon pooled connections).
// The standard pg driver supports interactive transactions required by the
// work-item, idempotency, and activity-history modules.
const pool = new Pool({
  connectionString: env.DATABASE_URL,
});

export const db = drizzle(pool);

/**
 * The transaction handle passed to `db.transaction(async (tx) => ...)`.
 *
 * Mutation code takes a `TxClient` so that a work-item change, its version
 * increment, its activity event, its outbox job, and any idempotency record
 * can all be written on the **same** connection and commit atomically.
 */
export type Database = typeof db;
export type TxClient = Parameters<Parameters<Database["transaction"]>[0]>[0];

export { pool };