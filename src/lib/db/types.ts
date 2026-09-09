export type UiState =
  'queued' | 'working' | 'pr_ready' | 'merged' | 'needs_attention' | 'closed' | 'ignored';

export type InternalState =
  | 'received'
  | 'authorizing'
  | 'queued'
  | 'dispatching'
  | 'running'
  | 'session_terminal'
  | 'pr_open'
  | 'pr_merged'
  | 'failed'
  | 'ignored';

export type SecondaryOutcome =
  | 'completed_without_pr'
  | 'pr_closed_unmerged'
  | 'externally_cancelled'
  | 'dispatch_exhausted'
  | 'devin_error'
  | 'devin_suspended'
  | 'awaiting_input'
  | 'anomaly';

export type EventSource = 'github' | 'devin_conductor' | 'devin' | 'user';

export interface UserRow {
  github_user_id: number;
  login: string;
  avatar_url: string | null;
  last_membership_verified_at: number | null;
  is_member: number;
  created_at: number;
  updated_at: number;
}

export interface InstallationRow {
  installation_id: number;
  account_id: number;
  account_login: string;
  account_type: string;
  status: string;
  installed_at: number | null;
  suspended_at: number | null;
  last_synced_at: number | null;
  created_at: number;
  updated_at: number;
}

export interface RepositoryRow {
  github_repo_id: number;
  installation_id: number | null;
  owner: string;
  name: string;
  full_name: string;
  default_branch: string | null;
  is_private: number;
  is_installed: number;
  automation_enabled: number;
  created_at: number;
  updated_at: number;
}

export interface WebhookDeliveryRow {
  id: string;
  github_delivery_id: string;
  event: string;
  action: string | null;
  installation_id: number | null;
  repository_id: number | null;
  repository_full_name: string | null;
  sender_id: number | null;
  sender_login: string | null;
  signature_valid: number;
  state: string;
  attempts: number;
  payload: string;
  error_summary: string | null;
  received_at: number;
  processed_at: number | null;
}

export interface TaskRow {
  id: string;
  repository_id: number;
  repository_full_name: string;
  issue_id: number;
  issue_node_id: string | null;
  issue_number: number;
  issue_url: string;
  issue_title: string;
  issue_body: string | null;
  author_id: number | null;
  author_login: string;
  issue_created_at: number | null;
  issue_state: 'open' | 'closed';
  issue_closed_at: number | null;
  internal_state: InternalState;
  ui_state: UiState;
  secondary_outcome: SecondaryOutcome | null;
  status_reason: string | null;
  current_attempt_id: string | null;
  attempt_count: number;
  needs_attention_reason: string | null;
  github_comment_id: number | null;
  github_comment_url: string | null;
  comment_body_hash: string | null;
  queued_at: number | null;
  dispatched_at: number | null;
  first_pr_at: number | null;
  merged_at: number | null;
  terminal_at: number | null;
  last_activity_at: number | null;
  created_at: number;
  updated_at: number;
}

export interface AttemptRow {
  id: string;
  task_id: string;
  attempt_number: number;
  dispatch_tag: string;
  devin_session_id: string | null;
  devin_session_url: string | null;
  status: string;
  raw_status: string | null;
  status_detail: string | null;
  acus: number | null;
  message_cursor: string | null;
  uncertain_dispatch: number;
  adopted_session: number;
  error_summary: string | null;
  dispatched_at: number | null;
  last_reconciled_at: number | null;
  terminal_at: number | null;
  created_at: number;
  updated_at: number;
}

export interface DevinMessageRow {
  id: string;
  attempt_id: string;
  devin_message_id: string;
  source: string;
  message: string;
  message_created_at: number | null;
  created_at: number;
}

export interface PullRequestRow {
  id: string;
  task_id: string | null;
  attempt_id: string | null;
  github_repo_id: number | null;
  repository_full_name: string;
  number: number;
  url: string;
  title: string | null;
  author_login: string | null;
  state: string;
  merged: number;
  merged_at: number | null;
  pr_created_at: number | null;
  pr_updated_at: number | null;
  pr_closed_at: number | null;
  created_at: number;
  updated_at: number;
}

export interface TaskEventRow {
  id: string;
  task_id: string | null;
  event_type: string;
  source: EventSource;
  summary: string;
  metadata: string | null;
  created_at: number;
}

export type JobType =
  | 'process_delivery'
  | 'dispatch_task'
  | 'reconcile_attempt'
  | 'sync_comment'
  | 'reconcile_pull_request';

export type JobState = 'pending' | 'claimed' | 'done' | 'failed';

export interface JobRow {
  id: string;
  job_type: JobType;
  entity_id: string;
  dedupe_key: string | null;
  state: JobState;
  attempts: number;
  max_attempts: number;
  available_at: number;
  lease_owner: string | null;
  lease_expires_at: number | null;
  error_summary: string | null;
  created_at: number;
  updated_at: number;
}

export interface SettingsRow {
  id: number;
  paused: number;
  max_concurrent_sessions: number;
  max_acu_limit: number | null;
  poll_interval_seconds: number;
  max_retry_attempts: number;
  last_devin_contact_at: number | null;
  last_webhook_delivery_at: number | null;
  created_at: number;
  updated_at: number;
}
