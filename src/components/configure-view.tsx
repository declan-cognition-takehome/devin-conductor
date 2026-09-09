'use client';

import { useCallback, useEffect, useState } from 'react';
import type { InstallationRow, RepositoryRow, SettingsRow } from '@/lib/db/types';
import { getJson, patchJson, postJson } from '@/lib/client/api';
import { Card, ErrorState, Skeleton, formatRelative, formatTime } from './ui';

interface StatusResponse {
  settings: SettingsRow;
  installations: InstallationRow[];
  repositories: RepositoryRow[];
  integrations: {
    github: { configured: boolean; org?: string; appSlug?: string; missing?: string[] };
    devin: { configured: boolean; orgId?: string; missing?: string[] };
  };
  queue: {
    pending: number;
    recent: Array<{
      id: string;
      type: string;
      state: string;
      attempts: number;
      maxAttempts: number;
      errorSummary: string | null;
      updatedAt: number;
    }>;
  };
  deliveries: Array<{
    id: string;
    event: string;
    action: string | null;
    state: string;
    repository: string | null;
    receivedAt: number;
  }>;
  worker: { enabled: boolean };
}

export function ConfigureView() {
  const [data, setData] = useState<StatusResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

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

  async function run(key: string, action: () => Promise<string | null>) {
    setBusy(key);
    setNotice(null);
    try {
      const message = await action();
      if (message) setNotice(message);
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  if (error && !data) return <ErrorState message={error} onRetry={() => void load()} />;
  if (!data) return <Skeleton className="h-64 w-full" />;

  const { settings, integrations, repositories, installations } = data;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-lg font-semibold tracking-tight">Configure</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Automation controls and operational status. Secrets are supplied through the environment
          and are never displayed here.
        </p>
      </div>

      {error && <ErrorState message={error} />}
      {notice && (
        <p className="rounded-lg border border-positive/40 bg-positive/5 p-3 text-sm text-positive">
          {notice}
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Automation">
          <div className="space-y-4">
            <label className="flex items-center justify-between gap-4 text-sm">
              <span>
                Pause dispatch
                <span className="block text-xs text-ink-muted">
                  Queued work is retained and resumes when unpaused.
                </span>
              </span>
              <input
                type="checkbox"
                checked={settings.paused === 1}
                disabled={busy === 'settings'}
                onChange={(event) =>
                  void run('settings', async () => {
                    await patchJson('/api/settings', { paused: event.target.checked });
                    return null;
                  })
                }
                className="h-4 w-4 accent-[var(--color-accent)]"
              />
            </label>

            <NumberField
              label="Max concurrent Devin sessions"
              value={settings.max_concurrent_sessions}
              min={1}
              max={20}
              disabled={busy === 'settings'}
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
              nullable
              disabled={busy === 'settings'}
              onCommit={(value) =>
                void run('settings', async () => {
                  await patchJson('/api/settings', { maxAcuLimit: value });
                  return null;
                })
              }
            />

            <NumberField
              label="Poll interval (seconds)"
              value={settings.poll_interval_seconds}
              min={10}
              max={3600}
              disabled={busy === 'settings'}
              onCommit={(value) =>
                void run('settings', async () => {
                  await patchJson('/api/settings', { pollIntervalSeconds: value });
                  return null;
                })
              }
            />
          </div>
        </Card>

        <Card title="Integrations">
          <dl className="space-y-3 text-sm">
            <div className="flex items-start justify-between gap-3">
              <div>
                <dt className="font-medium">GitHub App</dt>
                <dd className="text-xs text-ink-muted">
                  {integrations.github.configured
                    ? `Organization ${integrations.github.org}`
                    : `Missing: ${integrations.github.missing?.join(', ')}`}
                </dd>
              </div>
              <button
                type="button"
                disabled={!integrations.github.configured || busy === 'sync'}
                onClick={() =>
                  void run('sync', async () => {
                    await postJson('/api/github/sync', {});
                    return 'Installation and repositories synced.';
                  })
                }
                className="rounded-md border border-border-subtle px-2.5 py-1 text-xs hover:bg-surface-raised disabled:opacity-50"
              >
                {busy === 'sync' ? 'Syncing…' : 'Sync installation'}
              </button>
            </div>
            <div className="flex items-start justify-between gap-3">
              <div>
                <dt className="font-medium">Devin</dt>
                <dd className="text-xs text-ink-muted">
                  {integrations.devin.configured
                    ? `Organization ${integrations.devin.orgId} · last contact ${formatRelative(settings.last_devin_contact_at)}`
                    : `Missing: ${integrations.devin.missing?.join(', ')}`}
                </dd>
              </div>
              <button
                type="button"
                disabled={!integrations.devin.configured || busy === 'devin'}
                onClick={() =>
                  void run('devin', async () => {
                    await postJson('/api/devin/test', {});
                    return 'Devin API reachable with the configured credential.';
                  })
                }
                className="rounded-md border border-border-subtle px-2.5 py-1 text-xs hover:bg-surface-raised disabled:opacity-50"
              >
                {busy === 'devin' ? 'Testing…' : 'Test connection'}
              </button>
            </div>
            <div>
              <dt className="font-medium">Worker</dt>
              <dd className="text-xs text-ink-muted">
                {data.worker.enabled ? 'Running in this container' : 'Disabled'} ·{' '}
                {data.queue.pending} job(s) ready · last webhook{' '}
                {formatRelative(settings.last_webhook_delivery_at)}
              </dd>
            </div>
          </dl>
        </Card>
      </div>

      <Card
        title="Repositories"
        description="Installing the GitHub App does not enable automation. Enable each repository explicitly."
      >
        {repositories.length === 0 ? (
          <p className="text-sm text-ink-muted">
            No repositories yet. Install the GitHub App on the organization, then sync.
          </p>
        ) : (
          <ul className="divide-y divide-border-subtle/60 text-sm">
            {repositories.map((repo) => (
              <li
                key={repo.github_repo_id}
                className="flex items-center justify-between gap-4 py-2"
              >
                <div>
                  <p>{repo.full_name}</p>
                  <p className="text-xs text-ink-muted">
                    {repo.is_installed === 1 ? 'Installed' : 'App removed'} ·{' '}
                    {repo.is_private === 1 ? 'private' : 'public'}
                  </p>
                </div>
                <label className="flex items-center gap-2 text-xs text-ink-muted">
                  <span>Automation</span>
                  <input
                    type="checkbox"
                    checked={repo.automation_enabled === 1}
                    disabled={repo.is_installed !== 1 || busy === `repo:${repo.github_repo_id}`}
                    onChange={(event) =>
                      void run(`repo:${repo.github_repo_id}`, async () => {
                        await patchJson('/api/repositories', {
                          githubRepoId: repo.github_repo_id,
                          automationEnabled: event.target.checked,
                        });
                        return null;
                      })
                    }
                    className="h-4 w-4 accent-[var(--color-accent)]"
                  />
                </label>
              </li>
            ))}
          </ul>
        )}
        {installations.length > 0 && (
          <p className="mt-3 text-xs text-ink-muted">
            Installation {installations[0]?.installation_id} on {installations[0]?.account_login} (
            {installations[0]?.status}).
          </p>
        )}
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Recent webhook deliveries">
          {data.deliveries.length === 0 ? (
            <p className="text-sm text-ink-muted">No deliveries received yet.</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {data.deliveries.map((delivery) => (
                <li key={delivery.id} className="flex justify-between gap-3">
                  <span>
                    {delivery.event}
                    {delivery.action ? `.${delivery.action}` : ''}{' '}
                    <span className="text-ink-muted">{delivery.repository ?? ''}</span>
                  </span>
                  <span className="text-xs text-ink-muted">
                    {delivery.state} · {formatTime(delivery.receivedAt)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Recent jobs">
          {data.queue.recent.length === 0 ? (
            <p className="text-sm text-ink-muted">The queue is empty.</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {data.queue.recent.map((job) => (
                <li key={job.id} className="flex justify-between gap-3">
                  <span>{job.type}</span>
                  <span className="text-xs text-ink-muted">
                    {job.state} · {job.attempts}/{job.maxAttempts}
                    {job.errorSummary ? ` · ${job.errorSummary}` : ''}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}

function NumberField({
  label,
  hint,
  value,
  min,
  max,
  nullable = false,
  disabled,
  onCommit,
}: {
  label: string;
  hint?: string;
  value: number | null;
  min: number;
  max: number;
  nullable?: boolean;
  disabled?: boolean;
  onCommit: (value: number | null) => void;
}) {
  const [draft, setDraft] = useState(value === null ? '' : String(value));

  useEffect(() => {
    setDraft(value === null ? '' : String(value));
  }, [value]);

  function commit() {
    if (draft.trim() === '') {
      if (nullable && value !== null) onCommit(null);
      return;
    }
    const parsed = Number(draft);
    if (!Number.isInteger(parsed) || parsed < min || parsed > max || parsed === value) return;
    onCommit(parsed);
  }

  return (
    <label className="flex items-center justify-between gap-4 text-sm">
      <span>
        {label}
        {hint && <span className="block text-xs text-ink-muted">{hint}</span>}
      </span>
      <input
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        value={draft}
        disabled={disabled}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        className="w-24 rounded-md border border-border-subtle bg-surface px-2 py-1 text-right text-sm"
      />
    </label>
  );
}
