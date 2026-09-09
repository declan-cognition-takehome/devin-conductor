import { db } from './db';
import { getSettings } from './db/store';

/**
 * Every figure here is computed from persisted rows. Ratios return null when the
 * denominator is zero so the UI can show "—" instead of a fabricated 0%.
 */

export interface Funnel {
  issuesReceived: number;
  tasksEligible: number;
  sessionsDispatched: number;
  prsOpened: number;
  prsMerged: number;
}

export interface Kpis {
  totalTasks: number;
  ignoredTasks: number;
  eligibleTasks: number;
  dispatchSuccessRate: number | null;
  prRate: number | null;
  mergeRate: number | null;
  needsAttention: number;
  /** Null when no session has reported metered usage yet, so the UI can say "unknown". */
  totalAcus: number | null;
  acuRateUsd: number | null;
  /** True when at least one session in the window was priced from runtime rather than metered usage. */
  costsEstimated: boolean;
  totalCostUsd: number | null;
  medianPrCostUsd: number | null;
  medianTimeToPrMs: number | null;
  medianTimeToFirstDispatchMs: number | null;
}

export interface DailyPoint {
  day: string;
  tasks: number;
  prs: number;
  merges: number;
}

export interface RepositoryStat {
  repositoryFullName: string;
  tasks: number;
  prs: number;
  merged: number;
  needsAttention: number;
  acus: number | null;
  costUsd: number | null;
}

export interface AuthorStat {
  authorLogin: string;
  tasks: number;
  merged: number;
}

export interface PullRequestCost {
  url: string;
  repositoryFullName: string;
  number: number;
  merged: boolean;
  acus: number | null;
  costUsd: number | null;
  estimated: boolean;
}

export interface MetricsSnapshot {
  funnel: Funnel;
  kpis: Kpis;
  daily: DailyPoint[];
  repositories: RepositoryStat[];
  authors: AuthorStat[];
  pullRequestCosts: PullRequestCost[];
  windowDays: number;
  generatedAt: number;
}

/**
 * Devin meters roughly one ACU per fifteen minutes of session work. Self-serve accounts are
 * billed in on-demand credits and the API reports no ACUs for them, so a session's runtime
 * stands in for its usage and every figure derived that way is labelled as an estimate.
 */
const ESTIMATED_MS_PER_ACU = 15 * 60 * 1000;
const MIN_ESTIMATED_ACUS = 0.25;

function acusExpression(alias: string, estimate: boolean): string {
  const metered = `${alias}.acus`;
  if (!estimate) return metered;
  const ranFor = `COALESCE(${alias}.terminal_at, ${alias}.last_reconciled_at, ${alias}.updated_at)
     - COALESCE(${alias}.dispatched_at, ${alias}.created_at)`;
  return `CASE
     WHEN ${metered} IS NOT NULL THEN ${metered}
     WHEN ${alias}.devin_session_id IS NULL THEN NULL
     ELSE MAX(${MIN_ESTIMATED_ACUS}, (${ranFor}) * 1.0 / ${ESTIMATED_MS_PER_ACU})
   END`;
}

function ratio(numerator: number, denominator: number): number | null {
  return denominator > 0 ? numerator / denominator : null;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle] ?? null;
  const low = sorted[middle - 1] ?? 0;
  const high = sorted[middle] ?? 0;
  return (low + high) / 2;
}

