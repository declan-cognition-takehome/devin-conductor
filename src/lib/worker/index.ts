import { randomUUID } from 'node:crypto';
import { logger } from '../logger';
import { config } from '../config';
import {
  addTaskEvent,
  getAttempt,
  getSettings,
  getTask,
  listActiveAttempts,
  listOpenPullRequests,
  recomputeTaskState,
  updateTask,
} from '../db/store';
import {
  claimNextJob,
  completeJob,
  deferJob,
  enqueueJob,
  extendLease,
  failJob,
  releaseExpiredLeases,
} from '../queue/jobs';
import { processDelivery } from './handlers/process-delivery';
import { DispatchDeferred, dispatchTask } from './handlers/dispatch';
import { reconcileAttempt } from './handlers/reconcile';
import { syncComment } from './handlers/sync-comment';
import { reconcilePullRequest } from './handlers/pull-request';
import type { JobRow } from '../db/types';

const IDLE_DELAY_MS = 1_000;
const SWEEP_INTERVAL_MS = 60_000;

export interface WorkerOptions {
  ownerId?: string;
  idleDelayMs?: number;
}

/**
 * The single worker loop. Exactly one instance runs per container; leases and
 * transactional claims mean a second instance would still be safe, just wasteful.
 */
export class Worker {
  private readonly ownerId: string;
  private readonly idleDelayMs: number;
  private running = false;
  private stopped: Promise<void> = Promise.resolve();
  private lastSweep = 0;

  constructor(options: WorkerOptions = {}) {
    this.ownerId = options.ownerId ?? `worker-${randomUUID().slice(0, 8)}`;
    this.idleDelayMs = options.idleDelayMs ?? IDLE_DELAY_MS;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    const released = releaseExpiredLeases();
    if (released > 0) logger.info('released expired job leases on startup', { released });
    this.stopped = this.loop();
    logger.info('worker started', { owner: this.ownerId });
  }

  async stop(): Promise<void> {
    this.running = false;
    await this.stopped;
  }

  private async loop(): Promise<void> {
    while (this.running) {
      try {
        const worked = await this.tick();
        if (!worked) await sleep(this.idleDelayMs);
      } catch (error) {
        logger.error('worker loop error', { error });
        await sleep(this.idleDelayMs);
      }
    }
  }

  /** Runs at most one job. Returns true when a job was processed. */
  async tick(): Promise<boolean> {
    await this.sweep();
    releaseExpiredLeases();
    const job = claimNextJob(this.ownerId);
    if (!job) return false;

    const heartbeat = setInterval(() => extendLease(job.id, this.ownerId), 30_000);
    try {
      await runJob(job);
      completeJob(job.id);
      scheduleNextPoll(job);
    } catch (error) {
      if (error instanceof DispatchDeferred) {
        deferJob(job, error.retryAfterMs, error.reason);
      } else {
        const outcome = failJob(job, error);
        logger.warn('job failed', {
          jobId: job.id,
          jobType: job.job_type,
          attempts: job.attempts,
          exhausted: outcome.exhausted,
          error,
        });
        if (outcome.exhausted) onJobExhausted(job, error);
      }
    } finally {
      clearInterval(heartbeat);
    }
    return true;
  }

  /** Periodic safety net for events that may have been missed. */
  private async sweep(): Promise<void> {
    const now = Date.now();
    if (now - this.lastSweep < SWEEP_INTERVAL_MS) return;
    this.lastSweep = now;
    const intervalMs = getSettings().poll_interval_seconds * 1000;
    for (const attempt of listActiveAttempts()) {
      enqueueJob({
        jobType: 'reconcile_attempt',
        entityId: attempt.id,
        dedupeKey: `reconcile:${attempt.id}`,
        availableAt: Math.max(now, (attempt.last_reconciled_at ?? 0) + intervalMs),
      });
    }
    for (const pr of listOpenPullRequests()) {
      enqueueJob({
        jobType: 'reconcile_pull_request',
        entityId: `${pr.repository_full_name}#${pr.number}`,
        dedupeKey: `pr:${pr.repository_full_name}#${pr.number}`,
      });
    }
  }
}

/**
 * Polling continues from here rather than from inside the handler: a running job still holds
 * its dedupe key, so a self-scheduled follow-up would be silently dropped by the dedupe index.
 */
function scheduleNextPoll(job: JobRow): void {
  if (job.job_type !== 'reconcile_attempt') return;
  const attempt = getAttempt(job.entity_id);
  if (!attempt || attempt.status === 'terminal') return;
  enqueueJob({
    jobType: 'reconcile_attempt',
    entityId: attempt.id,
    dedupeKey: `reconcile:${attempt.id}`,
    availableAt: Date.now() + getSettings().poll_interval_seconds * 1000,
    maxAttempts: 10,
  });
}

async function runJob(job: JobRow): Promise<void> {
  switch (job.job_type) {
    case 'process_delivery':
      return processDelivery(job.entity_id);
    case 'dispatch_task':
      return dispatchTask(job.entity_id);
    case 'reconcile_attempt':
      return reconcileAttempt(job.entity_id);
    case 'sync_comment':
      return syncComment(job.entity_id);
    case 'reconcile_pull_request':
      return reconcilePullRequest(job.entity_id);
    default:
      throw new Error(`unknown job type ${String(job.job_type)}`);
  }
}

/** Retry exhaustion must leave the affected task in an explicit, visible state. */
function onJobExhausted(job: JobRow, error: unknown): void {
  const reason = `Automation gave up after ${job.attempts} attempts (${job.job_type})`;
  if (job.job_type === 'dispatch_task') {
    const task = getTask(job.entity_id);
    if (!task) return;
    updateTask(task.id, {
      internal_state: 'failed',
      ui_state: 'needs_attention',
      secondary_outcome: 'dispatch_exhausted',
      needs_attention_reason: reason,
      terminal_at: Date.now(),
    });
    addTaskEvent({
      taskId: task.id,
      eventType: 'dispatch_exhausted',
      source: 'devin_conductor',
      summary: reason,
    });
    enqueueJob({ jobType: 'sync_comment', entityId: task.id, dedupeKey: `comment:${task.id}` });
    return;
  }
  if (job.job_type === 'reconcile_attempt') {
    const attempt = getAttempt(job.entity_id);
    if (!attempt) return;
    updateTask(attempt.task_id, { needs_attention_reason: reason });
    addTaskEvent({
      taskId: attempt.task_id,
      eventType: 'reconcile_exhausted',
      source: 'devin_conductor',
      summary: reason,
    });
    recomputeTaskState(attempt.task_id);
    return;
  }
  logger.warn('job exhausted', { jobId: job.id, jobType: job.job_type, error });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let singleton: Worker | null = null;

/**
 * Starts the in-process worker once. Enabled by default in production and controlled by
 * `WORKER_ENABLED` so a second container (or a test process) can run web-only.
 */
export function startWorkerOnce(): Worker | null {
  if (singleton) return singleton;
  if (!config().base.WORKER_ENABLED) {
    logger.info('worker disabled by configuration');
    return null;
  }
  singleton = new Worker();
  singleton.start();
  return singleton;
}
