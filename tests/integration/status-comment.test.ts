import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { setupTestEnv } from '../helpers/env';

const env = setupTestEnv('comment');

interface CommentCall {
  kind: 'create' | 'update';
  body: string;
  commentId?: number;
}

const github = {
  calls: [] as CommentCall[],
  updateStatus: 200,
  nextCommentId: 500,
};

vi.mock('@/lib/github/app', () => ({
  orgInstallationOctokit: async () => ({
    installationId: 1,
    octokit: {
      rest: {
        issues: {
          createComment: async (input: { body: string }) => {
            github.calls.push({ kind: 'create', body: input.body });
            github.nextCommentId += 1;
            return {
              data: {
                id: github.nextCommentId,
                html_url: `https://github.com/test-org/repo/issues/1#issuecomment-${github.nextCommentId}`,
              },
            };
          },
          updateComment: async (input: { body: string; comment_id: number }) => {
            if (github.updateStatus !== 200) {
              throw Object.assign(new Error('not found'), { status: github.updateStatus });
            }
            github.calls.push({ kind: 'update', body: input.body, commentId: input.comment_id });
            return { data: { id: input.comment_id } };
          },
        },
      },
    },
  }),
}));

let store: typeof import('@/lib/db/store');
let syncComment: typeof import('@/lib/worker/handlers/sync-comment').syncComment;
let closeDatabase: () => void;

let issueCounter = 0;

function seedTask(uiState: 'working' | 'ignored' = 'working'): string {
  issueCounter += 1;
  store.upsertRepository({
    githubRepoId: 1,
    installationId: 1,
    owner: 'test-org',
    name: 'repo',
    fullName: 'test-org/repo',
    isInstalled: true,
  });
  const { task } = store.createTask({
    repositoryId: 1,
    repositoryFullName: 'test-org/repo',
    issueId: issueCounter,
    issueNodeId: null,
    issueNumber: issueCounter,
    issueUrl: `https://github.com/test-org/repo/issues/${issueCounter}`,
    issueTitle: 'Broken export',
    issueBody: null,
    authorId: 1,
    authorLogin: 'member',
    issueCreatedAt: Date.now(),
    internalState: uiState === 'ignored' ? 'ignored' : 'running',
    uiState,
  });
  return task.id;
}

beforeAll(async () => {
  store = await import('@/lib/db/store');
  ({ syncComment } = await import('@/lib/worker/handlers/sync-comment'));
  ({ closeDatabase } = await import('@/lib/db'));
});

afterEach(() => {
  github.calls = [];
  github.updateStatus = 200;
});

afterAll(() => {
  closeDatabase();
  env.cleanup();
});

describe('issue status comment', () => {
  it('creates one comment and then edits the same comment', async () => {
    const taskId = seedTask();
    await syncComment(taskId);

    expect(github.calls).toHaveLength(1);
    expect(github.calls[0]?.kind).toBe('create');
    const commentId = store.getTask(taskId)?.github_comment_id;
    expect(commentId).toBeGreaterThan(0);
    expect(github.calls[0]?.body).toContain('Devin Conductor');
    expect(github.calls[0]?.body).toMatch(/merge|close/i);

    store.updateTask(taskId, {
      ui_state: 'needs_attention',
      needs_attention_reason: 'Devin failed',
    });
    await syncComment(taskId);

    expect(github.calls[1]).toMatchObject({ kind: 'update', commentId });
    expect(github.calls[1]?.body).toContain('Devin failed');
    expect(store.getTask(taskId)?.github_comment_id).toBe(commentId);
  });

  it('does not call GitHub when the rendered body is unchanged', async () => {
    const taskId = seedTask();
    await syncComment(taskId);
    github.calls = [];
    await syncComment(taskId);
    expect(github.calls).toHaveLength(0);
  });

  it('recreates the comment when the stored one was deleted', async () => {
    const taskId = seedTask();
    await syncComment(taskId);
    const original = store.getTask(taskId)?.github_comment_id;
    github.calls = [];

    store.updateTask(taskId, { ui_state: 'merged' });
    github.updateStatus = 404;
    await syncComment(taskId);

    expect(github.calls.map((call) => call.kind)).toEqual(['create']);
    expect(store.getTask(taskId)?.github_comment_id).not.toBe(original);
  });

  it('never comments on an ignored task', async () => {
    const taskId = seedTask('ignored');
    await syncComment(taskId);
    expect(github.calls).toHaveLength(0);
  });
});
