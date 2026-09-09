export const BASE_BACKOFF_MS = 5_000;
export const MAX_BACKOFF_MS = 5 * 60_000;

/**
 * Capped exponential backoff with full jitter. `random` is injectable so tests can
 * assert the bounds deterministically.
 */
export function backoffMs(
  attempt: number,
  options: { baseMs?: number; maxMs?: number; random?: () => number } = {},
): number {
  const base = options.baseMs ?? BASE_BACKOFF_MS;
  const max = options.maxMs ?? MAX_BACKOFF_MS;
  const random = options.random ?? Math.random;
  const safeAttempt = Math.max(1, Math.floor(attempt));
  const exponential = Math.min(max, base * 2 ** (safeAttempt - 1));
  // Full jitter, but never less than a quarter of the exponential delay so retries
  // cannot collapse into a hot loop.
  const jittered = exponential * (0.25 + 0.75 * random());
  return Math.min(max, Math.round(jittered));
}
