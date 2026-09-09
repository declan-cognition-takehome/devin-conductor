'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { ExternalLink, GitPullRequestArrow, ListTodo, MoreHorizontal, SearchX } from 'lucide-react';
import clsx from 'clsx';
import type { TaskListItem } from '@/lib/db/store';
import type { UiState } from '@/lib/db/types';
import { getJson } from '@/lib/client/api';
import {
  EmptyState,
  ErrorState,
  IconButton,
  Menu,
  MenuItem,
  PageHeader,
  RowSkeleton,
  SearchField,
  Segmented,
  StateIndicator,
  STATE_LABELS,
  Tooltip,
  formatRelative,
  formatTime,
} from './ui';

interface TasksResponse {
  items: TaskListItem[];
  total: number;
  counts: Record<UiState, number>;
}

type Filter = UiState | 'all';

const FILTERS: Array<{ value: Filter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'queued', label: STATE_LABELS.queued },
  { value: 'working', label: STATE_LABELS.working },
  { value: 'pr_ready', label: STATE_LABELS.pr_ready },
  { value: 'needs_attention', label: 'Attention' },
  { value: 'merged', label: STATE_LABELS.merged },
  { value: 'closed', label: 'Closed' },
  { value: 'ignored', label: STATE_LABELS.ignored },
];

const POLL_MS = 10_000;

export function TaskList({ banner }: { banner?: React.ReactNode }) {
  const [state, setState] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const [data, setData] = useState<TasksResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const searchRef = useRef<HTMLInputElement>(null);

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

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const typing =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target?.isContentEditable;
      if (event.key === '/' && !typing && !event.metaKey && !event.ctrlKey) {
        event.preventDefault();
        searchRef.current?.focus();
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  const filters = FILTERS.map((filter) => ({
    ...filter,
    count: data && filter.value !== 'all' ? data.counts[filter.value] : undefined,
  }));

  return (
    <div className="space-y-4">
      <PageHeader
        title="Issues"
        icon={ListTodo}
        description="Track the issues Conductor is orchestrating."
        actions={
          <SearchField
            label="Search issues"
            placeholder="Search issue, repo, author"
            value={search}
            onChange={setSearch}
            shortcutHint="/"
            inputRef={searchRef}
            className="w-56 sm:w-72"
          />
        }
      />

      {banner}

      <div className="flex flex-wrap items-center gap-3">
        <Segmented
          label="Filter issues by state"
          options={filters}
          value={state}
          onChange={setState}
        />
        {data && (
          <p className="numeric text-meta text-ink-faint">
            {data.total} {data.total === 1 ? 'issue' : 'issues'}
          </p>
        )}
      </div>

      {error && <ErrorState message={error} onRetry={() => void load()} />}

      <div className="border-t border-border-subtle">
        {loading && !data ? (
          <RowSkeleton rows={6} />
        ) : data && data.items.length === 0 ? (
          search.trim() ? (
            <EmptyState
              icon={SearchX}
              title="No issues match this search"
              hint="Try a different issue title, repository, or author."
            />
          ) : (
            <EmptyState
              title="No issues yet"
              hint="Issues appear when an organization member opens one in an automation-enabled repository."
            />
          )
        ) : (
          <table className="w-full text-body">
            <caption className="sr-only">Conductor issues</caption>
            <thead>
              <tr className="text-left text-meta text-ink-faint">
                <th scope="col" className="px-3 py-2 font-normal">
                  Issue
                </th>
                <th scope="col" className="hidden px-3 py-2 font-normal lg:table-cell">
                  Repository
                </th>
                <th scope="col" className="px-3 py-2 font-normal">
                  State
                </th>
                <th scope="col" className="hidden px-3 py-2 font-normal sm:table-cell">
                  PR
                </th>
                <th scope="col" className="hidden px-3 py-2 text-right font-normal sm:table-cell">
                  ACUs
                </th>
                <th scope="col" className="px-3 py-2 text-right font-normal">
                  Updated
                </th>
                <th scope="col" className="w-9 px-1 py-2">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {data?.items.map((task) => (
                <TaskRow key={task.id} task={task} />
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function TaskRow({ task }: { task: TaskListItem }) {
  return (
    <tr
      className={clsx(
        'group relative border-t border-border-subtle transition-colors duration-150',
        'hover:bg-surface-raised/60 focus-within:bg-surface-raised/60',
      )}
    >
      <td className="px-3 py-2.5 align-middle">
        <Link
          href={`/tasks/${task.id}`}
          className="block truncate text-ink after:absolute after:inset-0 after:content-['']"
        >
          <span className="numeric text-ink-faint">#{task.issue_number}</span>{' '}
          <span className="font-medium">{task.issue_title}</span>
        </Link>
        <p className="mt-0.5 truncate text-meta text-ink-muted">
          @{task.author_login}
          <span className="lg:hidden"> · {task.repository_full_name}</span>
        </p>
      </td>
      <td className="hidden max-w-[220px] px-3 py-2.5 align-middle text-meta text-ink-muted lg:table-cell">
        <span className="block truncate">{task.repository_full_name}</span>
      </td>
      <td className="px-3 py-2.5 align-middle">
        <StateIndicator state={task.ui_state} size="sm" />
      </td>
      <td className="hidden px-3 py-2.5 align-middle sm:table-cell">
        {task.pr_url ? (
          <a
            href={task.pr_url}
            target="_blank"
            rel="noreferrer"
            className="numeric relative z-10 inline-flex items-center gap-1 text-meta text-accent hover:underline"
          >
            <GitPullRequestArrow aria-hidden className="h-3 w-3" />#{task.pr_number}
          </a>
        ) : (
          <span className="text-meta text-ink-faint">—</span>
        )}
      </td>
      <td className="numeric hidden px-3 py-2.5 text-right align-middle text-meta text-ink-muted sm:table-cell">
        {task.acus ?? '—'}
      </td>
      <td className="numeric px-3 py-2.5 text-right align-middle text-meta text-ink-muted whitespace-nowrap">
        <Tooltip label={formatTime(task.last_activity_at)}>
          <span>{formatRelative(task.last_activity_at)}</span>
        </Tooltip>
      </td>
      <td className="px-1 py-2.5 text-right align-middle">
        <Menu
          label={`Actions for issue #${task.issue_number}`}
          className="relative z-10 inline-block opacity-0 transition-opacity duration-150 group-focus-within:opacity-100 group-hover:opacity-100 focus-within:opacity-100"
          trigger={(props) => (
            <IconButton label={`Actions for issue #${task.issue_number}`} {...props}>
              <MoreHorizontal aria-hidden className="h-4 w-4" />
            </IconButton>
          )}
        >
          {(close) => (
            <>
              <MenuItem href={`/tasks/${task.id}`} onSelect={close}>
                Open in Conductor
              </MenuItem>
              <MenuItem href={task.issue_url} external onSelect={close}>
                <ExternalLink aria-hidden className="h-3.5 w-3.5" />
                GitHub issue
              </MenuItem>
              {task.devin_session_url && (
                <MenuItem href={task.devin_session_url} external onSelect={close}>
                  <ExternalLink aria-hidden className="h-3.5 w-3.5" />
                  Devin session
                </MenuItem>
              )}
              {task.pr_url && (
                <MenuItem href={task.pr_url} external onSelect={close}>
                  <ExternalLink aria-hidden className="h-3.5 w-3.5" />
                  Pull request #{task.pr_number}
                </MenuItem>
              )}
            </>
          )}
        </Menu>
      </td>
    </tr>
  );
}
