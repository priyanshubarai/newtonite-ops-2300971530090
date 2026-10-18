import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

// Drizzle Kit migrations run in a separate process from the app, so load the
// env file explicitly here rather than relying on the application bootstrap.
config();

const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error(
    "DATABASE_URL is not set. Add it to backend/.env with your Neon connection string before running migrations.",
  );
}

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./src/db/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url,
  },
});
