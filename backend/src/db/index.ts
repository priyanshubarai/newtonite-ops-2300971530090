import { neonConfig, Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import ws from "ws";
import { env } from "../config/env.js";

// The Neon serverless driver uses WebSockets. In a Node.js runtime we must
// supply a WebSocket constructor (Node has no global WebSocket before v22,
// and the driver requires it for the transaction-capable pool).
neonConfig.webSocketConstructor = ws;

const pool = new Pool({
  connectionString: env.DATABASE_URL,
});

// neon-serverless (WebSocket pool) is used at runtime because the later
// work-item, idempotency, and activity-history modules require interactive
// transactions. The neon-http driver does not support them.
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
