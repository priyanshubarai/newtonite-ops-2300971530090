/**
 * Bounded exponential backoff with jitter.
 *
 * The delay for attempt `n` is `min(base * 2^(n-1), max)`, then "equal jitter"
 * halves it: the final delay is uniformly distributed in `[delay/2, delay]`.
 *
 * Two properties matter for reliability:
 * - The delay is always at least `base / 2`, so a failing job can never be
 *   retried in a tight loop (which is what "full jitter" - `[0, delay]` - would
 *   allow on the early attempts).
 * - The delay is capped at `max`, so backoff cannot grow without bound.
 *
 * `random` is injectable so the bounds can be tested deterministically.
 */
export function computeBackoffMs(
  attemptCount: number,
  baseMs: number,
  maxMs: number,
  random: () => number = Math.random,
): number {
  const attempt = Number.isFinite(attemptCount) ? Math.max(1, Math.floor(attemptCount)) : 1;
  const base = Number.isFinite(baseMs) && baseMs > 0 ? baseMs : 1;
  const cap = Number.isFinite(maxMs) && maxMs > 0 ? maxMs : base;

  // `2 ** (attempt - 1)` can overflow to Infinity for a very large attempt
  // count; Math.min collapses that to the cap, which is the intended behaviour.
  const ceiling = Math.min(base * 2 ** (attempt - 1), cap);
  const half = ceiling / 2;

  return Math.round(half + random() * half);
}
