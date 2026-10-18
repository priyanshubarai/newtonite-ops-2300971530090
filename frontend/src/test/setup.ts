import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { clearToken } from "../auth/tokenStore";

/**
 * Global test setup: jest-dom matchers, DOM cleanup between tests, and a reset
 * of the in-memory session so one test's token can never leak into the next.
 */
afterEach(() => {
  cleanup();
  clearToken();
});
