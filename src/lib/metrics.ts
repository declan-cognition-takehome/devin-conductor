import { db } from './db';

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
  totalAcus: number;
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
  acus: number;
}

export interface AuthorStat {
  authorLogin: string;
  tasks: number;
  merged: number;
}

export interface FailureStat {
  reason: string;
  count: number;
}

export interface MetricsSnapshot {
  funnel: Funnel;
  kpis: Kpis;
  daily: DailyPoint[];
  repositories: RepositoryStat[];
  authors: AuthorStat[];
  failures: FailureStat[];
  windowDays: number;
  generatedAt: number;
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

  const acuRow = conn
    .prepare<[number], { total: number | null }>(
      'SELECT SUM(acus) AS total FROM devin_session_attempts WHERE created_at >= ?',
    )
    .get(since);

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
    .prepare<[number], RepositoryStat>(
      `SELECT t.repository_full_name AS repositoryFullName,
              COUNT(*) AS tasks,
              SUM(CASE WHEN t.first_pr_at IS NOT NULL THEN 1 ELSE 0 END) AS prs,
              SUM(CASE WHEN t.ui_state = 'merged' THEN 1 ELSE 0 END) AS merged,
              SUM(CASE WHEN t.ui_state = 'needs_attention' THEN 1 ELSE 0 END) AS needsAttention,
              COALESCE((SELECT SUM(a.acus) FROM devin_session_attempts a WHERE a.task_id = t.id), 0) AS acus
       FROM tasks t WHERE t.created_at >= ?
       GROUP BY t.repository_full_name ORDER BY tasks DESC`,
    )
    .all(since);

  const authors = conn
    .prepare<[number], AuthorStat>(
      `SELECT author_login AS authorLogin,
              COUNT(*) AS tasks,
              SUM(CASE WHEN ui_state = 'merged' THEN 1 ELSE 0 END) AS merged
       FROM tasks WHERE created_at >= ? AND ui_state != 'ignored'
       GROUP BY author_login ORDER BY tasks DESC LIMIT 25`,
    )
    .all(since);

  const failures = conn
    .prepare<[number], FailureStat>(
      `SELECT COALESCE(secondary_outcome, 'unclassified') AS reason, COUNT(*) AS count
       FROM tasks
       WHERE created_at >= ? AND ui_state = 'needs_attention'
       GROUP BY reason ORDER BY count DESC`,
    )
    .all(since);

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
      totalAcus: acuRow?.total ?? 0,
      medianTimeToPrMs: median(timeToPr),
      medianTimeToFirstDispatchMs: median(timeToDispatch),
    },
    daily,
    repositories,
    authors,
    failures,
    windowDays,
    generatedAt: Date.now(),
  };
}
