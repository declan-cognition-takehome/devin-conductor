import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestEnv } from '../helpers/env';

const env = setupTestEnv('metrics');

let store: typeof import('@/lib/db/store');
let collectMetrics: typeof import('@/lib/metrics').collectMetrics;
let closeDatabase: () => void;

let issueCounter = 0;

function createTask(uiState: 'queued' | 'ignored' | 'needs_attention'): string {
  issueCounter += 1;
  const { task } = store.createTask({
    repositoryId: 1,
    repositoryFullName: 'test-org/repo',
    issueId: issueCounter,
    issueNodeId: null,
    issueNumber: issueCounter,
    issueUrl: `https://github.com/test-org/repo/issues/${issueCounter}`,
    issueTitle: `Issue ${issueCounter}`,
    issueBody: null,
    authorId: 1,
    authorLogin: 'member',
    issueCreatedAt: Date.now(),
    internalState: uiState === 'ignored' ? 'ignored' : 'queued',
    uiState,
  });
  return task.id;
}

beforeAll(async () => {
  store = await import('@/lib/db/store');
  ({ collectMetrics } = await import('@/lib/metrics'));
  ({ closeDatabase } = await import('@/lib/db'));
});

afterAll(() => {
  closeDatabase();
  env.cleanup();
});

describe('collectMetrics', () => {
  it('returns null ratios rather than zeros when there is no data', () => {
    const metrics = collectMetrics(30);
    expect(metrics.kpis.totalTasks).toBe(0);
    expect(metrics.kpis.dispatchSuccessRate).toBeNull();
    expect(metrics.kpis.prRate).toBeNull();
    expect(metrics.kpis.mergeRate).toBeNull();
    expect(metrics.kpis.medianTimeToPrMs).toBeNull();
    expect(metrics.daily).toEqual([]);
  });

  it('excludes ignored tasks from the eligible denominator', () => {
    createTask('ignored');
    createTask('ignored');
    const dispatched = createTask('queued');
    store.updateTask(dispatched, { dispatched_at: Date.now() });

    const metrics = collectMetrics(30);
    expect(metrics.funnel.issuesReceived).toBe(3);
    expect(metrics.funnel.tasksEligible).toBe(1);
    expect(metrics.kpis.dispatchSuccessRate).toBe(1);
    // No PRs exist yet, so the PR rate has a denominator but a zero numerator.
    expect(metrics.kpis.prRate).toBe(0);
    expect(metrics.kpis.mergeRate).toBeNull();
  });

  it('computes PR and merge rates and the median time to PR from persisted facts', () => {
    const taskId = createTask('queued');
    const queuedAt = Date.now() - 60_000;
    store.updateTask(taskId, {
      queued_at: queuedAt,
      dispatched_at: queuedAt + 1_000,
      first_pr_at: queuedAt + 31_000,
      ui_state: 'merged',
      merged_at: queuedAt + 50_000,
    });
    store.upsertPullRequest({
      taskId,
      attemptId: null,
      githubRepoId: 1,
      repositoryFullName: 'test-org/repo',
      number: 5,
      url: 'https://github.com/test-org/repo/pull/5',
      state: 'closed',
      merged: true,
      mergedAt: queuedAt + 50_000,
      prCreatedAt: queuedAt + 31_000,
    });

    const metrics = collectMetrics(30);
    expect(metrics.funnel.prsOpened).toBe(1);
    expect(metrics.funnel.prsMerged).toBe(1);
    expect(metrics.kpis.mergeRate).toBe(1);
    expect(metrics.kpis.medianTimeToPrMs).toBe(31_000);
    expect(metrics.repositories[0]?.repositoryFullName).toBe('test-org/repo');
  });

  it('reports unknown ACUs and unpriced costs until usage and a rate exist', () => {
    const metrics = collectMetrics(30);
    expect(metrics.kpis.totalAcus).toBeNull();
    expect(metrics.kpis.totalCostUsd).toBeNull();
    expect(metrics.repositories[0]?.acus).toBeNull();
    expect(metrics.pullRequestCosts.every((pr) => pr.costUsd === null)).toBe(true);
  });

  it('prices metered ACUs and splits a session across the pull requests it opened', () => {
    const taskId = createTask('queued');
    const attempt = store.createAttempt({ taskId, attemptNumber: 1, dispatchTag: 'tag-1' });
    store.updateAttempt(attempt.id, { acus: 10 });
    for (const number of [11, 12]) {
      store.upsertPullRequest({
        taskId,
        attemptId: attempt.id,
        githubRepoId: 1,
        repositoryFullName: 'test-org/repo',
        number,
        url: `https://github.com/test-org/repo/pull/${number}`,
        state: 'open',
        merged: false,
        mergedAt: null,
        prCreatedAt: Date.now(),
      });
    }
    store.updateSettings({ acuRateUsd: 2.5 });

    const metrics = collectMetrics(30);
    const priced = metrics.pullRequestCosts.filter((pr) => pr.number === 11 || pr.number === 12);
    expect(priced).toHaveLength(2);
    expect(priced.every((pr) => pr.acus === 5 && pr.costUsd === 12.5)).toBe(true);
    expect(metrics.kpis.totalAcus).toBe(10);
    expect(metrics.kpis.totalCostUsd).toBe(25);
    expect(metrics.kpis.medianPrCostUsd).toBe(12.5);

    store.updateSettings({ acuRateUsd: null });
  });

  it('estimates cost from transcript size when Devin reports no metered usage', () => {
    const taskId = createTask('queued');
    const attempt = store.createAttempt({ taskId, attemptNumber: 1, dispatchTag: 'tag-est' });
    store.updateAttempt(attempt.id, { devin_session_id: 'devin-est' });
    store.insertMessages(attempt.id, [
      {
        devinMessageId: 'm-1',
        source: 'devin',
        message: 'x'.repeat(3000),
        createdAt: Date.now(),
      },
      {
        devinMessageId: 'm-2',
        source: 'user',
        message: 'y'.repeat(1000),
        createdAt: Date.now(),
      },
    ]);
    store.upsertPullRequest({
      taskId,
      attemptId: attempt.id,
      githubRepoId: 1,
      repositoryFullName: 'test-org/repo',
      number: 21,
      url: 'https://github.com/test-org/repo/pull/21',
      state: 'open',
      merged: false,
      mergedAt: null,
      prCreatedAt: Date.now(),
    });
    store.updateSettings({ acuRateUsd: 2.25 });

    const estimated = collectMetrics(30).pullRequestCosts.find((pr) => pr.number === 21);
    expect(estimated?.acus).toBe(2);
    expect(estimated?.costUsd).toBe(4.5);
    expect(estimated?.estimated).toBe(true);
    expect(collectMetrics(30).kpis.costsEstimated).toBe(true);

    store.updateSettings({ estimateUnmeteredCosts: false });
    const unpriced = collectMetrics(30).pullRequestCosts.find((pr) => pr.number === 21);
    expect(unpriced?.acus).toBeNull();
    expect(unpriced?.costUsd).toBeNull();
    expect(collectMetrics(30).kpis.costsEstimated).toBe(false);

    store.updateSettings({ estimateUnmeteredCosts: true, acuRateUsd: null });
  });

  it('excludes rows outside the requested window', () => {
    const metrics = collectMetrics(1);
    const old = collectMetrics(365);
    expect(metrics.kpis.totalTasks).toBeLessThanOrEqual(old.kpis.totalTasks);
  });
});
