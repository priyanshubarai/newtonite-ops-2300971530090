import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    // Integration suites talk to a remote Neon database over WebSockets, where
    // individual round-trips are high-latency and several suites run in
    // parallel. The defaults (5s/10s) are too tight for fixture setup and for
    // the genuine-concurrency tests; keep explicit headroom.
    testTimeout: 30000,
    hookTimeout: 60000,
    env: {
      LOGIN_RATE_LIMIT_POINTS: '1000',
      LOGIN_RATE_LIMIT_DURATION: '60',
      LOGIN_RATE_LIMIT_BLOCK_DURATION: '0',
      API_RATE_LIMIT_POINTS: '10000',
      API_RATE_LIMIT_DURATION: '60',
    },
  },
});
