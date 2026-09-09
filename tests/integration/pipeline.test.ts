import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { setupTestEnv } from '../helpers/env';
import type { DevinSession, DevinSessionMessage } from '@/lib/devin/client';

const env = setupTestEnv('pipeline');

type MembershipStatus = 'member' | 'not_member' | 'unknown';

const membership = { status: 'member' as MembershipStatus, reason: '' };

const devinState = {
  createCalls: [] as Array<Record<string, unknown>>,
  createImpl: null as null | (() => Promise<DevinSession>),
  session: null as DevinSession | null,
  sessionsByTag: [] as DevinSession[],
  messages: [] as DevinSessionMessage[],
};

let sessionCounter = 0;

function session(overrides: Partial<DevinSession> = {}): DevinSession {
  sessionCounter += 1;
  return {
    session_id: `devin-${sessionCounter}`,
    url: `https://app.devin.test/sessions/${sessionCounter}`,
    status: 'running',
    tags: [],
    pull_requests: [],
    ...overrides,
  };
}

vi.mock('@/lib/github/app', () => ({
  orgInstallationOctokit: vi.fn(async () => ({ octokit: {}, installationId: 1 })),
}));

vi.mock('@/lib/github/membership', () => ({
  checkOrgMembership: vi.fn(async () => membership),
}));

vi.mock('@/lib/github/sync', () => ({
  syncInstallations: vi.fn(async () => ({ installations: [], repositories: [] })),
}));

vi.mock('@/lib/devin/client', async () => {
  const actual = await vi.importActual<typeof import('@/lib/devin/client')>('@/lib/devin/client');
  return {
    ...actual,
    devinClient: () => ({
      createSession: async (input: Record<string, unknown>) => {
        devinState.createCalls.push(input);
        if (devinState.createImpl) return devinState.createImpl();
        return session();
      },
      getSession: async (sessionId: string) =>
        devinState.session ? { ...devinState.session, session_id: sessionId } : session(),
      listSessions: async () => ({
        items: devinState.sessionsByTag,
        end_cursor: null,
        has_next_page: false,
      }),
      listMessages: async () => ({
        items: devinState.messages,
        end_cursor: null,
        has_next_page: false,
      }),
    }),
  };
});

let store: typeof import('@/lib/db/store');
let jobs: typeof import('@/lib/queue/jobs');
let processDelivery: typeof import('@/lib/worker/handlers/process-delivery').processDelivery;
let TransientProcessingError: typeof import('@/lib/worker/handlers/process-delivery').TransientProcessingError;
let dispatchTask: typeof import('@/lib/worker/handlers/dispatch').dispatchTask;
let DispatchDeferred: typeof import('@/lib/worker/handlers/dispatch').DispatchDeferred;
let reconcileAttempt: typeof import('@/lib/worker/handlers/reconcile').reconcileAttempt;
let Worker: typeof import('@/lib/worker').Worker;
let db: typeof import('@/lib/db').db;
let closeDatabase: () => void;

let issueCounter = 0;

function installRepository(overrides: { automation?: boolean; installed?: boolean } = {}): number {
  const repoId = 5000;
  store.upsertInstallation({
    installationId: 1,
    accountId: 9,
    accountLogin: 'test-org',
    accountType: 'Organization',
    status: 'active',
  });
  store.upsertRepository({
    githubRepoId: repoId,
    installationId: 1,
    owner: 'test-org',
    name: 'repo',
    fullName: 'test-org/repo',
    defaultBranch: 'main',
    isInstalled: overrides.installed ?? true,
  });
  store.setRepositoryAutomation(repoId, overrides.automation ?? true);
  return repoId;
}

