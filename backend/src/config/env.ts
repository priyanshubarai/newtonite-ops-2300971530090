import * as dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(3000),
  DATABASE_URL: z
    .string({ required_error: "DATABASE_URL is required" })
    .min(1, "DATABASE_URL must not be empty - set it to your Neon connection string")
    .refine((v) => v.startsWith("postgresql://") || v.startsWith("postgres://"), {
      message: "DATABASE_URL must be a PostgreSQL connection string (postgresql://...)",
    }),
  // Secret used to sign short-lived auth tokens. Must come from the environment;
  // never hardcode it or commit a real value. Minimum length guards weak secrets.
  JWT_SECRET: z
    .string({ required_error: "JWT_SECRET is required" })
    .min(32, "JWT_SECRET must be at least 32 characters"),
  // Auth token lifetime in seconds (default 15 minutes). Kept short because
  // memberships/roles are loaded from the database on every request.
  JWT_EXPIRES_IN: z.coerce.number().int().positive().default(900),
  // CORS configuration. In production, CORS_ORIGIN must be explicitly set to the
  // deployed frontend origin (e.g. "https://app.example.com"). Multiple origins
  // can be provided as a comma-separated list. In development, defaults to
  // "http://localhost:5173" to match the Vite dev server. The value is parsed
  // and normalized at startup; malformed or missing production configuration
  // will fail fast with a clear error.
  CORS_ORIGIN: z.string().optional(),
  // Outbox worker tuning (Phase 8). All optional - the worker always runs with
  // sensible defaults, so running it requires no extra configuration. The
  // worker reads these through `resolveWorkerConfig`; the HTTP API ignores them.
  OUTBOX_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(2000),
  OUTBOX_BATCH_SIZE: z.coerce.number().int().positive().max(100).default(10),
  OUTBOX_BACKOFF_BASE_MS: z.coerce.number().int().positive().default(5000),
  OUTBOX_BACKOFF_MAX_MS: z.coerce.number().int().positive().default(300000),
  OUTBOX_LEASE_TIMEOUT_MS: z.coerce.number().int().positive().default(60000),
  // Demo seed password (development only). The seed script defaults to
  // "newtonite-demo" if unset; this variable is not used by the API or worker.
  DEMO_PASSWORD: z.string().optional(),
});

// Never echo the connection string in errors; only report the missing/invalid field.
export const env = envSchema.parse(process.env);

// Parse and normalize CORS origins
export function getCorsOrigins(): string[] {
  const raw = env.CORS_ORIGIN?.trim();
  if (!raw) {
    // Development default - Vite dev server
    return ["http://localhost:5173"];
  }

  return raw
    .split(",")
    .map((o) => o.trim())
    .filter((o) => o.length > 0)
    .map((o) => {
      // Normalize: remove trailing slashes, ensure protocol
      try {
        const url = new URL(o);
        // Remove trailing slash from origin
        return `${url.protocol}//${url.host}`;
      } catch {
        // If it's not a valid URL, return as-is (will be validated by cors)
        return o.replace(/\/+$/, "");
      }
    });
}

// Validate CORS configuration for production
export function validateCorsConfig(): void {
  if (env.NODE_ENV === "production") {
    const raw = env.CORS_ORIGIN?.trim();
    if (!raw) {
      throw new Error(
        "CORS_ORIGIN is required in production. Set it to your deployed frontend origin (e.g. https://app.example.com)."
      );
    }
    const origins = getCorsOrigins();
    if (origins.length === 0) {
      throw new Error("CORS_ORIGIN is set but no valid origins were parsed.");
    }
  }
}