export function collectMetrics(windowDays = 30): MetricsSnapshot {
  const since = Date.now() - windowDays * 24 * 60 * 60 * 1000;
  const conn = db();

  const counts = conn
    .prepare<
      [number],
      {
        total: number;
        ignored: number;
        dispatched: number;
        needs_attention: number;
        merged: number;
      }
    >(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN ui_state = 'ignored' THEN 1 ELSE 0 END) AS ignored,
              SUM(CASE WHEN dispatched_at IS NOT NULL THEN 1 ELSE 0 END) AS dispatched,
              SUM(CASE WHEN ui_state = 'needs_attention' THEN 1 ELSE 0 END) AS needs_attention,
              SUM(CASE WHEN ui_state = 'merged' THEN 1 ELSE 0 END) AS merged
       FROM tasks WHERE created_at >= ?`,
    )
    .get(since);

  const prCounts = conn
    .prepare<[number], { opened: number; merged: number }>(
      `SELECT COUNT(*) AS opened, SUM(merged) AS merged FROM pull_requests
       WHERE created_at >= ? AND task_id IS NOT NULL`,
    )
    .get(since);

  const total = counts?.total ?? 0;
  const ignored = counts?.ignored ?? 0;
  const eligible = total - ignored;
  const dispatched = counts?.dispatched ?? 0;
  const prsOpened = prCounts?.opened ?? 0;
  const prsMerged = prCounts?.merged ?? 0;

  const settings = getSettings();
  const estimate = settings.estimate_unmetered_costs === 1;
  const attemptAcus = acusExpression('a', estimate);

  const acuRow = conn
    .prepare<[number], { total: number | null; estimated: number }>(
      `SELECT SUM(${attemptAcus}) AS total,
              SUM(CASE WHEN a.acus IS NULL AND a.devin_session_id IS NOT NULL THEN 1 ELSE 0 END)
                AS estimated
       FROM devin_session_attempts a WHERE a.created_at >= ?`,
    )
    .get(since);
  const totalAcus = acuRow?.total ?? null;
  const acuRateUsd = settings.acu_rate_usd;
  const cost = (acus: number | null): number | null =>
    acus === null || acuRateUsd === null ? null : acus * acuRateUsd;

  const timeToPr = conn
    .prepare<[number], { ms: number }>(
      `SELECT (first_pr_at - queued_at) AS ms FROM tasks
       WHERE created_at >= ? AND first_pr_at IS NOT NULL AND queued_at IS NOT NULL`,
    )
    .all(since)
    .map((row) => row.ms)
    .filter((ms) => ms >= 0);

  const timeToDispatch = conn
    .prepare<[number], { ms: number }>(
      `SELECT (dispatched_at - queued_at) AS ms FROM tasks
       WHERE created_at >= ? AND dispatched_at IS NOT NULL AND queued_at IS NOT NULL`,
    )
    .all(since)
    .map((row) => row.ms)
    .filter((ms) => ms >= 0);

  const daily = conn
    .prepare<[number], DailyPoint>(
      `SELECT date(created_at / 1000, 'unixepoch') AS day,
              COUNT(*) AS tasks,
              SUM(CASE WHEN first_pr_at IS NOT NULL THEN 1 ELSE 0 END) AS prs,
              SUM(CASE WHEN merged_at IS NOT NULL THEN 1 ELSE 0 END) AS merges
       FROM tasks WHERE created_at >= ?
       GROUP BY day ORDER BY day ASC`,
    )
    .all(since);

  const repositories = conn
    .prepare<[number], Omit<RepositoryStat, 'costUsd'>>(
      `SELECT t.repository_full_name AS repositoryFullName,
              COUNT(*) AS tasks,
              SUM(CASE WHEN t.first_pr_at IS NOT NULL THEN 1 ELSE 0 END) AS prs,
              SUM(CASE WHEN t.ui_state = 'merged' THEN 1 ELSE 0 END) AS merged,
              SUM(CASE WHEN t.ui_state = 'needs_attention' THEN 1 ELSE 0 END) AS needsAttention,
              (SELECT SUM(${attemptAcus}) FROM devin_session_attempts a WHERE a.task_id = t.id)
                AS acus
       FROM tasks t WHERE t.created_at >= ?
       GROUP BY t.repository_full_name ORDER BY tasks DESC`,
    )
    .all(since)
    .map((repo) => ({ ...repo, costUsd: cost(repo.acus) }));

  const authors = conn
    .prepare<[number], AuthorStat>(
      `SELECT author_login AS authorLogin,
              COUNT(*) AS tasks,
              SUM(CASE WHEN ui_state = 'merged' THEN 1 ELSE 0 END) AS merged
       FROM tasks WHERE created_at >= ? AND ui_state != 'ignored'
       GROUP BY author_login ORDER BY tasks DESC LIMIT 25`,
    )
    .all(since);

  /**
   * A pull request costs a share of its session: one session can open several, and only the
   * session is metered, so its ACUs are divided evenly across the PRs it produced.
   */
  const pullRequestCosts: PullRequestCost[] = conn
    .prepare<
      [number],
      {
        url: string;
        repositoryFullName: string;
        number: number;
        merged: number;
        acus: number | null;
        estimated: number;
      }
    >(
      `SELECT p.url AS url,
              p.repository_full_name AS repositoryFullName,
              p.number AS number,
              p.merged AS merged,
              (SELECT (${attemptAcus}) * 1.0 / (SELECT COUNT(*) FROM pull_requests s WHERE s.attempt_id = p.attempt_id)
               FROM devin_session_attempts a WHERE a.id = p.attempt_id) AS acus,
              (SELECT CASE WHEN a.acus IS NULL THEN 1 ELSE 0 END
               FROM devin_session_attempts a WHERE a.id = p.attempt_id) AS estimated
       FROM pull_requests p
       WHERE p.created_at >= ? AND p.task_id IS NOT NULL
       ORDER BY p.created_at DESC`,
    )
    .all(since)
    .map((row) => ({
      url: row.url,
      repositoryFullName: row.repositoryFullName,
      number: row.number,
      merged: row.merged === 1,
      acus: row.acus,
      costUsd: cost(row.acus),
      estimated: row.estimated === 1,
    }));

  return {
    funnel: {
      issuesReceived: total,
      tasksEligible: eligible,
      sessionsDispatched: dispatched,
      prsOpened,
      prsMerged,
    },
    kpis: {
      totalTasks: total,
      ignoredTasks: ignored,
      eligibleTasks: eligible,
      dispatchSuccessRate: ratio(dispatched, eligible),
      prRate: ratio(prsOpened, dispatched),
      mergeRate: ratio(prsMerged, prsOpened),
      needsAttention: counts?.needs_attention ?? 0,
      totalAcus,
      acuRateUsd,
      costsEstimated: (acuRow?.estimated ?? 0) > 0 && estimate,
      totalCostUsd: cost(totalAcus),
      medianPrCostUsd: median(
        pullRequestCosts.map((pr) => pr.costUsd).filter((value): value is number => value !== null),
      ),
      medianTimeToPrMs: median(timeToPr),
      medianTimeToFirstDispatchMs: median(timeToDispatch),
    },
    daily,
    repositories,
    authors,
    pullRequestCosts,
    windowDays,
    generatedAt: Date.now(),
  };
}
