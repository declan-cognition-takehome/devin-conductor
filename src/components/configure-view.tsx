'use client';

import { useCallback, useEffect, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Bot, Cpu, GitBranch, Inbox, RadioTower } from 'lucide-react';
import clsx from 'clsx';
import type { InstallationRow, RepositoryRow, SettingsRow } from '@/lib/db/types';
import { getJson, patchJson, postJson } from '@/lib/client/api';
import {
  Button,
  ConfirmDialog,
  Divider,
  EmptyState,
  ErrorState,
  HealthIndicator,
  NumberField,
  PageHeader,
  Section,
  SettingRow,
  Skeleton,
  Switch,
  Tag,
  Tooltip,
  formatRelative,
  formatTime,
  useToast,
} from './ui';
import type { Tone } from './ui';

interface JobSummary {
  id: string;
  type: string;
  state: string;
  attempts: number;
  maxAttempts: number;
  errorSummary: string | null;
  updatedAt: number;
}

interface DeliverySummary {
  id: string;
  event: string;
  action: string | null;
  state: string;
  repository: string | null;
  receivedAt: number;
}

interface StatusResponse {
  settings: SettingsRow;
  installations: InstallationRow[];
  repositories: RepositoryRow[];
  integrations: {
    github: { configured: boolean; org?: string; appSlug?: string; missing?: string[] };
    devin: { configured: boolean; orgId?: string; missing?: string[] };
  };
  queue: { pending: number; recent: JobSummary[] };
  deliveries: DeliverySummary[];
  worker: { enabled: boolean };
}

const SECTIONS = [
  { id: 'automation', label: 'Automation' },
  { id: 'integrations', label: 'Integrations' },
  { id: 'repositories', label: 'Repositories' },
  { id: 'deliveries', label: 'Webhook deliveries' },
  { id: 'jobs', label: 'Job queue' },
];

