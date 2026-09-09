import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestEnv } from '../helpers/env';

const env = setupTestEnv('queue');

let jobs: typeof import('@/lib/queue/jobs');
let closeDatabase: () => void;

beforeAll(async () => {
  jobs = await import('@/lib/queue/jobs');
  ({ closeDatabase } = await import('@/lib/db'));
});

afterAll(() => {
  closeDatabase();
  env.cleanup();
});

describe('durable job queue', () => {
  it('deduplicates jobs by key while one is outstanding', () => {
    expect(
      jobs.enqueueJob({ jobType: 'sync_comment', entityId: 't1', dedupeKey: 'k1' }),
    ).not.toBeNull();
    expect(
      jobs.enqueueJob({ jobType: 'sync_comment', entityId: 't1', dedupeKey: 'k1' }),
    ).toBeNull();
  });

  it('allows the same key again once the job completes', () => {
    const claimed = jobs.claimNextJob('worker-a');
    expect(claimed?.dedupe_key).toBe('k1');
    jobs.completeJob(claimed!.id);
    expect(
      jobs.enqueueJob({ jobType: 'sync_comment', entityId: 't1', dedupeKey: 'k1' }),
    ).not.toBeNull();
    jobs.completeJob(jobs.claimNextJob('worker-a')!.id);
  });

  it('claims a job exactly once while its lease is valid', () => {
    jobs.enqueueJob({ jobType: 'dispatch_task', entityId: 't2' });
    const first = jobs.claimNextJob('worker-a');
    expect(first).not.toBeNull();
    expect(jobs.claimNextJob('worker-b')).toBeNull();
    jobs.completeJob(first!.id);
  });

  it('recovers work whose lease expired with the previous process', () => {
    jobs.enqueueJob({ jobType: 'dispatch_task', entityId: 't3' });
    const claimed = jobs.claimNextJob('worker-crashed');
    expect(claimed).not.toBeNull();

    expect(jobs.releaseExpiredLeases()).toBe(0);
    const afterLease = Date.now() + jobs.LEASE_DURATION_MS + 1;
    expect(jobs.releaseExpiredLeases(afterLease)).toBe(1);

    const reclaimed = jobs.claimNextJob('worker-b');
    expect(reclaimed?.id).toBe(claimed!.id);
    expect(reclaimed?.attempts).toBe(2);
    jobs.completeJob(reclaimed!.id);
  });

  it('retries with backoff and then exhausts', () => {
    jobs.enqueueJob({ jobType: 'dispatch_task', entityId: 't4', maxAttempts: 2 });
    const first = jobs.claimNextJob('worker-a')!;
    const retry = jobs.failJob(first, new Error('boom'));
    expect(retry.exhausted).toBe(false);
    expect(retry.nextAttemptAt).toBeGreaterThan(Date.now());

    const second = jobs.claimNextJob('worker-a', (retry.nextAttemptAt ?? 0) + 1)!;
    expect(second.attempts).toBe(2);
    const exhausted = jobs.failJob(second, new Error('boom again'));
    expect(exhausted.exhausted).toBe(true);
    expect(jobs.getJob(second.id)?.state).toBe('failed');
  });

  it('refunds the attempt when work is deferred by backpressure', () => {
    jobs.enqueueJob({ jobType: 'dispatch_task', entityId: 't5', maxAttempts: 2 });
    const claimed = jobs.claimNextJob('worker-a')!;
    expect(claimed.attempts).toBe(1);
    jobs.deferJob(claimed, 1_000, 'paused');

    const deferred = jobs.getJob(claimed.id)!;
    expect(deferred.state).toBe('pending');
    expect(deferred.attempts).toBe(0);
    expect(deferred.available_at).toBeGreaterThan(Date.now());
  });

  it('does not redact-leak secrets into stored error summaries', () => {
    jobs.enqueueJob({ jobType: 'sync_comment', entityId: 't6', maxAttempts: 1 });
    const claimed = jobs.claimNextJob('worker-a')!;
    jobs.failJob(claimed, new Error('bad token cog_abcdefgh12345678'));
    expect(jobs.getJob(claimed.id)?.error_summary).toContain('cog_[REDACTED]');
  });
});
