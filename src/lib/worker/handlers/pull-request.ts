import {
  addTaskEvent,
  findPullRequest,
  recomputeTaskState,
  upsertPullRequest,
} from '../../db/store';
import { enqueueJob } from '../../queue/jobs';
import { orgInstallationOctokit } from '../../github/app';

/**
 * Reconciles a pull request through the GitHub API. Used when a `pull_request` webhook
 * may have been missed, and immediately after Devin reports a new PR so its real
 * metadata (title, author, created time) replaces the placeholder.
 *
 * `entityId` has the form `owner/repo#number`.
 */
export async function reconcilePullRequest(entityId: string): Promise<void> {
  const [fullName, rawNumber] = entityId.split('#');
  const number = Number(rawNumber);
  if (!fullName || !Number.isInteger(number)) return;
  const [owner, repo] = fullName.split('/');
  if (!owner || !repo) return;

  const existing = findPullRequest(fullName, number);
  const { octokit } = await orgInstallationOctokit();
  const { data } = await octokit.rest.pulls.get({ owner, repo, pull_number: number });

  const merged = Boolean(data.merged_at);
  const row = upsertPullRequest({
    taskId: existing?.task_id ?? null,
    attemptId: existing?.attempt_id ?? null,
    githubRepoId: data.base.repo.id,
    repositoryFullName: fullName,
    number,
    url: data.html_url,
    title: data.title,
    authorLogin: data.user?.login ?? null,
    state: data.state,
    merged,
    mergedAt: data.merged_at ? Date.parse(data.merged_at) : null,
    prCreatedAt: Date.parse(data.created_at),
    prUpdatedAt: data.updated_at ? Date.parse(data.updated_at) : null,
    prClosedAt: data.closed_at ? Date.parse(data.closed_at) : null,
  });

  if (row.task_id) {
    if (merged && existing?.merged === 0) {
      addTaskEvent({
        taskId: row.task_id,
        eventType: 'pull_request_merged',
        source: 'github',
        summary: `Pull request #${number} merged`,
        metadata: { url: data.html_url },
      });
    }
    recomputeTaskState(row.task_id);
    enqueueJob({
      jobType: 'sync_comment',
      entityId: row.task_id,
      dedupeKey: `comment:${row.task_id}`,
    });
  }
}
