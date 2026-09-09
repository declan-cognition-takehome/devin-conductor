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
  lines.push(headline(task.ui_state, pullRequests.length));
  if (task.ui_state === 'needs_attention' && task.needs_attention_reason) {
    lines.push('');
    lines.push(`> ${task.needs_attention_reason}`);
  }
  lines.push('');
  if (pullRequests.length > 0) {
    const rendered = pullRequests
      .map((pr) => `${pr.url}${pr.merged ? ' (merged)' : pr.state === 'closed' ? ' (closed)' : ''}`)
      .join(', ');
    lines.push(`**Pull request${pullRequests.length > 1 ? 's' : ''}:** ${rendered}`);
  }
  if (attempt?.devin_session_url) {
    lines.push(`**Devin session:** ${attempt.devin_session_url}`);
  }
  lines.push(`**Conductor task:** ${baseUrl}/tasks/${task.id}`);
  lines.push('');
  lines.push(`_Status: ${UI_STATE_LABELS[task.ui_state]}_`);
  return lines.join('\n');
}

function headline(uiState: TaskRow['ui_state'], prCount: number): string {
  switch (uiState) {
    case 'queued':
      return 'Conductor has picked up this issue and is handing it off to Devin. Work should start shortly.';
    case 'working':
      return "Conductor has sent this issue to Devin, and it's working on it now.";
    case 'pr_ready':
      return prCount > 1
        ? 'Devin has opened pull requests for this issue. They are ready for review.'
        : 'Devin has opened a pull request for this issue. It is ready for review.';
    case 'merged':
      return prCount > 1
        ? "Devin's pull requests for this issue have been merged. Nice work, everyone!"
        : "Devin's pull request for this issue has been merged. Nice work, everyone!";
    case 'needs_attention':
      return 'Devin needs a hand with this issue. Take a look at the details below.';
    case 'closed':
      return 'This issue was closed on GitHub, so Conductor has stopped tracking it.';
    case 'ignored':
      return 'Conductor is no longer tracking this issue.';
  }
}

export function bodyHash(body: string): string {
  return createHash('sha256').update(body).digest('hex').slice(0, 32);
}
