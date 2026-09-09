'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip as ChartTooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { MetricsSnapshot } from '@/lib/metrics';
import { getJson } from '@/lib/client/api';
import {
  EmptyState,
  ErrorState,
  Metric,
  PageHeader,
  Section,
  Segmented,
  Skeleton,
  formatDuration,
  formatPercent,
} from './ui';

const WINDOWS = [
  { value: '7', label: '7 days' },
  { value: '30', label: '30 days' },
  { value: '90', label: '90 days' },
];

/** Chart colours are read from the same palette as the rest of the interface. */
const CHART = {
  grid: '#20242b',
  axis: '#6d7684',
  surface: '#1d222a',
  border: '#333a45',
  ink: '#e7eaee',
  tasks: '#5b93f5',
  prs: '#5fa97a',
  merges: '#d9a13f',
};

export function ReportView() {
  const [days, setDays] = useState('30');
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

  const header = (
    <PageHeader
      title="Report"
      description="Computed from recorded task, session, and pull request history. Ratios show “—” when there is nothing to divide by."
      actions={
        <Segmented label="Reporting window" options={WINDOWS} value={days} onChange={setDays} />
      }
    />
  );

  if (error) {
    return (
      <div className="space-y-5">
        {header}
        <ErrorState message={error} onRetry={() => void load()} />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="space-y-5">
        {header}
        <ReportSkeleton />
      </div>
    );
  }

  const { kpis, funnel } = data;

  return (
    <div className="space-y-6">
      {header}

      {kpis.totalTasks === 0 ? (
        <EmptyState
          title="No activity in this window"
          hint="Metrics appear once Conductor has processed issues."
        />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-px overflow-hidden rounded-[8px] border border-border-subtle bg-border-subtle sm:grid-cols-4">
            <Metric label="Issues received" value={String(kpis.totalTasks)} className="bg-canvas" />
            <Metric
              label="Dispatch rate"
              value={formatPercent(kpis.dispatchSuccessRate)}
              hint={`${funnel.sessionsDispatched} of ${funnel.tasksEligible} eligible`}
              className="bg-canvas"
            />
            <Metric
              label="PR rate"
              value={formatPercent(kpis.prRate)}
              hint={`${funnel.prsOpened} of ${funnel.sessionsDispatched} sessions`}
              className="bg-canvas"
            />
            <Metric
              label="Merge rate"
              value={formatPercent(kpis.mergeRate)}
              hint={`${funnel.prsMerged} of ${funnel.prsOpened} PRs`}
              className="bg-canvas"
            />
            <Metric
              label="Median time to PR"
              value={formatDuration(kpis.medianTimeToPrMs)}
              className="bg-canvas"
            />
            <Metric
              label="Median time to dispatch"
              value={formatDuration(kpis.medianTimeToFirstDispatchMs)}
              className="bg-canvas"
            />
            <Metric
              label="Needs attention"
              value={String(kpis.needsAttention)}
              className="bg-canvas"
            />
            <Metric label="ACUs consumed" value={String(kpis.totalAcus)} className="bg-canvas" />
          </div>

          <Section id="throughput" title="Daily throughput">
            <div className="h-60 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.daily} margin={{ top: 4, right: 4, bottom: 0, left: -16 }}>
                  <CartesianGrid stroke={CHART.grid} vertical={false} />
                  <XAxis dataKey="day" stroke={CHART.axis} fontSize={11} tickLine={false} />
                  <YAxis stroke={CHART.axis} fontSize={11} allowDecimals={false} tickLine={false} />
                  <ChartTooltip
                    cursor={{ fill: 'rgba(255,255,255,0.03)' }}
                    contentStyle={{
                      background: CHART.surface,
                      border: `1px solid ${CHART.border}`,
                      borderRadius: 8,
                      color: CHART.ink,
                      fontSize: 12,
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: 12, color: CHART.axis }} />
                  <Bar dataKey="tasks" name="Tasks" fill={CHART.tasks} radius={[2, 2, 0, 0]} />
                  <Bar dataKey="prs" name="PRs" fill={CHART.prs} radius={[2, 2, 0, 0]} />
                  <Bar dataKey="merges" name="Merged" fill={CHART.merges} radius={[2, 2, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Section>

          <div className="grid gap-8 lg:grid-cols-2">
            <Section id="repositories" title="Repositories">
              {data.repositories.length === 0 ? (
                <EmptyState compact title="No repository activity" />
              ) : (
                <table className="w-full text-meta">
                  <thead>
                    <tr className="border-b border-border-subtle text-left text-ink-faint">
                      <th scope="col" className="py-1.5 font-normal">
                        Repository
                      </th>
                      {['Tasks', 'PRs', 'Merged', 'ACUs'].map((column) => (
                        <th key={column} scope="col" className="py-1.5 text-right font-normal">
                          {column}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border-subtle">
                    {data.repositories.map((repo) => (
                      <tr key={repo.repositoryFullName}>
                        <td
                          className="max-w-[240px] truncate py-2 text-ink"
                          title={repo.repositoryFullName}
                        >
                          {repo.repositoryFullName}
                        </td>
                        <td className="numeric py-2 text-right text-ink-muted">{repo.tasks}</td>
                        <td className="numeric py-2 text-right text-ink-muted">{repo.prs}</td>
                        <td className="numeric py-2 text-right text-ink-muted">{repo.merged}</td>
                        <td className="numeric py-2 text-right text-ink-muted">{repo.acus}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Section>

            <Section id="failures" title="Needs-attention reasons">
              {data.failures.length === 0 ? (
                <EmptyState compact title="Nothing needs attention in this window" />
              ) : (
                <ul className="divide-y divide-border-subtle text-meta">
                  {data.failures.map((failure) => (
                    <li
                      key={failure.reason}
                      className="flex items-baseline justify-between gap-4 py-2"
                    >
                      <span className="min-w-0 text-ink-muted">{failure.reason}</span>
                      <span className="numeric shrink-0 text-ink">{failure.count}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Section>
          </div>
        </>
      )}
    </div>
  );
}

function ReportSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-[8px] border border-border-subtle bg-border-subtle sm:grid-cols-4">
        {Array.from({ length: 8 }, (_, index) => (
          <div key={index} className="space-y-2 bg-canvas px-3 py-2.5">
            <Skeleton className="h-2.5 w-20" />
            <Skeleton className="h-4 w-12" />
          </div>
        ))}
      </div>
      <Skeleton className="h-60 w-full" />
    </div>
  );
}
