import { logger } from '../../logger';
import { getAttempt, getRepository, getTask, listPullRequests, updateTask } from '../../db/store';
import { orgInstallationOctokit } from '../../github/app';
import { bodyHash, buildCommentBody } from '../../github/comment';

/**
 * Maintains exactly one status comment per issue: created once, edited afterwards.
 * If the stored comment has been deleted, a replacement is created.
 */
export async function syncComment(taskId: string): Promise<void> {
  const task = getTask(taskId);
  if (!task) return;
  if (task.ui_state === 'ignored') return;

  const repository = getRepository(task.repository_id);
  if (!repository || repository.is_installed === 0) return;

  const attempt = task.current_attempt_id ? getAttempt(task.current_attempt_id) : undefined;
  const body = buildCommentBody({ task, attempt, pullRequests: listPullRequests(taskId) });
  const hash = bodyHash(body);
  if (task.github_comment_id && task.comment_body_hash === hash) return;

  const { octokit } = await orgInstallationOctokit();
  const [owner, repo] = repository.full_name.split('/');
  if (!owner || !repo) return;

  if (task.github_comment_id) {
    try {
      await octokit.rest.issues.updateComment({
        owner,
        repo,
        comment_id: task.github_comment_id,
        body,
      });
      updateTask(taskId, { comment_body_hash: hash });
      return;
    } catch (error) {
      const status = (error as { status?: number }).status;
      if (status !== 404 && status !== 410) throw error;
      logger.warn('status comment missing; creating a replacement', { taskId });
      updateTask(taskId, {
        github_comment_id: null,
        github_comment_url: null,
        comment_body_hash: null,
      });
    }
  }

  const created = await octokit.rest.issues.createComment({
    owner,
    repo,
    issue_number: task.issue_number,
    body,
  });
  updateTask(taskId, {
    github_comment_id: created.data.id,
    github_comment_url: created.data.html_url,
    comment_body_hash: hash,
  });
}
