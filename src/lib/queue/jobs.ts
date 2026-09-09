import { randomUUID } from 'node:crypto';
import { db } from '../db';
import type { JobRow, JobType } from '../db/types';
import { backoffMs } from './backoff';
import { safeErrorSummary } from '../redact';

export const LEASE_DURATION_MS = 2 * 60_000;

export interface EnqueueInput {
  jobType: JobType;
  entityId: string;
  /** When set, a pending/claimed job with the same key is not duplicated. */
  dedupeKey?: string;
  availableAt?: number;
  maxAttempts?: number;
}

export function enqueueJob(input: EnqueueInput): string | null {
  const ts = Date.now();
  const id = randomUUID();
  const result = db()
    .prepare(
      `INSERT OR IGNORE INTO jobs (id, job_type, entity_id, dedupe_key, state, attempts,
         max_attempts, available_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'pending', 0, ?, ?, ?, ?)`,
    )
    .run(
      id,
      input.jobType,
      input.entityId,
      input.dedupeKey ?? null,
      input.maxAttempts ?? 5,
      input.availableAt ?? ts,
      ts,
      ts,
    );
  return result.changes > 0 ? id : null;
}

/**
 * Atomically claims the next available job and takes a lease on it. Claiming and lease
 * assignment happen in one transaction so a crashed worker cannot strand work: the lease
 * expires and the job becomes claimable again.
 */
export function claimNextJob(owner: string, now = Date.now()): JobRow | null {
  const claim = db().transaction((): JobRow | null => {
    const candidate = db()
      .prepare<[number, number], JobRow>(
        `SELECT * FROM jobs
         WHERE (state = 'pending' AND available_at <= ?)
            OR (state = 'claimed' AND lease_expires_at IS NOT NULL AND lease_expires_at <= ?)
         ORDER BY available_at ASC
         LIMIT 1`,
      )
      .get(now, now);
    if (!candidate) return null;
    db()
      .prepare(
        `UPDATE jobs SET state = 'claimed', lease_owner = ?, lease_expires_at = ?,
           attempts = attempts + 1, updated_at = ? WHERE id = ?`,
      )
      .run(owner, now + LEASE_DURATION_MS, now, candidate.id);
    return (
      db().prepare<[string], JobRow>('SELECT * FROM jobs WHERE id = ?').get(candidate.id) ?? null
    );
  });
  return claim();
}

export function extendLease(jobId: string, owner: string, now = Date.now()): void {
  db()
    .prepare(
      `UPDATE jobs SET lease_expires_at = ?, updated_at = ? WHERE id = ? AND lease_owner = ?`,
    )
    .run(now + LEASE_DURATION_MS, now, jobId, owner);
}

export function completeJob(jobId: string): void {
  db()
    .prepare(
      `UPDATE jobs SET state = 'done', lease_owner = NULL, lease_expires_at = NULL,
         dedupe_key = NULL, error_summary = NULL, updated_at = ? WHERE id = ?`,
    )
    .run(Date.now(), jobId);
}

export interface RetryOutcome {
  exhausted: boolean;
  nextAttemptAt: number | null;
}

/** Reschedules a failed job with bounded backoff, or marks it failed when exhausted. */
export function failJob(job: JobRow, error: unknown, now = Date.now()): RetryOutcome {
  const summary = safeErrorSummary(error);
  if (job.attempts >= job.max_attempts) {
    db()
      .prepare(
        `UPDATE jobs SET state = 'failed', lease_owner = NULL, lease_expires_at = NULL,
           dedupe_key = NULL, error_summary = ?, updated_at = ? WHERE id = ?`,
      )
      .run(summary, now, job.id);
    return { exhausted: true, nextAttemptAt: null };
  }
  const nextAttemptAt = now + backoffMs(job.attempts);
  db()
    .prepare(
      `UPDATE jobs SET state = 'pending', lease_owner = NULL, lease_expires_at = NULL,
         available_at = ?, error_summary = ?, updated_at = ? WHERE id = ?`,
    )
    .run(nextAttemptAt, summary, now, job.id);
  return { exhausted: false, nextAttemptAt };
}

/**
 * Reschedules a job that could not run because of backpressure (paused automation,
 * concurrency ceiling). The attempt is refunded so backpressure never exhausts retries.
 */
export function deferJob(job: JobRow, delayMs: number, reason: string, now = Date.now()): void {
  db()
    .prepare(
      `UPDATE jobs SET state = 'pending', lease_owner = NULL, lease_expires_at = NULL,
         attempts = MAX(attempts - 1, 0), available_at = ?, error_summary = ?, updated_at = ?
       WHERE id = ?`,
    )
    .run(now + delayMs, reason, now, job.id);
}

/** Releases leases held by a previous process generation so work resumes after restart. */
export function releaseExpiredLeases(now = Date.now()): number {
  const result = db()
    .prepare(
      `UPDATE jobs SET state = 'pending', lease_owner = NULL, lease_expires_at = NULL,
         updated_at = ? WHERE state = 'claimed' AND lease_expires_at IS NOT NULL
         AND lease_expires_at <= ?`,
    )
    .run(now, now);
  return result.changes;
}

export function getJob(id: string): JobRow | undefined {
  return db().prepare<[string], JobRow>('SELECT * FROM jobs WHERE id = ?').get(id);
}

export function countPendingJobs(now = Date.now()): number {
  const row = db()
    .prepare<[number], { count: number }>(
      "SELECT COUNT(*) AS count FROM jobs WHERE state = 'pending' AND available_at <= ?",
    )
    .get(now);
  return row?.count ?? 0;
}
