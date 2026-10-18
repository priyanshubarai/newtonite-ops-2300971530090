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
});

// Never echo the connection string in errors; only report the missing/invalid field.
export const env = envSchema.parse(process.env);
