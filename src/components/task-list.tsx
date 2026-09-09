'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import clsx from 'clsx';
import type { TaskListItem } from '@/lib/db/store';
import type { UiState } from '@/lib/db/types';
import { getJson } from '@/lib/client/api';
import {
  Card,
  EmptyState,
  ErrorState,
  Skeleton,
  StateBadge,
  STATE_LABELS,
  formatRelative,
} from './ui';

interface TasksResponse {
  items: TaskListItem[];
  total: number;
  counts: Record<UiState, number>;
}

const FILTERS: Array<{ value: UiState | 'all'; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'queued', label: STATE_LABELS.queued },
  { value: 'working', label: STATE_LABELS.working },
  { value: 'pr_ready', label: STATE_LABELS.pr_ready },
  { value: 'merged', label: STATE_LABELS.merged },
  { value: 'needs_attention', label: STATE_LABELS.needs_attention },
  { value: 'ignored', label: STATE_LABELS.ignored },
];

const POLL_MS = 10_000;

export function TaskList() {
  const [state, setState] = useState<UiState | 'all'>('all');
  const [search, setSearch] = useState('');
  const [data, setData] = useState<TasksResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const query = useMemo(() => {
    const params = new URLSearchParams();
    if (state !== 'all') params.set('state', state);
    if (search.trim()) params.set('search', search.trim());
    return params.toString();
  }, [state, search]);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      try {
        setData(await getJson<TasksResponse>(`/api/tasks?${query}`, signal));
        setError(null);
      } catch (err) {
        if ((err as Error).name === 'AbortError') return;
        setError((err as Error).message);
      } finally {
        setLoading(false);
      }
    },
    [query],
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

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div
          role="group"
          aria-label="Filter tasks by state"
          className="flex flex-wrap items-center gap-1"
        >
          {FILTERS.map((filter) => (
            <button
              key={filter.value}
              type="button"
              aria-pressed={state === filter.value}
              onClick={() => setState(filter.value)}
              className={clsx(
                'rounded-md border px-2.5 py-1 text-xs transition-colors',
                state === filter.value
                  ? 'border-accent/50 bg-surface-raised text-ink'
                  : 'border-border-subtle text-ink-muted hover:text-ink',
              )}
            >
              {filter.label}
              {data && filter.value !== 'all' && (
                <span className="ml-1.5 tabular-nums text-ink-muted">
                  {data.counts[filter.value]}
                </span>
              )}
            </button>
          ))}
        </div>
        <label className="ml-auto">
          <span className="sr-only">Search tasks</span>
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search issue, repo, author"
            className="w-64 rounded-md border border-border-subtle bg-surface px-3 py-1.5 text-sm placeholder:text-ink-muted/70"
          />
        </label>
      </div>

      {error && <ErrorState message={error} onRetry={() => void load()} />}

      {loading && !data ? (
        <Card>
          <div className="space-y-3">
            {[0, 1, 2, 3].map((row) => (
              <Skeleton key={row} className="h-10 w-full" />
            ))}
          </div>
        </Card>
      ) : data && data.items.length === 0 ? (
        <EmptyState
          title="No tasks yet"
          hint="Tasks appear when an organization member opens an issue in an automation-enabled repository."
        />
      ) : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full min-w-[720px] text-sm">
            <caption className="sr-only">Conductor tasks</caption>
            <thead className="text-left text-xs text-ink-muted">
              <tr className="border-b border-border-subtle">
                <th scope="col" className="px-4 py-2 font-medium">
                  Issue
                </th>
                <th scope="col" className="px-4 py-2 font-medium">
                  Repository
                </th>
                <th scope="col" className="px-4 py-2 font-medium">
                  State
                </th>
                <th scope="col" className="px-4 py-2 font-medium">
                  PR
                </th>
                <th scope="col" className="px-4 py-2 font-medium">
                  ACUs
                </th>
                <th scope="col" className="px-4 py-2 font-medium">
                  Updated
                </th>
              </tr>
            </thead>
            <tbody>
              {data?.items.map((task) => (
                <tr
                  key={task.id}
                  className="border-b border-border-subtle/60 last:border-0 hover:bg-surface-raised/60"
                >
                  <td className="px-4 py-2.5">
                    <Link href={`/tasks/${task.id}`} className="hover:text-accent">
                      <span className="text-ink-muted">#{task.issue_number}</span>{' '}
                      {task.issue_title}
                    </Link>
                    <p className="text-xs text-ink-muted">@{task.author_login}</p>
                  </td>
                  <td className="px-4 py-2.5 text-ink-muted">{task.repository_full_name}</td>
                  <td className="px-4 py-2.5">
                    <StateBadge state={task.ui_state} />
                  </td>
                  <td className="px-4 py-2.5">
                    {task.pr_url ? (
                      <a
                        href={task.pr_url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-accent hover:underline"
                      >
                        #{task.pr_number}
                      </a>
                    ) : (
                      <span className="text-ink-muted">—</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 tabular-nums text-ink-muted">{task.acus ?? '—'}</td>
                  <td className="px-4 py-2.5 text-ink-muted">
                    {formatRelative(task.last_activity_at)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
