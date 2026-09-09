'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import type { LucideIcon } from 'lucide-react';
import {
  AlertTriangle,
  ArrowUpRight,
  Bot,
  ChevronDown,
  ChevronRight,
  CircleDot,
  ExternalLink,
  GitPullRequestArrow,
  MessageSquare,
  Route,
  User,
} from 'lucide-react';
import clsx from 'clsx';
import type {
  AttemptRow,
  DevinMessageRow,
  PullRequestRow,
  TaskEventRow,
  TaskRow,
} from '@/lib/db/types';
import { ApiError, getJson, postJson } from '@/lib/client/api';
import {
  Button,
  ConfirmDialog,
  Divider,
  EmptyState,
  ErrorState,
  LinkButton,
  PageHeader,
  Panel,
  Section,
  Skeleton,
  StateIndicator,
  StatusDot,
  Tag,
  Tooltip,
  formatRelative,
  formatTime,
  useToast,
} from './ui';

interface TaskDetailResponse {
  task: TaskRow;
  attempts: AttemptRow[];
  pullRequests: PullRequestRow[];
  events: TaskEventRow[];
  messages: DevinMessageRow[];
}

const POLL_MS = 8_000;

const ROUTINE_EVENTS = new Set(['session_status_changed']);

const STRONG_EVENTS = new Set([
  'session_awaiting_input',
  'dispatch_exhausted',
  'dispatch_anomaly',
  'dispatch_uncertain',
  'reconcile_exhausted',
  'pull_request_discovered',
  'pull_request_opened',
  'pull_request_merged',
  'issue_closed',
  'retry_requested',
]);

