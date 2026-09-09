export const name = '0002_issue_state';

export const sql = `
-- Tracks whether the source GitHub issue is still open. Conductor never closes issues,
-- so a closed issue is always a human decision that resolves the task.

ALTER TABLE tasks ADD COLUMN issue_state TEXT NOT NULL DEFAULT 'open';
ALTER TABLE tasks ADD COLUMN issue_closed_at INTEGER;
`;