/** Persists an `issues.opened` delivery the way the webhook route does. */
function issueDelivery(
  overrides: {
    repositoryId?: number;
    owner?: string;
    authorLogin?: string | null;
  } = {},
): { deliveryId: string; issueNumber: number } {
  issueCounter += 1;
  const issueNumber = issueCounter;
  const repositoryId = overrides.repositoryId ?? 5000;
  const owner = overrides.owner ?? 'test-org';
  const payload = {
    action: 'opened',
    issue: {
      id: 10_000 + issueNumber,
      node_id: `I_${issueNumber}`,
      number: issueNumber,
      title: `Issue ${issueNumber}`,
      body: 'Something is broken.',
      html_url: `https://github.com/${owner}/repo/issues/${issueNumber}`,
      created_at: '2026-01-01T00:00:00Z',
      user:
        overrides.authorLogin === null
          ? null
          : { id: 42, login: overrides.authorLogin ?? 'member' },
    },
    repository: {
      id: repositoryId,
      full_name: `${owner}/repo`,
      name: 'repo',
      owner: { login: owner, id: 9 },
      default_branch: 'main',
      private: false,
    },
  };
  const delivery = store.insertDelivery({
    githubDeliveryId: `delivery-${issueNumber}`,
    event: 'issues',
    action: 'opened',
    installationId: 1,
    repositoryId,
    repositoryFullName: `${owner}/repo`,
    senderId: 42,
    senderLogin: 'member',
    payload: JSON.stringify(payload),
  });
  if (!delivery) throw new Error('delivery was not persisted');
  return { deliveryId: delivery.id, issueNumber };
}

beforeAll(async () => {
  store = await import('@/lib/db/store');
  jobs = await import('@/lib/queue/jobs');
  ({ processDelivery, TransientProcessingError } =
    await import('@/lib/worker/handlers/process-delivery'));
  ({ dispatchTask, DispatchDeferred } = await import('@/lib/worker/handlers/dispatch'));
  ({ reconcileAttempt } = await import('@/lib/worker/handlers/reconcile'));
  ({ Worker } = await import('@/lib/worker'));
  ({ db, closeDatabase } = await import('@/lib/db'));
  installRepository();
});

afterEach(() => {
  membership.status = 'member';
  devinState.createCalls = [];
  devinState.createImpl = null;
  devinState.session = null;
  devinState.sessionsByTag = [];
  devinState.messages = [];
  store.updateSettings({ paused: false, maxConcurrentSessions: 100, pollIntervalSeconds: 30 });
});

afterAll(() => {
  closeDatabase();
  env.cleanup();
});

describe('trust policy', () => {
  it('accepts an issue from an organization member in an enabled repository', async () => {
    const { deliveryId, issueNumber } = issueDelivery();
    await processDelivery(deliveryId);

    const task = store.getTaskByIssue(5000, issueNumber);
    expect(task?.ui_state).toBe('queued');
    expect(store.getDelivery(deliveryId)?.state).toBe('processed');
    expect(jobs.countPendingJobs()).toBeGreaterThan(0);
  });

  it('ignores an issue from a non-member without dispatching', async () => {
    membership.status = 'not_member';
    const { deliveryId, issueNumber } = issueDelivery();
    await processDelivery(deliveryId);

    const task = store.getTaskByIssue(5000, issueNumber);
    expect(task?.ui_state).toBe('ignored');
    expect(task?.status_reason).toContain('untrusted author');
    expect(store.listAttempts(task!.id)).toHaveLength(0);
  });

  it('fails closed and retries when membership cannot be determined', async () => {
    membership.status = 'unknown';
    membership.reason = 'github unavailable';
    const { deliveryId, issueNumber } = issueDelivery();

    await expect(processDelivery(deliveryId)).rejects.toBeInstanceOf(TransientProcessingError);
    expect(store.getTaskByIssue(5000, issueNumber)).toBeUndefined();
    expect(store.getDelivery(deliveryId)?.state).not.toBe('processed');
  });

  it('ignores repositories with automation disabled', async () => {
    store.setRepositoryAutomation(5000, false);
    const { deliveryId, issueNumber } = issueDelivery();
    await processDelivery(deliveryId);
    store.setRepositoryAutomation(5000, true);

    expect(store.getTaskByIssue(5000, issueNumber)?.status_reason).toContain(
      'automation is disabled',
    );
  });

  it('ignores repositories outside the configured organization', async () => {
    const { deliveryId, issueNumber } = issueDelivery({ repositoryId: 6000, owner: 'other-org' });
    await processDelivery(deliveryId);

    expect(store.getTaskByIssue(6000, issueNumber)?.status_reason).toContain(
      'outside the configured organization',
    );
  });

  it('does not create a second task for the same issue', async () => {
    const { deliveryId, issueNumber } = issueDelivery();
    await processDelivery(deliveryId);
    const first = store.getTaskByIssue(5000, issueNumber);

    const replay = store.insertDelivery({
      githubDeliveryId: `delivery-replay-${issueNumber}`,
      event: 'issues',
      action: 'opened',
      installationId: 1,
      repositoryId: 5000,
      repositoryFullName: 'test-org/repo',
      senderId: 42,
      senderLogin: 'member',
      payload: store.getDelivery(deliveryId)!.payload,
    });
    await processDelivery(replay!.id);

    expect(store.getTaskByIssue(5000, issueNumber)?.id).toBe(first?.id);
  });
});