export function TaskDetail({ taskId }: { taskId: string }) {
  const [data, setData] = useState<TaskDetailResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [confirmRetry, setConfirmRetry] = useState(false);
  const toast = useToast();

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
    try {
      await postJson(`/api/tasks/${taskId}/retry`, {});
      setConfirmRetry(false);
      toast.show('success', 'A new Devin session has been queued.');
      await load();
    } catch (err) {
      toast.show('error', err instanceof ApiError ? err.message : 'Retry failed');
    } finally {
      setRetrying(false);
    }
  }

  if (error && !data) return <ErrorState message={error} onRetry={() => void load()} />;
  if (!data) return <DetailSkeleton />;

  const { task, attempts, pullRequests, events, messages } = data;
  const latestAttempt = attempts.at(-1);
  const sessionUrl = latestAttempt?.devin_session_url ?? null;
  const awaitingInput = task.secondary_outcome === 'awaiting_input';
  const retryable = task.ui_state === 'needs_attention' || task.ui_state === 'queued';
  // The attention panel already carries the primary action when it is shown.
  const attentionShown = Boolean(task.needs_attention_reason);
  const primaryIsSession = awaitingInput && Boolean(sessionUrl) && !attentionShown;

  return (
    <div className="space-y-5">
      <PageHeader
        breadcrumb={
          <span className="flex items-center gap-1">
            <Link href="/" className="hover:text-ink-muted">
              Issues
            </Link>
            <span aria-hidden>/</span>
            <span className="numeric text-ink-muted">#{task.issue_number}</span>
          </span>
        }
        title={task.issue_title}
        meta={
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span>{task.repository_full_name}</span>
            <span aria-hidden>·</span>
            <span>opened by @{task.author_login}</span>
            <span aria-hidden>·</span>
            <a
              href={task.issue_url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-accent hover:underline"
            >
              <CircleDot aria-hidden className="h-3 w-3" />
              GitHub issue
            </a>
            <span aria-hidden>·</span>
            <StateIndicator state={task.ui_state} size="sm" />
          </span>
        }
        actions={
          <>
            {sessionUrl && (
              <LinkButton
                href={sessionUrl}
                target="_blank"
                rel="noreferrer"
                variant={primaryIsSession ? 'primary' : 'secondary'}
                size="md"
              >
                Open Devin session
                <ArrowUpRight aria-hidden className="h-3.5 w-3.5" />
              </LinkButton>
            )}
            {retryable && (
              <Button
                size="md"
                variant={sessionUrl || attentionShown ? 'secondary' : 'primary'}
                onClick={() => setConfirmRetry(true)}
              >
                Retry
              </Button>
            )}
          </>
        }
      />

      {error && <ErrorState message={error} onRetry={() => void load()} />}

      {task.needs_attention_reason && (
        <AttentionPanel
          reason={task.needs_attention_reason}
          awaitingInput={awaitingInput}
          attempt={latestAttempt}
          since={task.last_activity_at}
          sessionUrl={sessionUrl}
        />
      )}

      {task.status_reason && task.ui_state === 'ignored' && (
        <Panel className="px-3 py-2.5">
          <p className="text-body font-medium text-ink">Not picked up by automation</p>
          <p className="mt-0.5 text-meta text-ink-muted">{task.status_reason}</p>
        </Panel>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px] xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-6">
          <Timeline events={events} />
          <Messages messages={messages} sessionUrl={sessionUrl} />
        </div>

        <aside className="space-y-6 lg:sticky lg:top-6 lg:self-start">
          <Attempts attempts={attempts} />
          <PullRequests pullRequests={pullRequests} />
          <RunMetadata task={task} />
        </aside>
      </div>

      <ConfirmDialog
        open={confirmRetry}
        title="Retry this issue?"
        body={
          <>
            Conductor dispatches a new Devin session for{' '}
            <span className="numeric">#{task.issue_number}</span>. The previous session is left
            untouched and the new attempt consumes additional ACUs.
          </>
        }
        confirmLabel={retrying ? 'Queueing…' : 'Queue new attempt'}
        busy={retrying}
        onConfirm={() => void retry()}
        onCancel={() => setConfirmRetry(false)}
      />
    </div>
  );
}

function AttentionPanel({
  reason,
  awaitingInput,
  attempt,
  since,
  sessionUrl,
}: {
  reason: string;
  awaitingInput: boolean;
  attempt: AttemptRow | undefined;
  since: number | null;
  sessionUrl: string | null;
}) {
  return (
    <Panel tone={awaitingInput ? 'caution' : 'critical'} className="flex gap-3 px-3 py-3">
      <AlertTriangle
        aria-hidden
        className={clsx(
          'mt-0.5 h-4 w-4 shrink-0',
          awaitingInput ? 'text-caution' : 'text-critical',
        )}
      />
      <div className="min-w-0 flex-1">
        <p className="text-body font-medium text-ink">
          {awaitingInput ? 'Devin is waiting for a reply' : 'This attempt needs a human'}
        </p>
        <p className="mt-0.5 text-meta text-ink-muted">{reason}</p>
        <p className="numeric mt-1 text-meta text-ink-faint">
          {attempt ? `Attempt ${attempt.attempt_number}` : 'No attempt'}
          {since ? ` · since ${formatRelative(since)}` : ''}
        </p>
      </div>
      {sessionUrl && (
        <LinkButton
          href={sessionUrl}
          target="_blank"
          rel="noreferrer"
          variant={awaitingInput ? 'primary' : 'secondary'}
          className="self-start"
        >
          {awaitingInput ? 'Reply in Devin' : 'Open Devin session'}
          <ArrowUpRight aria-hidden className="h-3.5 w-3.5" />
        </LinkButton>
      )}
    </Panel>
  );
}

function Attempts({ attempts }: { attempts: AttemptRow[] }) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const latest = attempts.at(-1);
  const earlier = attempts.slice(0, -1).reverse();

  return (
    <Section title="Attempts" id="attempts">
      {!latest ? (
        <EmptyState
          compact
          icon={CircleDot}
          title="No session dispatched"
          hint="Conductor dispatches a Devin session once the issue clears the trust policy."
        />
      ) : (
        <div className="space-y-3">
          <AttemptSummary attempt={latest} latest />
          {earlier.map((attempt) => {
            const open = expanded === attempt.id;
            return (
              <div key={attempt.id}>
                <button
                  type="button"
                  aria-expanded={open}
                  onClick={() => setExpanded(open ? null : attempt.id)}
                  className="flex w-full items-center gap-1.5 text-meta text-ink-muted transition-colors duration-150 hover:text-ink"
                >
                  {open ? (
                    <ChevronDown aria-hidden className="h-3.5 w-3.5" />
                  ) : (
                    <ChevronRight aria-hidden className="h-3.5 w-3.5" />
                  )}
                  Attempt {attempt.attempt_number} · {attempt.status}
                </button>
                {open && <AttemptSummary attempt={attempt} className="mt-2" />}
              </div>
            );
          })}
        </div>
      )}
    </Section>
  );
}

