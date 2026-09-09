'use client';

import { useCallback, useEffect, useState } from 'react';
import { BarChart3 } from 'lucide-react';
import { Cell, Funnel, FunnelChart, LabelList, ResponsiveContainer } from 'recharts';
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
  StatusDot,
  formatAcus,
  formatDuration,
  formatPercent,
  formatRelative,
  formatUsd,
} from './ui';

/** The report refreshes on its own so an open tab keeps showing current system state. */
const POLL_MS = 15_000;

const WINDOWS = [
  { value: '7', label: '7 days' },
  { value: '30', label: '30 days' },
  { value: '90', label: '90 days' },
];

/** Chart colours are read from the same palette as the rest of the interface. */
const CHART = {
  axis: '#6d7684',
  ink: '#e7eaee',
  stages: ['#3f6dc4', '#4f86e0', '#5b93f5', '#5fa97a', '#d9a13f'],
};

export function ReportView() {
  const [days, setDays] = useState('30');
  const [data, setData] = useState<MetricsSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshedAt, setRefreshedAt] = useState<number | null>(null);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      try {
        setData(await getJson<MetricsSnapshot>(`/api/metrics?days=${days}`, signal));
        setRefreshedAt(Date.now());
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
    const timer = setInterval(() => void load(), POLL_MS);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [load]);

  const header = (
    <PageHeader
      title="Report"
      icon={BarChart3}
      description="Computed from recorded task, session, and pull request history. Ratios show “—” when there is nothing to divide by."
      meta={
        <span className="inline-flex items-center gap-1.5">
          <StatusDot tone={error ? 'critical' : 'positive'} live={!error} />
          {error
            ? 'Live updates interrupted'
            : `Live · updated ${formatRelative(refreshedAt)}, refreshing every ${POLL_MS / 1000}s`}
        </span>
      }
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
  const stages = [
    { stage: 'Issues received', value: funnel.issuesReceived },
    { stage: 'Eligible', value: funnel.tasksEligible },
    { stage: 'Dispatched', value: funnel.sessionsDispatched },
    { stage: 'PRs opened', value: funnel.prsOpened },
    { stage: 'Merged', value: funnel.prsMerged },
  ];

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
            <Metric
              label="ACUs consumed"
              value={formatAcus(kpis.totalAcus)}
              hint={
                kpis.totalAcus === null
                  ? 'No metered usage reported yet'
                  : kpis.costsEstimated
                    ? 'Estimated from session transcript size'
                    : undefined
              }
              className="bg-canvas"
            />
            <Metric
              label={kpis.costsEstimated ? 'Spend (est.)' : 'Spend'}
              value={formatUsd(kpis.totalCostUsd)}
              hint={
                kpis.acuRateUsd === null
                  ? 'Set an ACU rate in Configure'
                  : `at ${formatUsd(kpis.acuRateUsd)} per ACU`
              }
              className="bg-canvas"
            />
            <Metric
              label={kpis.costsEstimated ? 'Median cost per PR (est.)' : 'Median cost per PR'}
              value={formatUsd(kpis.medianPrCostUsd)}
              className="bg-canvas"
            />
          </div>

          <Section
            id="throughput"
            title="Throughput funnel"
            description={`Issues narrowing to merged pull requests over the last ${data.windowDays} days.`}
          >
            <div className="h-72 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <FunnelChart margin={{ top: 8, right: 132, bottom: 8, left: 132 }}>
                  <Funnel dataKey="value" data={stages} isAnimationActive={false} stroke="none">
                    {stages.map((entry, index) => (
                      <Cell key={entry.stage} fill={CHART.stages[index]} />
                    ))}
                    <LabelList
                      dataKey="stage"
                      position="left"
                      offset={12}
                      fill={CHART.axis}
                      stroke="none"
                      fontSize={12}
                    />
                    <LabelList
                      dataKey="value"
                      position="right"
                      offset={12}
                      fill={CHART.ink}
                      stroke="none"
                      fontSize={12}
                    />
                  </Funnel>
                </FunnelChart>
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
                      {['Tasks', 'PRs', 'Merged', 'ACUs', 'Cost'].map((column) => (
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
                        <td className="numeric py-2 text-right text-ink-muted">
                          {formatAcus(repo.acus)}
                        </td>
                        <td className="numeric py-2 text-right text-ink-muted">
                          {formatUsd(repo.costUsd)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Section>

            <Section
              id="pr-costs"
              title="Pull request costs"
              description={
                kpis.acuRateUsd === null
                  ? 'Set an ACU rate in Configure to price these sessions.'
                  : undefined
              }
            >
              {data.pullRequestCosts.length === 0 ? (
                <EmptyState compact title="No pull requests in this window" />
              ) : (
                <table className="w-full text-meta">
                  <thead>
                    <tr className="border-b border-border-subtle text-left text-ink-faint">
                      <th scope="col" className="py-1.5 font-normal">
                        Pull request
                      </th>
                      {['ACUs', 'Cost'].map((column) => (
                        <th key={column} scope="col" className="py-1.5 text-right font-normal">
                          {column}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border-subtle">
                    {data.pullRequestCosts.map((pr) => (
                      <tr key={pr.url}>
                        <td className="max-w-[240px] truncate py-2 text-ink">
                          <a
                            href={pr.url}
                            target="_blank"
                            rel="noreferrer"
                            className="hover:text-accent"
                            title={`${pr.repositoryFullName}#${pr.number}`}
                          >
                            {pr.repositoryFullName}#{pr.number}
                          </a>
                        </td>
                        <td className="numeric py-2 text-right text-ink-muted">
                          {formatAcus(pr.acus)}
                        </td>
                        <td className="numeric py-2 text-right text-ink-muted">
                          {formatUsd(pr.costUsd)}
                          {pr.estimated && pr.costUsd !== null && (
                            <span className="ml-1 text-ink-faint">est.</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
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
        {Array.from({ length: 10 }, (_, index) => (
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
