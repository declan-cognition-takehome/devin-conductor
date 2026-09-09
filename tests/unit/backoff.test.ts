import { describe, expect, it } from 'vitest';
import { BASE_BACKOFF_MS, MAX_BACKOFF_MS, backoffMs } from '@/lib/queue/backoff';

describe('backoffMs', () => {
  it('grows exponentially between attempts', () => {
    const deterministic = { random: () => 1 };
    expect(backoffMs(1, deterministic)).toBe(BASE_BACKOFF_MS);
    expect(backoffMs(2, deterministic)).toBe(BASE_BACKOFF_MS * 2);
    expect(backoffMs(3, deterministic)).toBe(BASE_BACKOFF_MS * 4);
  });

  it('is capped', () => {
    expect(backoffMs(50, { random: () => 1 })).toBe(MAX_BACKOFF_MS);
  });

  it('never collapses to a hot loop even with minimal jitter', () => {
    expect(backoffMs(1, { random: () => 0 })).toBe(BASE_BACKOFF_MS * 0.25);
  });

  it('stays within bounds for random jitter', () => {
    for (let attempt = 1; attempt <= 10; attempt += 1) {
      const value = backoffMs(attempt);
      expect(value).toBeGreaterThan(0);
      expect(value).toBeLessThanOrEqual(MAX_BACKOFF_MS);
    }
  });
});
