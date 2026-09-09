import { createHash } from 'node:crypto';
import { config } from '../config';
import { UI_STATE_LABELS } from '../tasks/state';
import type { AttemptRow, PullRequestRow, TaskRow } from '../db/types';

export interface CommentInput {
  task: TaskRow;
  attempt: AttemptRow | undefined;
  pullRequests: PullRequestRow[];
}

/**
 * One durable comment per task. The body is deterministic so an unchanged body can be
 * detected by hash and the comment edit skipped.
 */
export function buildCommentBody(input: CommentInput): string {
  const { task, attempt, pullRequests } = input;
  const baseUrl = config().base.APP_BASE_URL.replace(/\/$/, '');
  const lines: string[] = [];

  lines.push('### Devin Conductor');
  lines.push('');
  lines.push(`**Status:** ${UI_STATE_LABELS[task.ui_state]}`);
  lines.push(`**Task:** ${baseUrl}/tasks/${task.id}`);
  if (attempt?.devin_session_url) {
    lines.push(`**Devin session:** ${attempt.devin_session_url}`);
  }
  if (pullRequests.length > 0) {
    const rendered = pullRequests
      .map((pr) => `${pr.url}${pr.merged ? ' (merged)' : pr.state === 'closed' ? ' (closed)' : ''}`)
      .join(', ');
    lines.push(`**Pull request${pullRequests.length > 1 ? 's' : ''}:** ${rendered}`);
  }
  if (task.ui_state === 'needs_attention' && task.needs_attention_reason) {
    lines.push('');
    lines.push(`> ${task.needs_attention_reason}`);
  }
  if (task.ui_state === 'closed') {
    lines.push('');
    lines.push('> This issue was closed on GitHub, so Devin Conductor stopped tracking it.');
  }
  lines.push('');
  lines.push(
    '_A human reviews and merges the pull request. Devin Conductor never merges pull requests or closes issues._',
  );
  return lines.join('\n');
}

export function bodyHash(body: string): string {
  return createHash('sha256').update(body).digest('hex').slice(0, 32);
}
