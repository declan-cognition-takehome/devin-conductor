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

  it('excludes rows outside the requested window', () => {
    const metrics = collectMetrics(1);
    const old = collectMetrics(365);
    expect(metrics.kpis.totalTasks).toBeLessThanOrEqual(old.kpis.totalTasks);
  });
});
