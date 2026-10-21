import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { clearToken } from "../auth/tokenStore";

/**
 * Global test setup: jest-dom matchers, DOM cleanup between tests, and a reset
 * of both the in-memory and persisted session so one test's token can never leak
 * into the next. `tokenStore` hydrates from localStorage at module load, so
 * clearing only the in-memory value is no longer sufficient.
 */
afterEach(() => {
  cleanup();
  clearToken();
  localStorage.clear();
});
