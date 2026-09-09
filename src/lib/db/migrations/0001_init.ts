export const name = '0001_init';

export const sql = `
-- Devin Conductor initial schema.
-- Timestamps are epoch milliseconds (INTEGER) so ordering and duration maths stay exact.

CREATE TABLE users (
  github_user_id INTEGER PRIMARY KEY,
  login TEXT NOT NULL,
  avatar_url TEXT,
  last_membership_verified_at INTEGER,
  is_member INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX users_login_idx ON users (login);

CREATE TABLE github_installations (
  installation_id INTEGER PRIMARY KEY,
  account_id INTEGER NOT NULL,
  account_login TEXT NOT NULL,
  account_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  installed_at INTEGER,
  suspended_at INTEGER,
  last_synced_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE repositories (
  github_repo_id INTEGER PRIMARY KEY,
  installation_id INTEGER,
  owner TEXT NOT NULL,
  name TEXT NOT NULL,
  full_name TEXT NOT NULL,
  default_branch TEXT,
  is_private INTEGER NOT NULL DEFAULT 0,
  is_installed INTEGER NOT NULL DEFAULT 1,
  automation_enabled INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX repositories_full_name_idx ON repositories (full_name);

CREATE TABLE webhook_deliveries (
  id TEXT PRIMARY KEY,
  github_delivery_id TEXT NOT NULL,
  event TEXT NOT NULL,
  action TEXT,
  installation_id INTEGER,
  repository_id INTEGER,
  repository_full_name TEXT,
  sender_id INTEGER,
  sender_login TEXT,
  signature_valid INTEGER NOT NULL DEFAULT 1,
  state TEXT NOT NULL DEFAULT 'received',
  attempts INTEGER NOT NULL DEFAULT 0,
  payload TEXT NOT NULL,
  error_summary TEXT,
  received_at INTEGER NOT NULL,
  processed_at INTEGER
);

CREATE UNIQUE INDEX webhook_deliveries_delivery_idx ON webhook_deliveries (github_delivery_id);
CREATE INDEX webhook_deliveries_received_idx ON webhook_deliveries (received_at);

CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  repository_id INTEGER NOT NULL,
  repository_full_name TEXT NOT NULL,
  issue_id INTEGER NOT NULL,
  issue_node_id TEXT,
  issue_number INTEGER NOT NULL,
  issue_url TEXT NOT NULL,
  issue_title TEXT NOT NULL,
  issue_body TEXT,
  author_id INTEGER,
  author_login TEXT NOT NULL,
  issue_created_at INTEGER,
  internal_state TEXT NOT NULL,
  ui_state TEXT NOT NULL,
  secondary_outcome TEXT,
  status_reason TEXT,
  current_attempt_id TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  needs_attention_reason TEXT,
  github_comment_id INTEGER,
  github_comment_url TEXT,
  comment_body_hash TEXT,
  queued_at INTEGER,
  dispatched_at INTEGER,
  first_pr_at INTEGER,
  merged_at INTEGER,
  terminal_at INTEGER,
  last_activity_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX tasks_repo_issue_idx ON tasks (repository_id, issue_number);
CREATE INDEX tasks_ui_state_idx ON tasks (ui_state);
CREATE INDEX tasks_created_idx ON tasks (created_at);

CREATE TABLE devin_session_attempts (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks (id) ON DELETE CASCADE,
  attempt_number INTEGER NOT NULL,
  dispatch_tag TEXT NOT NULL,
  devin_session_id TEXT,
  devin_session_url TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  raw_status TEXT,
  status_detail TEXT,
  acus REAL,
  message_cursor TEXT,
  uncertain_dispatch INTEGER NOT NULL DEFAULT 0,
  adopted_session INTEGER NOT NULL DEFAULT 0,
  error_summary TEXT,
  dispatched_at INTEGER,
  last_reconciled_at INTEGER,
  terminal_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX attempts_task_number_idx ON devin_session_attempts (task_id, attempt_number);
CREATE UNIQUE INDEX attempts_dispatch_tag_idx ON devin_session_attempts (dispatch_tag);
CREATE UNIQUE INDEX attempts_session_idx ON devin_session_attempts (devin_session_id)
  WHERE devin_session_id IS NOT NULL;

CREATE TABLE devin_messages (
  id TEXT PRIMARY KEY,
  attempt_id TEXT NOT NULL REFERENCES devin_session_attempts (id) ON DELETE CASCADE,
  devin_message_id TEXT NOT NULL,
  source TEXT NOT NULL,
  message TEXT NOT NULL,
  message_created_at INTEGER,
  created_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX devin_messages_unique_idx ON devin_messages (attempt_id, devin_message_id);
CREATE INDEX devin_messages_attempt_idx ON devin_messages (attempt_id, message_created_at);

CREATE TABLE pull_requests (
  id TEXT PRIMARY KEY,
  task_id TEXT REFERENCES tasks (id) ON DELETE SET NULL,
  attempt_id TEXT REFERENCES devin_session_attempts (id) ON DELETE SET NULL,
  github_repo_id INTEGER,
  repository_full_name TEXT NOT NULL,
  number INTEGER NOT NULL,
  url TEXT NOT NULL,
  title TEXT,
  author_login TEXT,
  state TEXT NOT NULL DEFAULT 'open',
  merged INTEGER NOT NULL DEFAULT 0,
  merged_at INTEGER,
  pr_created_at INTEGER,
  pr_updated_at INTEGER,
  pr_closed_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX pull_requests_repo_number_idx ON pull_requests (repository_full_name, number);
CREATE INDEX pull_requests_task_idx ON pull_requests (task_id);

CREATE TABLE task_events (
  id TEXT PRIMARY KEY,
  task_id TEXT REFERENCES tasks (id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  source TEXT NOT NULL,
  summary TEXT NOT NULL,
  metadata TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX task_events_task_idx ON task_events (task_id, created_at);
CREATE INDEX task_events_created_idx ON task_events (created_at);

CREATE TABLE jobs (
  id TEXT PRIMARY KEY,
  job_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  dedupe_key TEXT,
  state TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  available_at INTEGER NOT NULL,
  lease_owner TEXT,
  lease_expires_at INTEGER,
  error_summary TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX jobs_dedupe_idx ON jobs (dedupe_key) WHERE dedupe_key IS NOT NULL;
CREATE INDEX jobs_claim_idx ON jobs (state, available_at);

CREATE TABLE settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  paused INTEGER NOT NULL DEFAULT 0,
  max_concurrent_sessions INTEGER NOT NULL DEFAULT 1,
  max_acu_limit INTEGER,
  poll_interval_seconds INTEGER NOT NULL DEFAULT 30,
  max_retry_attempts INTEGER NOT NULL DEFAULT 3,
  last_devin_contact_at INTEGER,
  last_webhook_delivery_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
`;
