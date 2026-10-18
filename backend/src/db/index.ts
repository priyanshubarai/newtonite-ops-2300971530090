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
export { pool };
