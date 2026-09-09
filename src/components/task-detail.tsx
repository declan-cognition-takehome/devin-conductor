'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import type {
  AttemptRow,
  DevinMessageRow,
  PullRequestRow,
  TaskEventRow,
  TaskRow,
} from '@/lib/db/types';
import { ApiError, getJson, postJson } from '@/lib/client/api';
import { Card, ErrorState, Skeleton, StateBadge, formatTime } from './ui';

interface TaskDetailResponse {
  task: TaskRow;
  attempts: AttemptRow[];
  pullRequests: PullRequestRow[];
  events: TaskEventRow[];
  messages: DevinMessageRow[];
}

const POLL_MS = 8_000;

export function TaskDetail({ taskId }: { taskId: string }) {
  const [data, setData] = useState<TaskDetailResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      try {
        setData(await getJson<TaskDetailResponse>(`/api/tasks/${taskId}`, signal));
        setError(null);
      } catch (err) {
        if ((err as Error).name === 'AbortError') return;
        setError((err as Error).message);
      }
    },
    [taskId],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    const timer = setInterval(() => void load(), POLL_MS);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [load]);

  async function retry() {
    setRetrying(true);
    setActionError(null);
    try {
      await postJson(`/api/tasks/${taskId}/retry`, {});
      await load();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Retry failed');
    } finally {
      setRetrying(false);
    }
  }

  if (error) return <ErrorState message={error} onRetry={() => void load()} />;
  if (!data) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-8 w-1/2" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  const { task, attempts, pullRequests, events, messages } = data;
  const latestAttempt = attempts.at(-1);
  const retryable = task.ui_state === 'needs_attention' || task.ui_state === 'queued';

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/" className="text-xs text-ink-muted hover:text-ink">
            ← Observe
          </Link>
          <h1 className="mt-1 text-lg font-semibold tracking-tight">{task.issue_title}</h1>
          <p className="mt-1 text-sm text-ink-muted">
            <a href={task.issue_url} target="_blank" rel="noreferrer" className="hover:text-accent">
              {task.repository_full_name}#{task.issue_number}
            </a>{' '}
            · opened by @{task.author_login}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <StateBadge state={task.ui_state} />
          {latestAttempt?.devin_session_url && (
            <a
              href={latestAttempt.devin_session_url}
              target="_blank"
              rel="noreferrer"
              className="rounded-md border border-border-subtle px-2.5 py-1 text-xs hover:bg-surface-raised"
            >
              Open Devin session
            </a>
          )}
          {retryable && (
            <button
              type="button"
              onClick={() => void retry()}
              disabled={retrying}
              className="rounded-md border border-border-subtle px-2.5 py-1 text-xs hover:bg-surface-raised disabled:opacity-50"
            >
              {retrying ? 'Queueing…' : 'Retry'}
            </button>
          )}
        </div>
      </div>

      {actionError && <ErrorState message={actionError} />}

      {task.needs_attention_reason && (
        <Card title="Needs attention">
          <p className="text-sm text-critical">{task.needs_attention_reason}</p>
        </Card>
      )}

      {task.status_reason && task.ui_state === 'ignored' && (
        <Card title="Why this issue was ignored">
          <p className="text-sm text-ink-muted">{task.status_reason}</p>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Devin attempts">
          {attempts.length === 0 ? (
            <p className="text-sm text-ink-muted">No session has been dispatched yet.</p>
          ) : (
            <ul className="space-y-3 text-sm">
              {attempts.map((attempt) => (
                <li key={attempt.id} className="rounded-lg bg-surface-raised p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">Attempt {attempt.attempt_number}</span>
                    <span className="text-xs text-ink-muted">{attempt.status}</span>
                  </div>
                  <dl className="mt-2 grid grid-cols-2 gap-1 text-xs text-ink-muted">
                    <dt>Devin status</dt>
                    <dd className="text-right">{attempt.raw_status ?? '—'}</dd>
                    <dt>ACUs</dt>
                    <dd className="text-right tabular-nums">{attempt.acus ?? '—'}</dd>
                    <dt>Dispatched</dt>
                    <dd className="text-right">{formatTime(attempt.dispatched_at)}</dd>
                    <dt>Last reconciled</dt>
                    <dd className="text-right">{formatTime(attempt.last_reconciled_at)}</dd>
                  </dl>
                  {attempt.error_summary && (
                    <p className="mt-2 text-xs text-critical">{attempt.error_summary}</p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card
          title="Pull requests"
          description="Conductor never merges. A human reviews and merges."
        >
          {pullRequests.length === 0 ? (
            <p className="text-sm text-ink-muted">No pull request has been reported yet.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {pullRequests.map((pr) => (
                <li key={pr.id} className="flex items-center justify-between gap-3">
                  <a
                    href={pr.url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-accent hover:underline"
                  >
                    {pr.repository_full_name}#{pr.number}
                  </a>
                  <span className="text-xs text-ink-muted">
                    {pr.merged === 1 ? 'merged' : pr.state}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card title="Timeline">
        {events.length === 0 ? (
          <p className="text-sm text-ink-muted">No events recorded.</p>
        ) : (
          <ol className="space-y-2 text-sm">
            {events.map((event) => (
              <li key={event.id} className="flex flex-wrap items-baseline gap-2">
                <span className="text-xs tabular-nums text-ink-muted">
                  {formatTime(event.created_at)}
                </span>
                <span className="rounded bg-surface-raised px-1.5 py-0.5 text-xs text-ink-muted">
                  {event.source}
                </span>
                <span>{event.summary}</span>
              </li>
            ))}
          </ol>
        )}
      </Card>

      <Card
        title="Session messages"
        description="Redacted excerpts of the Devin transcript. Continue the conversation in Devin."
      >
        {messages.length === 0 ? (
          <p className="text-sm text-ink-muted">No messages ingested yet.</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {messages.map((message) => (
              <li key={message.id} className="rounded-lg bg-surface-raised p-3">
                <div className="flex items-center justify-between text-xs text-ink-muted">
                  <span>{message.source}</span>
                  <span>{formatTime(message.created_at)}</span>
                </div>
                <p className="mt-1 whitespace-pre-wrap break-words">{message.message}</p>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
