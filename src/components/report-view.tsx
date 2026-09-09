'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { MetricsSnapshot } from '@/lib/metrics';
import { getJson } from '@/lib/client/api';
import {
  Card,
  EmptyState,
  ErrorState,
  Metric,
  Skeleton,
  formatDuration,
  formatPercent,
} from './ui';

const WINDOWS = [7, 30, 90];

export function ReportView() {
  const [days, setDays] = useState(30);
  const [data, setData] = useState<MetricsSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      try {
        setData(await getJson<MetricsSnapshot>(`/api/metrics?days=${days}`, signal));
        setError(null);
      } catch (err) {
        if ((err as Error).name === 'AbortError') return;
        setError((err as Error).message);
      }
    },
    [days],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  if (error) return <ErrorState message={error} onRetry={() => void load()} />;
  if (!data) return <Skeleton className="h-64 w-full" />;

  const { kpis, funnel } = data;
  const noData = kpis.totalTasks === 0;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Report</h1>
          <p className="mt-1 text-sm text-ink-muted">
            Computed from recorded task, session, and pull request history. Ratios show “—” when
            there is nothing to divide by.
          </p>
        </div>
        <div role="group" aria-label="Reporting window" className="flex gap-1">
          {WINDOWS.map((window) => (
            <button
              key={window}
              type="button"
              aria-pressed={days === window}
              onClick={() => setDays(window)}
              className={
                days === window
                  ? 'rounded-md border border-accent/50 bg-surface-raised px-2.5 py-1 text-xs'
                  : 'rounded-md border border-border-subtle px-2.5 py-1 text-xs text-ink-muted hover:text-ink'
              }
            >
              {window}d
            </button>
          ))}
        </div>
      </div>

      {noData ? (
        <EmptyState
          title="No activity in this window"
          hint="Metrics appear once Conductor has processed issues."
        />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Metric label="Issues received" value={String(kpis.totalTasks)} />
            <Metric
              label="Dispatch rate"
              value={formatPercent(kpis.dispatchSuccessRate)}
              hint={`${funnel.sessionsDispatched} of ${funnel.tasksEligible} eligible`}
            />
            <Metric
              label="PR rate"
              value={formatPercent(kpis.prRate)}
              hint={`${funnel.prsOpened} of ${funnel.sessionsDispatched} sessions`}
            />
            <Metric
              label="Merge rate"
              value={formatPercent(kpis.mergeRate)}
              hint={`${funnel.prsMerged} of ${funnel.prsOpened} PRs`}
            />
            <Metric label="Median time to PR" value={formatDuration(kpis.medianTimeToPrMs)} />
            <Metric
              label="Median time to dispatch"
              value={formatDuration(kpis.medianTimeToFirstDispatchMs)}
            />
            <Metric label="Needs attention" value={String(kpis.needsAttention)} />
            <Metric label="ACUs consumed" value={String(kpis.totalAcus)} />
          </div>

          <Card title="Daily throughput">
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.daily}>
                  <CartesianGrid stroke="#232c3d" vertical={false} />
                  <XAxis dataKey="day" stroke="#97a3b8" fontSize={11} />
                  <YAxis stroke="#97a3b8" fontSize={11} allowDecimals={false} />
                  <Tooltip
                    contentStyle={{
                      background: '#121722',
                      border: '1px solid #232c3d',
                      borderRadius: 8,
                      color: '#e6ebf5',
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: 12, color: '#97a3b8' }} />
                  <Bar dataKey="tasks" name="Tasks" fill="#6ea8fe" />
                  <Bar dataKey="prs" name="PRs" fill="#4ade80" />
                  <Bar dataKey="merges" name="Merged" fill="#fbbf24" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card title="Repositories">
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-ink-muted">
                  <tr>
                    <th scope="col" className="py-1 font-medium">
                      Repository
                    </th>
                    <th scope="col" className="py-1 text-right font-medium">
                      Tasks
                    </th>
                    <th scope="col" className="py-1 text-right font-medium">
                      PRs
                    </th>
                    <th scope="col" className="py-1 text-right font-medium">
                      Merged
                    </th>
                    <th scope="col" className="py-1 text-right font-medium">
                      ACUs
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.repositories.map((repo) => (
                    <tr key={repo.repositoryFullName} className="border-t border-border-subtle/60">
                      <td className="py-1.5">{repo.repositoryFullName}</td>
                      <td className="py-1.5 text-right tabular-nums">{repo.tasks}</td>
                      <td className="py-1.5 text-right tabular-nums">{repo.prs}</td>
                      <td className="py-1.5 text-right tabular-nums">{repo.merged}</td>
                      <td className="py-1.5 text-right tabular-nums">{repo.acus}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>

            <Card title="Needs-attention reasons">
              {data.failures.length === 0 ? (
                <p className="text-sm text-ink-muted">No tasks need attention in this window.</p>
              ) : (
                <ul className="space-y-1 text-sm">
                  {data.failures.map((failure) => (
                    <li key={failure.reason} className="flex justify-between">
                      <span>{failure.reason}</span>
                      <span className="tabular-nums text-ink-muted">{failure.count}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