export function ConfigureView() {
  const [data, setData] = useState<StatusResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmPause, setConfirmPause] = useState(false);
  const [confirmRepo, setConfirmRepo] = useState<RepositoryRow | null>(null);
  const toast = useToast();

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      setData(await getJson<StatusResponse>('/api/status', signal));
      setError(null);
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      setError((err as Error).message);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const run = useCallback(
    async (key: string, action: () => Promise<string | null>) => {
      setBusy(key);
      try {
        const message = await action();
        if (message) toast.show('success', message);
        await load();
      } catch (err) {
        toast.show('error', (err as Error).message);
      } finally {
        setBusy(null);
      }
    },
    [load, toast],
  );

  if (error && !data) return <ErrorState message={error} onRetry={() => void load()} />;
  if (!data) return <ConfigureSkeleton />;

  const { settings, integrations, repositories, installations, worker, queue } = data;
  const settingsBusy = busy === 'settings';

  function setPaused(paused: boolean) {
    void run('settings', async () => {
      await patchJson('/api/settings', { paused });
      setConfirmPause(false);
      return paused ? 'Dispatch paused. Queued work is retained.' : 'Dispatch resumed.';
    });
  }

  function setAutomation(repo: RepositoryRow, enabled: boolean) {
    void run(`repo:${repo.github_repo_id}`, async () => {
      await patchJson('/api/repositories', {
        githubRepoId: repo.github_repo_id,
        automationEnabled: enabled,
      });
      setConfirmRepo(null);
      return `Automation ${enabled ? 'enabled' : 'disabled'} for ${repo.full_name}.`;
    });
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Configure"
        description="Automation controls and operational status. Secrets are supplied through the environment and are never displayed here."
      />

      {error && <ErrorState message={error} onRetry={() => void load()} />}

      <div className="grid gap-8 lg:grid-cols-[168px_minmax(0,1fr)]">
        <nav
          aria-label="Settings sections"
          className="hidden lg:block lg:sticky lg:top-6 lg:self-start"
        >
          <ul className="space-y-0.5 text-meta">
            {SECTIONS.map((section) => (
              <li key={section.id}>
                <a
                  href={`#${section.id}`}
                  className="block rounded-[6px] px-2 py-1.5 text-ink-muted transition-colors duration-150 hover:bg-surface hover:text-ink"
                >
                  {section.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <div className="min-w-0 space-y-9">
          <Section
            id="automation"
            title="Automation"
            description="Applies to every repository. Changes save immediately."
          >
            <div className="divide-y divide-border-subtle">
              <SettingRow
                label={settings.paused === 1 ? 'Dispatch paused' : 'Dispatch running'}
                description="When paused, Conductor keeps accepting webhooks and queues work, but starts no new Devin sessions."
                control={
                  <>
                    <span
                      className={clsx(
                        'text-meta',
                        settings.paused === 1 ? 'text-caution' : 'text-ink-muted',
                      )}
                    >
                      {settings.paused === 1 ? 'Paused' : 'Running'}
                    </span>
                    <Switch
                      label="Pause dispatch"
                      checked={settings.paused === 1}
                      disabled={settingsBusy}
                      onChange={(checked) => (checked ? setConfirmPause(true) : setPaused(false))}
                    />
                  </>
                }
              />
              <NumberField
                label="Max concurrent Devin sessions"
                value={settings.max_concurrent_sessions}
                min={1}
                max={20}
                unit="sessions"
                disabled={settingsBusy}
                onCommit={(value) =>
                  void run('settings', async () => {
                    await patchJson('/api/settings', { maxConcurrentSessions: value });
                    return null;
                  })
                }
              />
              <NumberField
                label="ACU ceiling per session"
                hint="Empty means no explicit ceiling is sent to Devin."
                value={settings.max_acu_limit}
                min={1}
                max={1000}
                unit="ACUs"
                nullable
                disabled={settingsBusy}
                onCommit={(value) =>
                  void run('settings', async () => {
                    await patchJson('/api/settings', { maxAcuLimit: value });
                    return null;
                  })
                }
              />
              <NumberField
                label="Session poll interval"
                hint="How often the worker reconciles a running Devin session."
                value={settings.poll_interval_seconds}
                min={10}
                max={3600}
                unit="seconds"
                disabled={settingsBusy}
                onCommit={(value) =>
                  void run('settings', async () => {
                    await patchJson('/api/settings', { pollIntervalSeconds: value });
                    return null;
                  })
                }
              />
            </div>
          </Section>

          <Section id="integrations" title="Integrations">
            <div className="divide-y divide-border-subtle">
              <IntegrationRow
                icon={GitBranch}
                name="GitHub App"
                detail={
                  integrations.github.configured ? (
                    <>
                      Organization {integrations.github.org}
                      {integrations.github.appSlug ? ` · app ${integrations.github.appSlug}` : ''}
                    </>
                  ) : (
                    `Missing configuration: ${integrations.github.missing?.join(', ')}`
                  )
                }
                health={
                  integrations.github.configured
                    ? { tone: 'positive', label: 'Connected' }
                    : { tone: 'critical', label: 'Not configured' }
                }
                lastContact={settings.last_webhook_delivery_at}
                lastContactLabel="Last webhook"
                action={
                  <Button
                    disabled={!integrations.github.configured}
                    loading={busy === 'sync'}
                    onClick={() =>
                      void run('sync', async () => {
                        await postJson('/api/github/sync', {});
                        return 'Installation and repositories synced.';
                      })
                    }
                  >
                    Sync installation
                  </Button>
                }
                footer={
                  installations[0] && (
                    <span className="text-meta text-ink-faint">
                      Installation{' '}
                      <Tooltip label={`Installation ID ${installations[0].installation_id}`}>
                        <span className="numeric">
                          #{String(installations[0].installation_id).slice(-6)}
                        </span>
                      </Tooltip>{' '}
                      on {installations[0].account_login} · {installations[0].status}
                    </span>
                  )
                }
              />
              <IntegrationRow
                icon={Bot}
                name="Devin"
                detail={
                  integrations.devin.configured ? (
                    <>
                      Organization{' '}
                      <Tooltip label={integrations.devin.orgId ?? ''}>
                        <span className="numeric">
                          {truncateId(integrations.devin.orgId ?? '')}
                        </span>
                      </Tooltip>
                    </>
                  ) : (
                    `Missing configuration: ${integrations.devin.missing?.join(', ')}`
                  )
                }
                health={
                  integrations.devin.configured
                    ? { tone: 'positive', label: 'Connected' }
                    : { tone: 'critical', label: 'Not configured' }
                }
                lastContact={settings.last_devin_contact_at}
                lastContactLabel="Last contact"
                action={
                  <Button
                    disabled={!integrations.devin.configured}
                    loading={busy === 'devin'}
                    onClick={() =>
                      void run('devin', async () => {
                        await postJson('/api/devin/test', {});
                        return 'Devin API reachable with the configured credential.';
                      })
                    }
                  >
                    Test connection
                  </Button>
                }
              />
              <IntegrationRow
                icon={Cpu}
                name="Worker"
                detail={
                  worker.enabled
                    ? 'Running in this container'
                    : 'Disabled. Queued jobs are not processed.'
                }
                health={
                  worker.enabled
                    ? { tone: 'positive', label: 'Running' }
                    : { tone: 'caution', label: 'Disabled' }
                }
                footer={
                  <span className="numeric text-meta text-ink-faint">
                    {queue.pending} job{queue.pending === 1 ? '' : 's'} ready
                  </span>
                }
              />
            </div>
          </Section>

          <Section
            id="repositories"
            title="Repositories"
            description="Installing the GitHub App does not enable automation. Enable each repository explicitly."
          >
            {repositories.length === 0 ? (
              <EmptyState
                title="No repositories yet"
                hint="Install the GitHub App on the organization, then sync the installation."
              />
            ) : (
              <ul className="divide-y divide-border-subtle">
                {repositories.map((repo) => (
                  <li
                    key={repo.github_repo_id}
                    className="flex items-center justify-between gap-4 py-2.5"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-body text-ink" title={repo.full_name}>
                        {repo.full_name}
                      </p>
                      <p className="mt-0.5 flex items-center gap-2 text-meta text-ink-muted">
                        <span>{repo.is_private === 1 ? 'Private' : 'Public'}</span>
                        <span aria-hidden>·</span>
                        <span>{repo.is_installed === 1 ? 'App installed' : 'App removed'}</span>
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <span className="hidden text-meta text-ink-muted sm:inline">
                        {repo.automation_enabled === 1 ? 'Automation on' : 'Automation off'}
                      </span>
                      <Switch
                        label={`Automation for ${repo.full_name}`}
                        checked={repo.automation_enabled === 1}
                        disabled={repo.is_installed !== 1 || busy === `repo:${repo.github_repo_id}`}
                        onChange={(checked) =>
                          checked ? setAutomation(repo, true) : setConfirmRepo(repo)
                        }
                      />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section
            id="deliveries"
            title="Webhook deliveries"
            description="The ten most recent deliveries received from GitHub."
          >
            {data.deliveries.length === 0 ? (
              <EmptyState compact icon={RadioTower} title="No deliveries received yet" />
            ) : (
              <OperationalTable
                columns={['Event', 'Repository', 'State', 'Received']}
                rows={data.deliveries.map((delivery) => ({
                  key: delivery.id,
                  cells: [
                    <span key="event" className="text-ink">
                      {delivery.event}
                      {delivery.action ? `.${delivery.action}` : ''}
                    </span>,
                    <span key="repo" className="block truncate" title={delivery.repository ?? ''}>
                      {delivery.repository ?? '—'}
                    </span>,
                    <Tag key="state" tone={deliveryTone(delivery.state)}>
                      {delivery.state}
                    </Tag>,
                    <Tooltip key="time" label={formatTime(delivery.receivedAt)}>
                      <span className="numeric">{formatRelative(delivery.receivedAt)}</span>
                    </Tooltip>,
                  ],
                }))}
              />
            )}
          </Section>

          <Section
            id="jobs"
            title="Job queue"
            description={`${queue.pending} job${queue.pending === 1 ? '' : 's'} ready to run.`}
          >
            {queue.recent.length === 0 ? (
              <EmptyState compact icon={Inbox} title="The queue is empty" />
            ) : (
              <OperationalTable
                columns={['Job', 'State', 'Attempts', 'Updated']}
                rows={queue.recent.map((job) => ({
                  key: job.id,
                  emphasis: job.state === 'failed',
                  cells: [
                    <span key="type" className="block min-w-0">
                      <span className="text-ink">{job.type}</span>
                      {job.errorSummary && (
                        <span
                          className="mt-0.5 block truncate text-meta text-critical"
                          title={job.errorSummary}
                        >
                          {job.errorSummary}
                        </span>
                      )}
                    </span>,
                    <Tag key="state" tone={jobTone(job.state)}>
                      {job.state}
                    </Tag>,
                    <span key="attempts" className="numeric">
                      {job.attempts}/{job.maxAttempts}
                    </span>,
                    <Tooltip key="time" label={formatTime(job.updatedAt)}>
                      <span className="numeric">{formatRelative(job.updatedAt)}</span>
                    </Tooltip>,
                  ],
                }))}
              />
            )}
          </Section>
        </div>
      </div>

      <ConfirmDialog
        open={confirmPause}
        title="Pause dispatch?"
        body="Conductor keeps ingesting webhooks and queueing work, but no new Devin sessions start until you resume. Running sessions are unaffected."
        confirmLabel="Pause dispatch"
        busy={settingsBusy}
        onConfirm={() => setPaused(true)}
        onCancel={() => setConfirmPause(false)}
      />

      <ConfirmDialog
        open={confirmRepo !== null}
        title="Disable automation?"
        body={
          <>
            New issues in <span className="text-ink">{confirmRepo?.full_name}</span> will no longer
            be dispatched to Devin. Work already queued for this repository stops being picked up.
          </>
        }
        confirmLabel="Disable automation"
        destructive
        busy={busy === `repo:${confirmRepo?.github_repo_id}`}
        onConfirm={() => confirmRepo && setAutomation(confirmRepo, false)}
        onCancel={() => setConfirmRepo(null)}
      />
    </div>
  );
}

function truncateId(value: string): string {
  return value.length > 12 ? `${value.slice(0, 6)}…${value.slice(-4)}` : value;
}

function deliveryTone(state: string): Tone {
  if (state === 'failed') return 'critical';
  if (state === 'processed' || state === 'done') return 'positive';
  return 'neutral';
}

function jobTone(state: string): Tone {
  if (state === 'failed') return 'critical';
  if (state === 'done') return 'positive';
  if (state === 'claimed') return 'accent';
  return 'neutral';
}

function IntegrationRow({
  icon: Icon,
  name,
  detail,
  health,
  lastContact,
  lastContactLabel,
  action,
  footer,
}: {
  icon: LucideIcon;
  name: string;
  detail: React.ReactNode;
  health: { tone: Tone; label: string };
  lastContact?: number | null;
  lastContactLabel?: string;
  action?: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2 py-3.5 first:pt-0 last:pb-0">
      <div className="flex min-w-0 gap-3">
        <Icon aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-ink-muted" />
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-body font-medium text-ink">
            {name}
            <HealthIndicator tone={health.tone} label={health.label} />
          </p>
          <p className="mt-0.5 text-meta text-ink-muted">{detail}</p>
          {lastContact !== undefined && (
            <p className="mt-0.5 text-meta text-ink-faint">
              {lastContactLabel}{' '}
              <Tooltip label={formatTime(lastContact)}>
                <span className="numeric">{formatRelative(lastContact)}</span>
              </Tooltip>
            </p>
          )}
          {footer && <div className="mt-0.5">{footer}</div>}
        </div>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

function OperationalTable({
  columns,
  rows,
}: {
  columns: string[];
  rows: Array<{ key: string; cells: React.ReactNode[]; emphasis?: boolean }>;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[520px] text-meta">
        <thead>
          <tr className="border-b border-border-subtle text-left text-ink-faint">
            {columns.map((column, index) => (
              <th
                key={column}
                scope="col"
                className={clsx(
                  'py-1.5 pr-4 font-normal',
                  index === columns.length - 1 && 'pr-0 text-right',
                )}
              >
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border-subtle">
          {rows.map((row) => (
            <tr key={row.key} className={clsx(row.emphasis ? 'text-ink' : 'text-ink-muted')}>
              {row.cells.map((cell, index) => (
                <td
                  key={index}
                  className={clsx(
                    'max-w-[240px] py-2 pr-4 align-top',
                    index === row.cells.length - 1 && 'pr-0 text-right whitespace-nowrap',
                  )}
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ConfigureSkeleton() {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Skeleton className="h-5 w-32" />
        <Skeleton className="h-3 w-96 opacity-70" />
      </div>
      <Divider />
      <div className="grid gap-8 lg:grid-cols-[168px_minmax(0,1fr)]">
        <div className="hidden space-y-2 lg:block">
          {[0, 1, 2, 3, 4].map((row) => (
            <Skeleton key={row} className="h-3 w-24" />
          ))}
        </div>
        <div className="space-y-4">
          {[0, 1, 2, 3, 4, 5].map((row) => (
            <div key={row} className="flex items-center justify-between gap-8">
              <Skeleton className="h-3 w-1/3" />
              <Skeleton className="h-5 w-16" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
