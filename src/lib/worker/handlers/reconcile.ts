import { logger } from '../../logger';
import {
  addTaskEvent,
  getAttempt,
  getRepository,
  getTask,
  insertMessages,
  listPullRequests,
  markDevinContact,
  recomputeTaskState,
  updateAttempt,
  updateTask,
  upsertPullRequest,
} from '../../db/store';
import { enqueueJob } from '../../queue/jobs';
import { devinClient } from '../../devin/client';
import type { DevinSession } from '../../devin/client';
import type { AttemptRow } from '../../db/types';
import { parsePullRequestUrl } from '../../github/events';
import { isAwaitingInputDetail, isTerminalDevinStatus } from '../../tasks/state';
import { redact, safeErrorSummary } from '../../redact';

const MAX_MESSAGE_CHARS = 8_000;

export const AWAITING_INPUT_REASON =
  'Devin is waiting for a human reply in the session before it can continue.';

export async function reconcileAttempt(attemptId: string): Promise<void> {
  const attempt = getAttempt(attemptId);
  if (!attempt?.devin_session_id) return;
  const task = getTask(attempt.task_id);
  if (!task) return;

  const client = devinClient();
  const session = await client.getSession(attempt.devin_session_id);
  markDevinContact();

  const statusChanged = session.status !== attempt.raw_status;
  const now = Date.now();
  const terminal = isTerminalDevinStatus(session.status);

  updateAttempt(attemptId, {
    raw_status: session.status,
    status_detail: session.status_detail ?? null,
    acus: await resolveAcus(attempt, session),
    status: terminal ? 'terminal' : 'running',
    last_reconciled_at: now,
    terminal_at: terminal ? (attempt.terminal_at ?? now) : null,
  });

  const detailChanged = (session.status_detail ?? null) !== attempt.status_detail;
  if (
    detailChanged &&
    isAwaitingInputDetail(session.status_detail) &&
    !isAwaitingInputDetail(attempt.status_detail)
  ) {
    addTaskEvent({
      taskId: task.id,
      eventType: 'session_awaiting_input',
      source: 'devin',
      summary: 'Devin is waiting for a human reply in the session',
      metadata: { sessionId: session.session_id, statusDetail: session.status_detail },
    });
  }

  if (statusChanged) {
    addTaskEvent({
      taskId: task.id,
      eventType: 'session_status_changed',
      source: 'devin',
      summary: `Devin session status: ${session.status}${session.status_detail ? ` (${session.status_detail})` : ''}`,
      metadata: { sessionId: session.session_id },
    });
  }

  await ingestMessages(attemptId, attempt.devin_session_id, attempt.message_cursor);

  for (const pr of session.pull_requests) {
    const parsed = parsePullRequestUrl(pr.pr_url);
    if (!parsed) {
      logger.warn('ignoring malformed PR url from Devin session', { attemptId });
      continue;
    }
    const repository = getRepository(task.repository_id);
    const known = listPullRequests(task.id).some((row) => row.url === pr.pr_url);
    const state = (pr.pr_state ?? 'open').toLowerCase();
    upsertPullRequest({
      taskId: task.id,
      attemptId,
      githubRepoId: parsed.fullName === task.repository_full_name ? task.repository_id : null,
      repositoryFullName: parsed.fullName,
      number: parsed.number,
      url: pr.pr_url,
      state: state === 'merged' ? 'closed' : state,
      merged: state === 'merged',
      mergedAt: state === 'merged' ? now : null,
      prCreatedAt: now,
    });
    if (!known) {
      addTaskEvent({
        taskId: task.id,
        eventType: 'pull_request_discovered',
        source: 'devin',
        summary: `Devin opened pull request #${parsed.number}`,
        metadata: { url: pr.pr_url, repository: repository?.full_name ?? parsed.fullName },
      });
      enqueueJob({
        jobType: 'reconcile_pull_request',
        entityId: `${parsed.fullName}#${parsed.number}`,
        dedupeKey: `pr:${parsed.fullName}#${parsed.number}`,
      });
    }
  }

  if (terminal) {
    updateTask(task.id, { internal_state: 'session_terminal', last_activity_at: now });
  }
  const updated = recomputeTaskState(task.id);
  if (updated?.ui_state === 'needs_attention') {
    if (updated.secondary_outcome === 'awaiting_input') {
      updateTask(task.id, { needs_attention_reason: AWAITING_INPUT_REASON });
      // A session that stopped waiting owns a new reason: the waiting one is no longer true.
    } else if (
      !updated.needs_attention_reason ||
      updated.needs_attention_reason === AWAITING_INPUT_REASON
    ) {
      updateTask(task.id, {
        needs_attention_reason: session.status_detail
          ? `Devin session ended: ${session.status} (${session.status_detail})`
          : `Devin session ended: ${session.status}`,
      });
    }
  } else if (updated?.needs_attention_reason) {
    // The session resumed on its own (or produced a PR); the stale reason must not linger.
    updateTask(task.id, { needs_attention_reason: null });
  }

  enqueueJob({ jobType: 'sync_comment', entityId: task.id, dedupeKey: `comment:${task.id}` });
  // The next poll is scheduled by the worker after this job completes: while the job is still
  // claimed it holds `reconcile:<attemptId>`, and the dedupe index would drop the insert.
}

/**
 * ACUs come from two places: the session payload, which reports 0 until metering catches up,
 * and the consumption endpoint, which settles afterwards. Both report the session total rather
 * than a delta, so keeping the largest figure seen neither inflates the total on repeated polls
 * nor lets a late zero erase a recorded one. A zero is treated as "not metered yet" so the
 * report can distinguish unknown usage from genuinely free work.
 */
async function resolveAcus(attempt: AttemptRow, session: DevinSession): Promise<number | null> {
  const candidates = [attempt.acus ?? 0, session.acus_consumed ?? 0];
  if (candidates.every((value) => value <= 0)) {
    try {
      const { totalAcus } = await devinClient().getSessionConsumption(session.session_id);
      if (totalAcus !== null) candidates.push(totalAcus);
    } catch (error) {
      // Consumption is reporting-only: a failure must not stall reconciliation.
      logger.warn('devin consumption lookup failed', {
        attemptId: attempt.id,
        error: safeErrorSummary(error),
      });
    }
  }
  const highest = Math.max(...candidates);
  return highest > 0 ? highest : null;
}

/** Pulls only messages newer than the stored cursor and deduplicates by Devin event ID. */
async function ingestMessages(
  attemptId: string,
  sessionId: string,
  cursor: string | null,
): Promise<void> {
  const client = devinClient();
  let after = cursor;
  let guard = 0;
  for (;;) {
    const page = await client.listMessages(sessionId, { after, first: 100 });
    if (page.items.length > 0) {
      insertMessages(
        attemptId,
        page.items.map((message) => ({
          devinMessageId: message.event_id,
          source: message.source,
          message: redact(message.message).slice(0, MAX_MESSAGE_CHARS),
          createdAt: normalizeTimestamp(message.created_at),
        })),
      );
    }
    if (page.end_cursor) {
      after = page.end_cursor;
      updateAttempt(attemptId, { message_cursor: page.end_cursor });
    }
    guard += 1;
    if (!page.has_next_page || !page.end_cursor || guard >= 20) break;
  }
}

/** Devin timestamps are epoch seconds; local storage uses milliseconds. */
function normalizeTimestamp(value: number): number {
  return value > 1e12 ? value : value * 1000;
}
