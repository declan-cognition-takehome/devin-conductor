import { config } from '../../config';
import { logger } from '../../logger';
import {
  addTaskEvent,
  countActiveAttempts,
  createAttempt,
  getRepository,
  getSettings,
  getTask,
  listAttempts,
  markDevinContact,
  updateAttempt,
  updateTask,
} from '../../db/store';
import { enqueueJob } from '../../queue/jobs';
import { DevinUncertainDispatchError, devinClient, type DevinSession } from '../../devin/client';
import {
  buildRemediationPrompt,
  buildSessionTags,
  buildSessionTitle,
  dispatchTag,
} from '../../devin/prompt';
import { safeErrorSummary } from '../../redact';
import type { AttemptRow, TaskRow } from '../../db/types';

/** Signals that the task cannot be dispatched right now but is not failing. */
export class DispatchDeferred extends Error {
  constructor(
    readonly reason: string,
    readonly retryAfterMs: number,
  ) {
    super(reason);
    this.name = 'DispatchDeferred';
  }
}

const DEFER_MS = 30_000;
const RECOVERY_WINDOW_MS = 30 * 60_000;

function pendingAttempt(taskId: string): AttemptRow | undefined {
  return listAttempts(taskId).find(
    (attempt) => attempt.devin_session_id === null && attempt.status !== 'failed',
  );
}

export async function dispatchTask(taskId: string): Promise<void> {
  const task = getTask(taskId);
  if (!task) return;
  if (task.ui_state !== 'queued') return;

  const settings = getSettings();
  if (settings.paused === 1) {
    throw new DispatchDeferred('automation is paused', DEFER_MS);
  }
  if (countActiveAttempts() >= settings.max_concurrent_sessions) {
    throw new DispatchDeferred('maximum concurrent Devin sessions reached', DEFER_MS);
  }

  const attempt =
    pendingAttempt(taskId) ??
    createAttempt({
      taskId,
      attemptNumber: task.attempt_count + 1,
      dispatchTag: dispatchTag(taskId, task.attempt_count + 1),
    });

  if (attempt.attempt_number > task.attempt_count) {
    updateTask(taskId, { attempt_count: attempt.attempt_number, current_attempt_id: attempt.id });
  }
  updateTask(taskId, { internal_state: 'dispatching', ui_state: 'queued' });

  const client = devinClient();
  let session: DevinSession | null = null;

  if (attempt.uncertain_dispatch === 1) {
    session = await recoverUncertainDispatch(task, attempt);
    if (session) {
      addTaskEvent({
        taskId,
        eventType: 'dispatch_recovered',
        source: 'devin_conductor',
        summary: `Adopted existing Devin session for attempt ${attempt.attempt_number}`,
        metadata: { sessionId: session.session_id },
      });
      updateAttempt(attempt.id, { adopted_session: 1, uncertain_dispatch: 0 });
    }
  }

  if (!session) {
    const repository = getRepository(task.repository_id);
    const prompt = buildRemediationPrompt({
      issueUrl: task.issue_url,
      repositoryFullName: task.repository_full_name,
      defaultBranch: repository?.default_branch ?? null,
      issueNumber: task.issue_number,
      issueTitle: task.issue_title,
      issueBody: task.issue_body,
    });
    try {
      session = await client.createSession({
        prompt,
        title: buildSessionTitle(task.repository_full_name, task.issue_number, task.issue_title),
        repos: [task.repository_full_name],
        sessionLinks: [task.issue_url],
        tags: buildSessionTags({
          taskId,
          attemptNumber: attempt.attempt_number,
          repositoryFullName: task.repository_full_name,
        }),
        maxAcuLimit: settings.max_acu_limit,
      });
    } catch (error) {
      if (error instanceof DevinUncertainDispatchError) {
        // The session may exist. Flag the attempt so the retry recovers by tag instead
        // of creating a duplicate session.
        updateAttempt(attempt.id, {
          uncertain_dispatch: 1,
          status: 'uncertain',
          error_summary: safeErrorSummary(error),
        });
        addTaskEvent({
          taskId,
          eventType: 'dispatch_uncertain',
          source: 'devin_conductor',
          summary: 'Devin session creation outcome was uncertain; will attempt tag recovery',
        });
      } else {
        updateAttempt(attempt.id, { status: 'failed', error_summary: safeErrorSummary(error) });
      }
      throw error;
    }
  }

  markDevinContact();
  const now = Date.now();
  updateAttempt(attempt.id, {
    devin_session_id: session.session_id,
    devin_session_url: session.url || sessionWebUrl(session.session_id),
    status: 'dispatched',
    raw_status: session.status,
    status_detail: session.status_detail ?? null,
    // A freshly created session reports 0 ACUs; reconciliation records the metered total.
    acus: session.acus_consumed ? session.acus_consumed : null,
    dispatched_at: now,
    error_summary: null,
  });
  updateTask(taskId, {
    internal_state: 'running',
    ui_state: 'working',
    current_attempt_id: attempt.id,
    dispatched_at: task.dispatched_at ?? now,
    last_activity_at: now,
    status_reason: null,
  });
  addTaskEvent({
    taskId,
    eventType: 'session_dispatched',
    source: 'devin_conductor',
    summary: `Devin session started (attempt ${attempt.attempt_number})`,
    metadata: { sessionId: session.session_id },
  });

  enqueueJob({
    jobType: 'reconcile_attempt',
    entityId: attempt.id,
    dedupeKey: `reconcile:${attempt.id}`,
    availableAt: Date.now() + settings.poll_interval_seconds * 1000,
  });
  enqueueJob({ jobType: 'sync_comment', entityId: taskId, dedupeKey: `comment:${taskId}` });
  logger.info('dispatched devin session', { taskId, attemptId: attempt.id });
}

function sessionWebUrl(sessionId: string): string {
  const devin = config().devin;
  const base = devin.configured ? devin.value.DEVIN_APP_BASE_URL : 'https://app.devin.ai';
  return `${base.replace(/\/$/, '')}/sessions/${sessionId.replace(/^devin-/, '')}`;
}

/**
 * Looks for a session already created for this exact task/attempt tag pair. Adopting an
 * existing session is always preferred over creating a second one.
 */
async function recoverUncertainDispatch(
  task: TaskRow,
  attempt: AttemptRow,
): Promise<DevinSession | null> {
  const client = devinClient();
  const tag = attempt.dispatch_tag;
  const result = await client.listSessions({
    tags: [tag],
    createdAfter: Math.floor((Date.now() - RECOVERY_WINDOW_MS) / 1000),
    first: 50,
  });
  const matches = result.items.filter((session) => session.tags.includes(tag));
  if (matches.length === 0) return null;
  if (matches.length === 1) return matches[0] ?? null;

  const newest = [...matches].sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0))[0] ?? null;
  updateTask(task.id, {
    secondary_outcome: 'anomaly',
    needs_attention_reason: `Multiple Devin sessions matched dispatch tag ${tag}; adopted the newest`,
  });
  addTaskEvent({
    taskId: task.id,
    eventType: 'dispatch_anomaly',
    source: 'devin_conductor',
    summary: `Found ${matches.length} sessions for one dispatch tag; adopted the newest`,
    metadata: { sessionIds: matches.map((session) => session.session_id) },
  });
  return newest;
}
