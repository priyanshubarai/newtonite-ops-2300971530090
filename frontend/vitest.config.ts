import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    restoreMocks: true,
    unstubGlobals: true,
    // Each test mounts the whole routed app in jsdom, which costs roughly
    // 300-400 ms of render time before any assertion runs. Vitest's default
    // 5 s per-test budget is occasionally crossed by a single slow render when
    // the machine is busy (for example while a backend build or the database
    // integration suite is running alongside it), which fails a test that
    // actually passes. 15 s keeps a genuine hang visible - it still fails, it
    // just no longer fails on render latency alone. No assertion is relaxed.
    testTimeout: 15_000,
    pool: "threads",
    poolOptions: {
      threads: {
        singleThread: true,
      },
    },
  },
});