describe('dispatch', () => {
  async function queuedTask(): Promise<string> {
    const { deliveryId, issueNumber } = issueDelivery();
    await processDelivery(deliveryId);
    return store.getTaskByIssue(5000, issueNumber)!.id;
  }

  it('creates a tagged session and records the attempt', async () => {
    const taskId = await queuedTask();
    await dispatchTask(taskId);

    const [call] = devinState.createCalls;
    expect(call?.repos).toEqual(['test-org/repo']);
    expect(call?.sessionLinks).toEqual([expect.stringContaining('/issues/')]);
    expect(call?.tags).toContain(`conductor-dispatch:${taskId}:1`);

    const task = store.getTask(taskId)!;
    expect(task.ui_state).toBe('working');
    const [attempt] = store.listAttempts(taskId);
    expect(attempt?.devin_session_id).toMatch(/^devin-/);
    expect(attempt?.devin_session_url).toContain('app.devin.test');
  });

  it('defers instead of dispatching while automation is paused', async () => {
    const taskId = await queuedTask();
    store.updateSettings({ paused: true });

    await expect(dispatchTask(taskId)).rejects.toBeInstanceOf(DispatchDeferred);
    expect(devinState.createCalls).toHaveLength(0);
    expect(store.getTask(taskId)?.ui_state).toBe('queued');
  });

  it('defers when the concurrency ceiling is reached', async () => {
    const taskId = await queuedTask();
    store.updateSettings({ maxConcurrentSessions: 1 });

    await expect(dispatchTask(taskId)).rejects.toBeInstanceOf(DispatchDeferred);
    expect(devinState.createCalls).toHaveLength(0);
  });

  it('recovers an uncertain dispatch by tag instead of creating a duplicate session', async () => {
    const taskId = await queuedTask();
    devinState.createImpl = async () => {
      const { DevinUncertainDispatchError } = await import('@/lib/devin/client');
      throw new DevinUncertainDispatchError(new Error('socket hang up'));
    };
    await expect(dispatchTask(taskId)).rejects.toThrow(/uncertain/i);

    const attempt = store.listAttempts(taskId)[0]!;
    expect(attempt.uncertain_dispatch).toBe(1);

    devinState.createImpl = null;
    devinState.createCalls = [];
    devinState.sessionsByTag = [
      session({
        session_id: 'devin-recovered',
        tags: [`conductor-dispatch:${taskId}:1`],
        created_at: Math.floor(Date.now() / 1000),
      }),
    ];
    await dispatchTask(taskId);

    expect(devinState.createCalls).toHaveLength(0);
    const recovered = store.listAttempts(taskId)[0]!;
    expect(recovered.devin_session_id).toBe('devin-recovered');
    expect(recovered.adopted_session).toBe(1);
    expect(store.listAttempts(taskId)).toHaveLength(1);
  });
});