function AttemptSummary({
  attempt,
  latest = false,
  className,
}: {
  attempt: AttemptRow;
  latest?: boolean;
  className?: string;
}) {
  const running = attempt.terminal_at === null && attempt.status !== 'failed';
  return (
    <div className={clsx('space-y-2', className)}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-body font-medium text-ink">
          Attempt {attempt.attempt_number}
          {latest && <span className="ml-1.5 text-meta font-normal text-ink-faint">latest</span>}
        </span>
        <span className="inline-flex items-center gap-1.5 text-meta text-ink-muted">
          <StatusDot tone={running ? 'accent' : 'neutral'} live={running} />
          {attempt.raw_status ?? attempt.status}
        </span>
      </div>
      <dl className="space-y-1 text-meta">
        <MetaRow label="ACUs" value={attempt.acus === null ? '—' : String(attempt.acus)} numeric />
        <MetaRow
          label="Dispatched"
          value={formatRelative(attempt.dispatched_at)}
          title={formatTime(attempt.dispatched_at)}
        />
        <MetaRow
          label="Last reconciled"
          value={formatRelative(attempt.last_reconciled_at)}
          title={formatTime(attempt.last_reconciled_at)}
        />
        {attempt.status_detail && <MetaRow label="Detail" value={attempt.status_detail} />}
      </dl>
      {attempt.error_summary && (
        <p className="rounded-[6px] border border-critical/35 bg-critical/[0.06] px-2 py-1.5 text-meta text-critical">
          {attempt.error_summary}
        </p>
      )}
      {attempt.devin_session_url && (
        <a
          href={attempt.devin_session_url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-meta text-accent hover:underline"
        >
          Open session
          <ArrowUpRight aria-hidden className="h-3 w-3" />
        </a>
      )}
    </div>
  );
}

function MetaRow({
  label,
  value,
  title,
  numeric = false,
}: {
  label: string;
  value: string;
  title?: string;
  numeric?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-ink-muted">{label}</dt>
      <dd className={clsx('truncate text-right text-ink', numeric && 'numeric')} title={title}>
        {value}
      </dd>
    </div>
  );
}

function PullRequests({ pullRequests }: { pullRequests: PullRequestRow[] }) {
  return (
    <Section title="Pull request" id="pull-requests">
      {pullRequests.length === 0 ? (
        <EmptyState
          compact
          icon={GitPullRequestArrow}
          title="No pull request yet"
          hint="One appears here as soon as Devin opens a PR that references this issue."
        />
      ) : (
        <ul className="space-y-3">
          {pullRequests.map((pr) => (
            <li key={pr.id} className="space-y-1">
              <div className="flex items-start justify-between gap-2">
                <a
                  href={pr.url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex min-w-0 items-start gap-1.5 text-body text-ink hover:text-accent"
                >
                  <GitPullRequestArrow
                    aria-hidden
                    className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-muted"
                  />
                  <span className="min-w-0">
                    <span className="numeric text-ink-faint">#{pr.number}</span>{' '}
                    {pr.title ?? 'Untitled pull request'}
                  </span>
                  <ArrowUpRight aria-hidden className="mt-0.5 h-3 w-3 shrink-0 text-ink-faint" />
                </a>
              </div>
              <div className="flex flex-wrap items-center gap-2 pl-5 text-meta text-ink-muted">
                <Tag
                  tone={
                    pr.merged === 1 ? 'positive' : pr.state === 'closed' ? 'critical' : 'accent'
                  }
                >
                  {pr.merged === 1 ? 'Merged' : pr.state}
                </Tag>
                {pr.author_login && <span>@{pr.author_login}</span>}
                <Tooltip label={formatTime(pr.pr_updated_at ?? pr.pr_created_at)}>
                  <span className="numeric">
                    updated {formatRelative(pr.pr_updated_at ?? pr.pr_created_at)}
                  </span>
                </Tooltip>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

function RunMetadata({ task }: { task: TaskRow }) {
  return (
    <Section title="Run metadata" id="run-metadata">
      <dl className="space-y-1 text-meta">
        <MetaRow label="Issue state" value={task.issue_state === 'closed' ? 'Closed' : 'Open'} />
        <MetaRow label="Attempts" value={String(task.attempt_count)} numeric />
        <MetaRow
          label="Queued"
          value={formatRelative(task.queued_at)}
          title={formatTime(task.queued_at)}
        />
        <MetaRow
          label="Dispatched"
          value={formatRelative(task.dispatched_at)}
          title={formatTime(task.dispatched_at)}
        />
        <MetaRow
          label="First PR"
          value={formatRelative(task.first_pr_at)}
          title={formatTime(task.first_pr_at)}
        />
        <MetaRow
          label="Merged"
          value={formatRelative(task.merged_at)}
          title={formatTime(task.merged_at)}
        />
        <MetaRow
          label="Last activity"
          value={formatRelative(task.last_activity_at)}
          title={formatTime(task.last_activity_at)}
        />
      </dl>
      {task.github_comment_url && (
        <a
          href={task.github_comment_url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-meta text-accent hover:underline"
        >
          Status comment on GitHub
          <ArrowUpRight aria-hidden className="h-3 w-3" />
        </a>
      )}
    </Section>
  );
}

const SOURCE_ICONS: Record<string, LucideIcon> = {
  github: CircleDot,
  devin: Bot,
  devin_conductor: Route,
  user: User,
};

interface TimelineGroup {
  key: string;
  events: TaskEventRow[];
}

function groupEvents(events: TaskEventRow[]): TimelineGroup[] {
  const groups: TimelineGroup[] = [];
  for (const event of events) {
    const routine = ROUTINE_EVENTS.has(event.event_type);
    const previous = groups.at(-1);
    if (
      routine &&
      previous &&
      previous.events.length > 0 &&
      ROUTINE_EVENTS.has(previous.events[0]!.event_type)
    ) {
      previous.events.push(event);
    } else {
      groups.push({ key: event.id, events: [event] });
    }
  }
  return groups;
}

function Timeline({ events }: { events: TaskEventRow[] }) {
  const groups = groupEvents(events);
  return (
    <Section title="Activity" id="activity">
      {events.length === 0 ? (
        <EmptyState compact title="No activity recorded" />
      ) : (
        <ol className="space-y-0">
          {groups.map((group) =>
            group.events.length > 2 ? (
              <CollapsedGroup key={group.key} events={group.events} />
            ) : (
              group.events.map((event) => <TimelineEntry key={event.id} event={event} />)
            ),
          )}
        </ol>
      )}
    </Section>
  );
}

function TimelineEntry({ event }: { event: TaskEventRow }) {
  const Icon = SOURCE_ICONS[event.source] ?? CircleDot;
  const strong = STRONG_EVENTS.has(event.event_type);
  return (
    <li className="group relative flex gap-3 pb-3 pl-0.5 last:pb-0">
      <span
        aria-hidden
        className="absolute top-5 bottom-0 left-[9px] w-px bg-border-subtle group-last:hidden"
      />
      <span
        className={clsx(
          'relative z-10 mt-0.5 flex h-[19px] w-[19px] shrink-0 items-center justify-center rounded-full border bg-canvas',
          strong ? 'border-caution/50 text-caution' : 'border-border text-ink-faint',
        )}
      >
        <Icon aria-hidden className="h-3 w-3" />
      </span>
      <div className="flex min-w-0 flex-1 flex-wrap items-baseline justify-between gap-x-3">
        <p className={clsx('min-w-0 text-body', strong ? 'text-ink' : 'text-ink-muted')}>
          {event.summary}
        </p>
        <Tooltip label={formatTime(event.created_at)}>
          <time className="numeric shrink-0 text-meta text-ink-faint">
            {formatRelative(event.created_at)}
          </time>
        </Tooltip>
      </div>
    </li>
  );
}

function CollapsedGroup({ events }: { events: TaskEventRow[] }) {
  const [open, setOpen] = useState(false);
  const last = events.at(-1)!;
  if (open) {
    return (
      <>
        {events.map((event) => (
          <TimelineEntry key={event.id} event={event} />
        ))}
      </>
    );
  }
  return (
    <li className="relative flex gap-3 pb-3 pl-0.5">
      <span aria-hidden className="absolute top-5 bottom-0 left-[9px] w-px bg-border-subtle" />
      <span className="relative z-10 mt-0.5 flex h-[19px] w-[19px] shrink-0 items-center justify-center rounded-full border border-border bg-canvas text-ink-faint">
        <CircleDot aria-hidden className="h-3 w-3" />
      </span>
      <div className="flex min-w-0 flex-1 flex-wrap items-baseline justify-between gap-x-3">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="text-body text-ink-muted transition-colors duration-150 hover:text-ink"
        >
          <span className="numeric">{events.length}</span> status updates
          <ChevronRight aria-hidden className="ml-0.5 inline h-3 w-3" />
        </button>
        <Tooltip label={formatTime(last.created_at)}>
          <time className="numeric shrink-0 text-meta text-ink-faint">
            {formatRelative(last.created_at)}
          </time>
        </Tooltip>
      </div>
    </li>
  );
}

function messageRole(source: string): { label: string; tone: string; icon: LucideIcon } {
  const value = source.toLowerCase();
  if (value.includes('user')) return { label: 'Human', tone: 'border-l-accent', icon: User };
  if (value.includes('devin')) return { label: 'Devin', tone: 'border-l-positive', icon: Bot };
  return { label: source || 'System', tone: 'border-l-border-strong', icon: CircleDot };
}

function Messages({
  messages,
  sessionUrl,
}: {
  messages: DevinMessageRow[];
  sessionUrl: string | null;
}) {
  return (
    <Section
      title="Session transcript"
      id="transcript"
      description="Redacted excerpts of the Devin session. Replies happen in Devin."
      actions={
        sessionUrl && (
          <a
            href={sessionUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-meta text-ink-muted hover:text-ink"
          >
            Continue in Devin
            <ExternalLink aria-hidden className="h-3 w-3" />
          </a>
        )
      }
    >
      {messages.length === 0 ? (
        <EmptyState compact icon={MessageSquare} title="No messages ingested yet" />
      ) : (
        <ul className="space-y-3">
          {messages.map((message) => {
            const role = messageRole(message.source);
            return (
              <li key={message.id} className={clsx('border-l-2 pl-3', role.tone)}>
                <div className="flex items-baseline gap-2">
                  <span className="text-meta font-medium text-ink">{role.label}</span>
                  <Tooltip label={formatTime(message.message_created_at ?? message.created_at)}>
                    <time className="numeric text-meta text-ink-faint">
                      {formatRelative(message.message_created_at ?? message.created_at)}
                    </time>
                  </Tooltip>
                </div>
                <p className="mt-1 max-w-[70ch] text-body whitespace-pre-wrap text-ink-muted">
                  {message.message}
                </p>
              </li>
            );
          })}
        </ul>
      )}
    </Section>
  );
}

function DetailSkeleton() {
  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <Skeleton className="h-2.5 w-24" />
        <Skeleton className="h-5 w-2/5" />
        <Skeleton className="h-2.5 w-72 opacity-70" />
      </div>
      <Divider />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-3">
          {[0, 1, 2, 3, 4].map((row) => (
            <div key={row} className="flex gap-3">
              <Skeleton className="h-[19px] w-[19px] rounded-full" />
              <Skeleton className="h-3 flex-1" />
            </div>
          ))}
        </div>
        <div className="space-y-2">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-2/3" />
        </div>
      </div>
    </div>
  );
}
