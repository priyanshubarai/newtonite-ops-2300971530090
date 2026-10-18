import { describe, expect, it } from "vitest";
import { computeBackoffMs } from "./backoff.js";

/**
 * Pure unit tests for the retry backoff (no database involved).
 *
 * "Equal jitter" means the delay for attempt `n` is uniformly distributed in
 * `[ceiling / 2, ceiling]` where `ceiling = min(base * 2^(n-1), max)`. Injecting
 * a deterministic `random` pins both ends of that window.
 */

describe("computeBackoffMs", () => {
  it("uses half the ceiling when random() is 0", () => {
    expect(computeBackoffMs(1, 1000, 60_000, () => 0)).toBe(500);
    expect(computeBackoffMs(2, 1000, 60_000, () => 0)).toBe(1000);
    expect(computeBackoffMs(3, 1000, 60_000, () => 0)).toBe(2000);
  });

  it("uses the full ceiling when random() is 1", () => {
    expect(computeBackoffMs(1, 1000, 60_000, () => 1)).toBe(1000);
    expect(computeBackoffMs(2, 1000, 60_000, () => 1)).toBe(2000);
    expect(computeBackoffMs(3, 1000, 60_000, () => 1)).toBe(4000);
  });

  it("doubles with each attempt until the ceiling is reached", () => {
    const base = 500;
    const max = 60_000;
    let previous = 0;
    for (let attempt = 1; attempt <= 8; attempt += 1) {
      const delay = computeBackoffMs(attempt, base, max, () => 1);
      expect(delay).toBe(Math.min(base * 2 ** (attempt - 1), max));
      expect(delay).toBeGreaterThanOrEqual(previous);
      previous = delay;
    }
  });

  it("caps the delay at the configured maximum", () => {
    expect(computeBackoffMs(10, 1000, 60_000, () => 1)).toBe(60_000);
    expect(computeBackoffMs(50, 1000, 60_000, () => 1)).toBe(60_000);
  });

  it("never rounds past a ceiling smaller than the base", () => {
    expect(computeBackoffMs(1, 1000, 100, () => 1)).toBe(100);
  });

  it("keeps every delay inside [ceiling/2, ceiling] for any random value", () => {
    for (const random of [0, 0.25, 0.5, 0.75, 1]) {
      for (const attempt of [1, 2, 3, 4, 5, 6, 7, 8]) {
        const ceiling = Math.min(1000 * 2 ** (attempt - 1), 60_000);
        const delay = computeBackoffMs(attempt, 1000, 60_000, () => random);
        expect(delay).toBeGreaterThanOrEqual(Math.round(ceiling / 2));
        expect(delay).toBeLessThanOrEqual(ceiling);
      }
    }
  });

  it("never returns a delay small enough to create a tight retry loop", () => {
    // The floor is base/2, so a failing job always waits before being eligible
    // again - "full jitter" ([0, ceiling]) would allow near-zero delays.
    for (const random of [0, 0.01, 0.5, 0.99, 1]) {
      expect(computeBackoffMs(1, 4000, 60_000, () => random)).toBeGreaterThanOrEqual(2000);
    }
  });

  it("treats nonsensical attempt counts and bounds defensively", () => {
    // Zero, negative, and non-finite attempt counts all collapse to attempt 1,
    // so a bad row can never produce NaN or a negative delay.
    expect(computeBackoffMs(0, 1000, 60_000, () => 1)).toBe(1000);
    expect(computeBackoffMs(-5, 1000, 60_000, () => 1)).toBe(1000);
    expect(computeBackoffMs(Number.NaN, 1000, 60_000, () => 1)).toBe(1000);
    expect(computeBackoffMs(Number.POSITIVE_INFINITY, 1000, 5_000, () => 1)).toBe(1000);
    // A missing or invalid base falls back to 1ms rather than NaN/0.
    expect(computeBackoffMs(1, 0, 60_000, () => 1)).toBe(1);
    expect(computeBackoffMs(1, Number.NaN, 60_000, () => 1)).toBe(1);
  });
});