describe('reconciliation', () => {
  /** Clears the queue, including work scheduled for the future by earlier tests. */
  function drainJobs(): void {
    const horizon = Date.now() + 60 * 60_000;
    for (
      let claimed = jobs.claimNextJob('drain', horizon);
      claimed;
      claimed = jobs.claimNextJob('drain', horizon)
    ) {
      jobs.completeJob(claimed.id);
    }
  }

  /** Leaves `attemptId` as the only attempt the worker sweep will pick up. */
  function isolateAttempt(attemptId: string): void {
    for (const attempt of store.listActiveAttempts()) {
      if (attempt.id !== attemptId) {
        store.updateAttempt(attempt.id, { status: 'terminal', terminal_at: Date.now() });
      }
    }
    drainJobs();
  }

  async function reconcileViaWorker(attemptId: string): Promise<void> {
    const worker = new Worker({ idleDelayMs: 0 });
    for (let i = 0; i < 10; i += 1) {
      await worker.tick();
      if (store.getAttempt(attemptId)?.last_reconciled_at) return;
    }
    throw new Error('worker never reconciled the attempt');
  }

  function pendingPoll(attemptId: string): { available_at: number } | undefined {
    return db()
      .prepare<[string], { available_at: number }>(
        `SELECT available_at FROM jobs
         WHERE dedupe_key = ? AND state = 'pending' AND job_type = 'reconcile_attempt'`,
      )
      .get(`reconcile:${attemptId}`);
  }

  async function dispatched(): Promise<{ taskId: string; attemptId: string }> {
    const { deliveryId, issueNumber } = issueDelivery();
    await processDelivery(deliveryId);
    const taskId = store.getTaskByIssue(5000, issueNumber)!.id;
    await dispatchTask(taskId);
    return { taskId, attemptId: store.listAttempts(taskId)[0]!.id };
  }

  it('ingests redacted messages and keeps polling a running session', async () => {
    const { taskId, attemptId } = await dispatched();
    devinState.session = session({ status: 'running', acus_consumed: 3 });
    devinState.messages = [
      {
        event_id: 'evt-1',
        source: 'devin',
        message: 'using key cog_abcdefgh12345678',
        created_at: 1_767_225_600,
      },
    ];

    await reconcileAttempt(attemptId);

    const messages = store.listMessagesForTask(taskId);
    expect(messages).toHaveLength(1);
    expect(messages[0]?.message).toContain('cog_[REDACTED]');
    expect(store.getAttempt(attemptId)?.acus).toBe(3);
    expect(store.getTask(taskId)?.ui_state).toBe('working');
  });

  it('does not duplicate messages already ingested', async () => {
    const { taskId, attemptId } = await dispatched();
    devinState.messages = [
      { event_id: 'evt-dup', source: 'devin', message: 'hello', created_at: 1_767_225_600 },
    ];
    await reconcileAttempt(attemptId);
    await reconcileAttempt(attemptId);
    expect(store.listMessagesForTask(taskId)).toHaveLength(1);
  });

  it('promotes the task to PR ready when Devin reports a pull request', async () => {
    const { taskId, attemptId } = await dispatched();
    devinState.session = session({
      status: 'running',
      pull_requests: [{ pr_url: 'https://github.com/test-org/repo/pull/31', pr_state: 'open' }],
    });

    await reconcileAttempt(attemptId);

    expect(store.getTask(taskId)?.ui_state).toBe('pr_ready');
    expect(store.listPullRequests(taskId)[0]?.number).toBe(31);
  });

  it('flags a terminal session with no pull request as needing attention', async () => {
    const { taskId, attemptId } = await dispatched();
    devinState.session = session({ status: 'exit', status_detail: 'finished' });

    await reconcileAttempt(attemptId);

    const task = store.getTask(taskId)!;
    expect(task.ui_state).toBe('needs_attention');
    expect(task.secondary_outcome).toBe('completed_without_pr');
    expect(task.needs_attention_reason).toContain('exit');
  });

  it('replaces the waiting-on-a-reply reason once the session ends', async () => {
    const { taskId, attemptId } = await dispatched();
    devinState.session = session({ status: 'running', status_detail: 'waiting_for_user' });
    await reconcileAttempt(attemptId);
    expect(store.getTask(taskId)?.secondary_outcome).toBe('awaiting_input');

    devinState.session = session({ status: 'suspended', status_detail: 'user_request' });
    await reconcileAttempt(attemptId);

    const task = store.getTask(taskId)!;
    expect(task.secondary_outcome).toBe('devin_suspended');
    expect(task.needs_attention_reason).toBe('Devin session ended: suspended (user_request)');
  });

  it('schedules the next poll only after the reconcile job releases its dedupe key', async () => {
    const { attemptId } = await dispatched();
    devinState.session = session({ status: 'running', status_detail: 'working' });
    isolateAttempt(attemptId);
    store.updateSettings({ pollIntervalSeconds: 45 });
    jobs.enqueueJob({
      jobType: 'reconcile_attempt',
      entityId: attemptId,
      dedupeKey: `reconcile:${attemptId}`,
    });

    await reconcileViaWorker(attemptId);

    const next = pendingPoll(attemptId);
    expect(next).toBeDefined();
    expect(next!.available_at).toBeGreaterThan(Date.now() + 40_000);
  });

  it('stops polling once the session is terminal', async () => {
    const { attemptId } = await dispatched();
    devinState.session = session({ status: 'exit' });
    isolateAttempt(attemptId);
    jobs.enqueueJob({
      jobType: 'reconcile_attempt',
      entityId: attemptId,
      dedupeKey: `reconcile:${attemptId}`,
    });

    await reconcileViaWorker(attemptId);

    expect(pendingPoll(attemptId)).toBeUndefined();
  });

  it('ignores a malformed pull request URL', async () => {
    const { taskId, attemptId } = await dispatched();
    devinState.session = session({ pull_requests: [{ pr_url: 'not-a-url', pr_state: 'open' }] });

    await reconcileAttempt(attemptId);

    expect(store.listPullRequests(taskId)).toHaveLength(0);
  });
});

describe('pull_request events', () => {
  it('marks the task merged when its pull request merges', async () => {
    const { deliveryId, issueNumber } = issueDelivery();
    await processDelivery(deliveryId);
    const taskId = store.getTaskByIssue(5000, issueNumber)!.id;
    await dispatchTask(taskId);
    const attemptId = store.listAttempts(taskId)[0]!.id;
    devinState.session = session({
      pull_requests: [{ pr_url: 'https://github.com/test-org/repo/pull/77', pr_state: 'open' }],
    });
    await reconcileAttempt(attemptId);
    expect(store.getTask(taskId)?.ui_state).toBe('pr_ready');

    const payload = {
      action: 'closed',
      number: 77,
      pull_request: {
        id: 1,
        number: 77,
        title: 'Fix export',
        html_url: 'https://github.com/test-org/repo/pull/77',
        state: 'closed',
        merged: true,
        merged_at: '2026-01-02T00:00:00Z',
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-02T00:00:00Z',
        closed_at: '2026-01-02T00:00:00Z',
        user: { id: 1, login: 'devin' },
      },
      repository: {
        id: 5000,
        full_name: 'test-org/repo',
        name: 'repo',
        owner: { login: 'test-org', id: 9 },
        default_branch: 'main',
        private: false,
      },
    };
    const delivery = store.insertDelivery({
      githubDeliveryId: `pr-merged-${issueNumber}`,
      event: 'pull_request',
      action: 'closed',
      installationId: 1,
      repositoryId: 5000,
      repositoryFullName: 'test-org/repo',
      senderId: 1,
      senderLogin: 'human',
      payload: JSON.stringify(payload),
    });
    await processDelivery(delivery!.id);

    expect(store.getTask(taskId)?.ui_state).toBe('merged');
  });
});
