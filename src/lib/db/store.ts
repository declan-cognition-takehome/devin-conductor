import { randomUUID } from 'node:crypto';
import { db } from './index';
import { mapUiState } from '../tasks/state';
import type {
  AttemptRow,
  DevinMessageRow,
  EventSource,
  InstallationRow,
  InternalState,
  JobRow,
  PullRequestRow,
  RepositoryRow,
  SettingsRow,
  TaskEventRow,
  TaskRow,
  UiState,
  UserRow,
  WebhookDeliveryRow,
} from './types';

const now = (): number => Date.now();

/* ------------------------------------------------------------------ settings */

export function getSettings(): SettingsRow {
  const row = db().prepare<[], SettingsRow>('SELECT * FROM settings WHERE id = 1').get();
  if (!row) throw new Error('settings row missing');
  return row;
}

export interface SettingsUpdate {
  paused?: boolean;
  maxConcurrentSessions?: number;
  maxAcuLimit?: number | null;
  pollIntervalSeconds?: number;
  maxRetryAttempts?: number;
}

export function updateSettings(update: SettingsUpdate): SettingsRow {
  const current = getSettings();
  db()
    .prepare(
      `UPDATE settings SET paused = ?, max_concurrent_sessions = ?, max_acu_limit = ?,
         poll_interval_seconds = ?, max_retry_attempts = ?, updated_at = ? WHERE id = 1`,
    )
    .run(
      update.paused === undefined ? current.paused : update.paused ? 1 : 0,
      update.maxConcurrentSessions ?? current.max_concurrent_sessions,
      update.maxAcuLimit === undefined ? current.max_acu_limit : update.maxAcuLimit,
      update.pollIntervalSeconds ?? current.poll_interval_seconds,
      update.maxRetryAttempts ?? current.max_retry_attempts,
      now(),
    );
  return getSettings();
}

export function markDevinContact(at: number = now()): void {
  db()
    .prepare('UPDATE settings SET last_devin_contact_at = ?, updated_at = ? WHERE id = 1')
    .run(at, at);
}

export function markWebhookDelivery(at: number = now()): void {
  db()
    .prepare('UPDATE settings SET last_webhook_delivery_at = ?, updated_at = ? WHERE id = 1')
    .run(at, at);
}

/* --------------------------------------------------------------------- users */

export function upsertUser(input: {
  githubUserId: number;
  login: string;
  avatarUrl?: string | null;
  isMember: boolean;
  verifiedAt?: number;
}): void {
  const ts = now();
  db()
    .prepare(
      `INSERT INTO users (github_user_id, login, avatar_url, last_membership_verified_at,
         is_member, created_at, updated_at)
       VALUES (@id, @login, @avatar, @verified, @member, @ts, @ts)
       ON CONFLICT (github_user_id) DO UPDATE SET
         login = excluded.login,
         avatar_url = excluded.avatar_url,
         last_membership_verified_at = excluded.last_membership_verified_at,
         is_member = excluded.is_member,
         updated_at = excluded.updated_at`,
    )
    .run({
      id: input.githubUserId,
      login: input.login,
      avatar: input.avatarUrl ?? null,
      verified: input.verifiedAt ?? ts,
      member: input.isMember ? 1 : 0,
      ts,
    });
}

export function getUser(githubUserId: number): UserRow | undefined {
  return db()
    .prepare<[number], UserRow>('SELECT * FROM users WHERE github_user_id = ?')
    .get(githubUserId);
}

/* ------------------------------------------------------------- installations */

export function upsertInstallation(input: {
  installationId: number;
  accountId: number;
  accountLogin: string;
  accountType: string;
  status?: string;
  installedAt?: number | null;
  suspendedAt?: number | null;
  lastSyncedAt?: number | null;
}): void {
  const ts = now();
  db()
    .prepare(
      `INSERT INTO github_installations (installation_id, account_id, account_login, account_type,
         status, installed_at, suspended_at, last_synced_at, created_at, updated_at)
       VALUES (@installationId, @accountId, @accountLogin, @accountType, @status, @installedAt,
         @suspendedAt, @lastSyncedAt, @ts, @ts)
       ON CONFLICT (installation_id) DO UPDATE SET
         account_id = excluded.account_id,
         account_login = excluded.account_login,
         account_type = excluded.account_type,
         status = excluded.status,
         suspended_at = excluded.suspended_at,
         last_synced_at = COALESCE(excluded.last_synced_at, github_installations.last_synced_at),
         updated_at = excluded.updated_at`,
    )
    .run({
      installationId: input.installationId,
      accountId: input.accountId,
      accountLogin: input.accountLogin,
      accountType: input.accountType,
      status: input.status ?? 'active',
      installedAt: input.installedAt ?? ts,
      suspendedAt: input.suspendedAt ?? null,
      lastSyncedAt: input.lastSyncedAt ?? null,
      ts,
    });
}

export function listInstallations(): InstallationRow[] {
  return db()
    .prepare<[], InstallationRow>('SELECT * FROM github_installations ORDER BY installation_id')
    .all();
}

export function getInstallationForOrg(org: string): InstallationRow | undefined {
  return db()
    .prepare<[string], InstallationRow>(
      `SELECT * FROM github_installations
       WHERE lower(account_login) = lower(?) AND status = 'active'
       ORDER BY installation_id LIMIT 1`,
    )
    .get(org);
}

export function setInstallationStatus(installationId: number, status: string): void {
  db()
    .prepare('UPDATE github_installations SET status = ?, updated_at = ? WHERE installation_id = ?')
    .run(status, now(), installationId);
}

/* -------------------------------------------------------------- repositories */

export function upsertRepository(input: {
  githubRepoId: number;
  installationId: number | null;
  owner: string;
  name: string;
  fullName: string;
  defaultBranch?: string | null;
  isPrivate?: boolean;
  isInstalled?: boolean;
}): void {
  const ts = now();
  db()
    .prepare(
      `INSERT INTO repositories (github_repo_id, installation_id, owner, name, full_name,
         default_branch, is_private, is_installed, automation_enabled, created_at, updated_at)
       VALUES (@id, @installationId, @owner, @name, @fullName, @defaultBranch, @isPrivate,
         @isInstalled, 0, @ts, @ts)
       ON CONFLICT (github_repo_id) DO UPDATE SET
         installation_id = COALESCE(excluded.installation_id, repositories.installation_id),
         owner = excluded.owner,
         name = excluded.name,
         full_name = excluded.full_name,
         default_branch = COALESCE(excluded.default_branch, repositories.default_branch),
         is_private = excluded.is_private,
         is_installed = excluded.is_installed,
         updated_at = excluded.updated_at`,
    )
    .run({
      id: input.githubRepoId,
      installationId: input.installationId,
      owner: input.owner,
      name: input.name,
      fullName: input.fullName,
      defaultBranch: input.defaultBranch ?? null,
      isPrivate: input.isPrivate ? 1 : 0,
      isInstalled: input.isInstalled === false ? 0 : 1,
      ts,
    });
}

export function listRepositories(): RepositoryRow[] {
  return db().prepare<[], RepositoryRow>('SELECT * FROM repositories ORDER BY full_name').all();
}

export function getRepository(githubRepoId: number): RepositoryRow | undefined {
  return db()
    .prepare<[number], RepositoryRow>('SELECT * FROM repositories WHERE github_repo_id = ?')
    .get(githubRepoId);
}

export function setRepositoryAutomation(githubRepoId: number, enabled: boolean): void {
  db()
    .prepare(
      'UPDATE repositories SET automation_enabled = ?, updated_at = ? WHERE github_repo_id = ?',
    )
    .run(enabled ? 1 : 0, now(), githubRepoId);
}

export function markRepositoriesUninstalled(installationId: number, keepIds: number[]): void {
  const placeholders = keepIds.map(() => '?').join(',');
  const sql = keepIds.length
    ? `UPDATE repositories SET is_installed = 0, updated_at = ?
       WHERE installation_id = ? AND github_repo_id NOT IN (${placeholders})`
    : 'UPDATE repositories SET is_installed = 0, updated_at = ? WHERE installation_id = ?';
  db()
    .prepare(sql)
    .run(now(), installationId, ...keepIds);
}

/* ----------------------------------------------------------------- deliveries */

export interface DeliveryInsert {
  githubDeliveryId: string;
  event: string;
  action: string | null;
  installationId: number | null;
  repositoryId: number | null;
  repositoryFullName: string | null;
  senderId: number | null;
  senderLogin: string | null;
  payload: string;
}

/** Returns the stored delivery, or null when the delivery ID was already recorded. */
export function insertDelivery(input: DeliveryInsert): WebhookDeliveryRow | null {
  const id = randomUUID();
  const result = db()
    .prepare(
      `INSERT OR IGNORE INTO webhook_deliveries (id, github_delivery_id, event, action,
         installation_id, repository_id, repository_full_name, sender_id, sender_login,
         signature_valid, state, attempts, payload, received_at)
       VALUES (@id, @deliveryId, @event, @action, @installationId, @repositoryId, @repoFullName,
         @senderId, @senderLogin, 1, 'received', 0, @payload, @ts)`,
    )
    .run({
      id,
      deliveryId: input.githubDeliveryId,
      event: input.event,
      action: input.action,
      installationId: input.installationId,
      repositoryId: input.repositoryId,
      repoFullName: input.repositoryFullName,
      senderId: input.senderId,
      senderLogin: input.senderLogin,
      payload: input.payload,
      ts: now(),
    });
  if (result.changes === 0) return null;
  return getDelivery(id) ?? null;
}

export function getDelivery(id: string): WebhookDeliveryRow | undefined {
  return db()
    .prepare<[string], WebhookDeliveryRow>('SELECT * FROM webhook_deliveries WHERE id = ?')
    .get(id);
}

export function setDeliveryState(id: string, state: string, errorSummary?: string | null): void {
  db()
    .prepare(
      `UPDATE webhook_deliveries SET state = ?, error_summary = ?, attempts = attempts + 1,
         processed_at = ? WHERE id = ?`,
    )
    .run(state, errorSummary ?? null, now(), id);
}

export function recentDeliveries(limit = 20): WebhookDeliveryRow[] {
  return db()
    .prepare<[number], WebhookDeliveryRow>(
      'SELECT * FROM webhook_deliveries ORDER BY received_at DESC LIMIT ?',
    )
    .all(limit);
}

/* ---------------------------------------------------------------------- tasks */

export interface TaskCreate {
  repositoryId: number;
  repositoryFullName: string;
  issueId: number;
  issueNodeId: string | null;
  issueNumber: number;
  issueUrl: string;
  issueTitle: string;
  issueBody: string | null;
  authorId: number | null;
  authorLogin: string;
  issueCreatedAt: number | null;
  internalState: InternalState;
  uiState: UiState;
  statusReason?: string | null;
}

/** Creates the task, or returns the existing task for the same repository issue. */
export function createTask(input: TaskCreate): { task: TaskRow; created: boolean } {
  const existing = getTaskByIssue(input.repositoryId, input.issueNumber);
  if (existing) return { task: existing, created: false };
  const ts = now();
  const id = randomUUID();
  db()
    .prepare(
      `INSERT INTO tasks (id, repository_id, repository_full_name, issue_id, issue_node_id,
         issue_number, issue_url, issue_title, issue_body, author_id, author_login,
         issue_created_at, internal_state, ui_state, status_reason, attempt_count,
         queued_at, last_activity_at, created_at, updated_at)
       VALUES (@id, @repositoryId, @repositoryFullName, @issueId, @issueNodeId, @issueNumber,
         @issueUrl, @issueTitle, @issueBody, @authorId, @authorLogin, @issueCreatedAt,
         @internalState, @uiState, @statusReason, 0, @queuedAt, @ts, @ts, @ts)`,
    )
    .run({
      id,
      repositoryId: input.repositoryId,
      repositoryFullName: input.repositoryFullName,
      issueId: input.issueId,
      issueNodeId: input.issueNodeId,
      issueNumber: input.issueNumber,
      issueUrl: input.issueUrl,
      issueTitle: input.issueTitle,
      issueBody: input.issueBody,
      authorId: input.authorId,
      authorLogin: input.authorLogin,
      issueCreatedAt: input.issueCreatedAt,
      internalState: input.internalState,
      uiState: input.uiState,
      statusReason: input.statusReason ?? null,
      queuedAt: input.uiState === 'queued' ? ts : null,
      ts,
    });
  const task = getTask(id);
  if (!task) throw new Error('task insert failed');
  return { task, created: true };
}

export function getTask(id: string): TaskRow | undefined {
  return db().prepare<[string], TaskRow>('SELECT * FROM tasks WHERE id = ?').get(id);
}

export function getTaskByIssue(repositoryId: number, issueNumber: number): TaskRow | undefined {
  return db()
    .prepare<[number, number], TaskRow>(
      'SELECT * FROM tasks WHERE repository_id = ? AND issue_number = ?',
    )
    .get(repositoryId, issueNumber);
}

const TASK_UPDATE_COLUMNS = [
  'internal_state',
  'ui_state',
  'secondary_outcome',
  'status_reason',
  'current_attempt_id',
  'attempt_count',
  'needs_attention_reason',
  'github_comment_id',
  'github_comment_url',
  'comment_body_hash',
  'queued_at',
  'dispatched_at',
  'first_pr_at',
  'merged_at',
  'terminal_at',
  'last_activity_at',
] as const;

export type TaskUpdate = Partial<Pick<TaskRow, (typeof TASK_UPDATE_COLUMNS)[number]>>;

export function updateTask(id: string, update: TaskUpdate): void {
  const entries = Object.entries(update).filter(([key]) =>
    (TASK_UPDATE_COLUMNS as readonly string[]).includes(key),
  );
  if (entries.length === 0) return;
  const assignments = entries.map(([key]) => `${key} = ?`).join(', ');
  db()
    .prepare(`UPDATE tasks SET ${assignments}, updated_at = ? WHERE id = ?`)
    .run(...entries.map(([, value]) => value ?? null), now(), id);
}

export interface TaskListFilters {
  uiState?: UiState;
  repositoryId?: number;
  search?: string;
  limit?: number;
  offset?: number;
}

export interface TaskListItem extends TaskRow {
  acus: number | null;
  pr_url: string | null;
  pr_number: number | null;
  devin_session_url: string | null;
}

const TASK_LIST_SELECT = `
  SELECT t.*,
    (SELECT SUM(a.acus) FROM devin_session_attempts a WHERE a.task_id = t.id) AS acus,
    (SELECT p.url FROM pull_requests p WHERE p.task_id = t.id
       ORDER BY p.merged DESC, p.created_at ASC LIMIT 1) AS pr_url,
    (SELECT p.number FROM pull_requests p WHERE p.task_id = t.id
       ORDER BY p.merged DESC, p.created_at ASC LIMIT 1) AS pr_number,
    (SELECT a.devin_session_url FROM devin_session_attempts a WHERE a.task_id = t.id
       ORDER BY a.attempt_number DESC LIMIT 1) AS devin_session_url
  FROM tasks t`;

export function listTasks(filters: TaskListFilters = {}): { items: TaskListItem[]; total: number } {
  const where: string[] = [];
  const params: Array<string | number> = [];
  if (filters.uiState) {
    where.push('t.ui_state = ?');
    params.push(filters.uiState);
  }
  if (filters.repositoryId) {
    where.push('t.repository_id = ?');
    params.push(filters.repositoryId);
  }
  if (filters.search) {
    where.push('(t.issue_title LIKE ? OR t.repository_full_name LIKE ? OR t.author_login LIKE ?)');
    const like = `%${filters.search}%`;
    params.push(like, like, like);
  }
  const clause = where.length ? ` WHERE ${where.join(' AND ')}` : '';
  const limit = Math.min(filters.limit ?? 50, 200);
  const offset = filters.offset ?? 0;
  const items = db()
    .prepare<Array<string | number>, TaskListItem>(
      `${TASK_LIST_SELECT}${clause} ORDER BY t.created_at DESC LIMIT ? OFFSET ?`,
    )
    .all(...params, limit, offset);
  const totalRow = db()
    .prepare<Array<string | number>, { count: number }>(
      `SELECT COUNT(*) AS count FROM tasks t${clause}`,
    )
    .get(...params);
  return { items, total: totalRow?.count ?? 0 };
}

export function taskCountsByUiState(): Record<UiState, number> {
  const rows = db()
    .prepare<[], { ui_state: UiState; count: number }>(
      'SELECT ui_state, COUNT(*) AS count FROM tasks GROUP BY ui_state',
    )
    .all();
  const counts: Record<UiState, number> = {
    queued: 0,
    working: 0,
    pr_ready: 0,
    merged: 0,
    needs_attention: 0,
    ignored: 0,
  };
  for (const row of rows) counts[row.ui_state] = row.count;
  return counts;
}

/**
 * Recomputes the user-facing state of a task from its attempts and pull requests.
 * This is the single place where business precedence rules are applied.
 */
export function recomputeTaskState(taskId: string): TaskRow | undefined {
  const task = getTask(taskId);
  if (!task) return undefined;
  const prs = listPullRequests(taskId);
  const attempt = task.current_attempt_id ? getAttempt(task.current_attempt_id) : undefined;
  const hasMergedPr = prs.some((pr) => pr.merged === 1);
  const hasOpenPr = prs.some((pr) => pr.state === 'open' && pr.merged === 0);
  const hasClosedUnmergedPr = prs.some((pr) => pr.state === 'closed' && pr.merged === 0);

  const mapped = mapUiState({
    internalState: task.internal_state,
    hasOpenPr,
    hasMergedPr,
    hasClosedUnmergedPr,
    devinStatus: attempt?.raw_status ?? null,
    dispatchExhausted: task.internal_state === 'failed',
    anomaly: task.secondary_outcome === 'anomaly',
  });

  const firstPr = prs
    .filter((pr) => pr.pr_created_at !== null)
    .sort((a, b) => (a.pr_created_at ?? 0) - (b.pr_created_at ?? 0))[0];
  const mergedPr = prs.find((pr) => pr.merged === 1);

  updateTask(taskId, {
    ui_state: mapped.uiState,
    secondary_outcome: mapped.secondaryOutcome,
    first_pr_at: task.first_pr_at ?? firstPr?.pr_created_at ?? null,
    merged_at: task.merged_at ?? mergedPr?.merged_at ?? null,
    terminal_at:
      mapped.uiState === 'merged' || mapped.uiState === 'needs_attention'
        ? (task.terminal_at ?? now())
        : task.terminal_at,
    last_activity_at: now(),
  });
  return getTask(taskId);
}

/* ------------------------------------------------------------------- attempts */

export function createAttempt(input: {
  taskId: string;
  attemptNumber: number;
  dispatchTag: string;
}): AttemptRow {
  const ts = now();
  const id = randomUUID();
  db()
    .prepare(
      `INSERT INTO devin_session_attempts (id, task_id, attempt_number, dispatch_tag, status,
         created_at, updated_at)
       VALUES (?, ?, ?, ?, 'pending', ?, ?)`,
    )
    .run(id, input.taskId, input.attemptNumber, input.dispatchTag, ts, ts);
  const attempt = getAttempt(id);
  if (!attempt) throw new Error('attempt insert failed');
  return attempt;
}

export function getAttempt(id: string): AttemptRow | undefined {
  return db()
    .prepare<[string], AttemptRow>('SELECT * FROM devin_session_attempts WHERE id = ?')
    .get(id);
}

export function listAttempts(taskId: string): AttemptRow[] {
  return db()
    .prepare<[string], AttemptRow>(
      'SELECT * FROM devin_session_attempts WHERE task_id = ? ORDER BY attempt_number ASC',
    )
    .all(taskId);
}

const ATTEMPT_UPDATE_COLUMNS = [
  'devin_session_id',
  'devin_session_url',
  'status',
  'raw_status',
  'status_detail',
  'acus',
  'message_cursor',
  'uncertain_dispatch',
  'adopted_session',
  'error_summary',
  'dispatched_at',
  'last_reconciled_at',
  'terminal_at',
] as const;

export type AttemptUpdate = Partial<Pick<AttemptRow, (typeof ATTEMPT_UPDATE_COLUMNS)[number]>>;

export function updateAttempt(id: string, update: AttemptUpdate): void {
  const entries = Object.entries(update).filter(([key]) =>
    (ATTEMPT_UPDATE_COLUMNS as readonly string[]).includes(key),
  );
  if (entries.length === 0) return;
  const assignments = entries.map(([key]) => `${key} = ?`).join(', ');
  db()
    .prepare(`UPDATE devin_session_attempts SET ${assignments}, updated_at = ? WHERE id = ?`)
    .run(...entries.map(([, value]) => value ?? null), now(), id);
}

export function countActiveAttempts(): number {
  const row = db()
    .prepare<[], { count: number }>(
      `SELECT COUNT(*) AS count FROM devin_session_attempts
       WHERE devin_session_id IS NOT NULL AND terminal_at IS NULL`,
    )
    .get();
  return row?.count ?? 0;
}

export function listActiveAttempts(): AttemptRow[] {
  return db()
    .prepare<[], AttemptRow>(
      `SELECT * FROM devin_session_attempts
       WHERE devin_session_id IS NOT NULL AND terminal_at IS NULL
       ORDER BY created_at ASC`,
    )
    .all();
}

/* ------------------------------------------------------------------- messages */

export function insertMessages(
  attemptId: string,
  messages: Array<{
    devinMessageId: string;
    source: string;
    message: string;
    createdAt: number | null;
  }>,
): number {
  const stmt = db().prepare(
    `INSERT OR IGNORE INTO devin_messages (id, attempt_id, devin_message_id, source, message,
       message_created_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  const ts = now();
  const insertMany = db().transaction(() => {
    let inserted = 0;
    for (const message of messages) {
      const result = stmt.run(
        randomUUID(),
        attemptId,
        message.devinMessageId,
        message.source,
        message.message,
        message.createdAt,
        ts,
      );
      inserted += result.changes;
    }
    return inserted;
  });
  return insertMany();
}

export function listMessagesForTask(taskId: string, limit = 200): DevinMessageRow[] {
  return db()
    .prepare<[string, number], DevinMessageRow>(
      `SELECT m.* FROM devin_messages m
       JOIN devin_session_attempts a ON a.id = m.attempt_id
       WHERE a.task_id = ?
       ORDER BY COALESCE(m.message_created_at, m.created_at) ASC
       LIMIT ?`,
    )
    .all(taskId, limit);
}

/* -------------------------------------------------------------- pull requests */

export interface PullRequestUpsert {
  taskId: string | null;
  attemptId: string | null;
  githubRepoId: number | null;
  repositoryFullName: string;
  number: number;
  url: string;
  title?: string | null;
  authorLogin?: string | null;
  state?: string;
  merged?: boolean;
  mergedAt?: number | null;
  prCreatedAt?: number | null;
  prUpdatedAt?: number | null;
  prClosedAt?: number | null;
}

export function upsertPullRequest(input: PullRequestUpsert): PullRequestRow {
  const ts = now();
  db()
    .prepare(
      `INSERT INTO pull_requests (id, task_id, attempt_id, github_repo_id, repository_full_name,
         number, url, title, author_login, state, merged, merged_at, pr_created_at, pr_updated_at,
         pr_closed_at, created_at, updated_at)
       VALUES (@id, @taskId, @attemptId, @repoId, @fullName, @number, @url, @title, @author,
         @state, @merged, @mergedAt, @createdAt, @updatedAt, @closedAt, @ts, @ts)
       ON CONFLICT (repository_full_name, number) DO UPDATE SET
         task_id = COALESCE(pull_requests.task_id, excluded.task_id),
         attempt_id = COALESCE(pull_requests.attempt_id, excluded.attempt_id),
         github_repo_id = COALESCE(excluded.github_repo_id, pull_requests.github_repo_id),
         title = COALESCE(excluded.title, pull_requests.title),
         author_login = COALESCE(excluded.author_login, pull_requests.author_login),
         state = excluded.state,
         merged = excluded.merged,
         merged_at = COALESCE(excluded.merged_at, pull_requests.merged_at),
         pr_created_at = COALESCE(excluded.pr_created_at, pull_requests.pr_created_at),
         pr_updated_at = COALESCE(excluded.pr_updated_at, pull_requests.pr_updated_at),
         pr_closed_at = COALESCE(excluded.pr_closed_at, pull_requests.pr_closed_at),
         updated_at = excluded.updated_at`,
    )
    .run({
      id: randomUUID(),
      taskId: input.taskId,
      attemptId: input.attemptId,
      repoId: input.githubRepoId,
      fullName: input.repositoryFullName,
      number: input.number,
      url: input.url,
      title: input.title ?? null,
      author: input.authorLogin ?? null,
      state: input.state ?? 'open',
      merged: input.merged ? 1 : 0,
      mergedAt: input.mergedAt ?? null,
      createdAt: input.prCreatedAt ?? null,
      updatedAt: input.prUpdatedAt ?? null,
      closedAt: input.prClosedAt ?? null,
      ts,
    });
  const row = findPullRequest(input.repositoryFullName, input.number);
  if (!row) throw new Error('pull request upsert failed');
  return row;
}

export function findPullRequest(
  repositoryFullName: string,
  number: number,
): PullRequestRow | undefined {
  return db()
    .prepare<[string, number], PullRequestRow>(
      'SELECT * FROM pull_requests WHERE repository_full_name = ? AND number = ?',
    )
    .get(repositoryFullName, number);
}

export function listPullRequests(taskId: string): PullRequestRow[] {
  return db()
    .prepare<[string], PullRequestRow>(
      'SELECT * FROM pull_requests WHERE task_id = ? ORDER BY created_at ASC',
    )
    .all(taskId);
}

export function listOpenPullRequests(): PullRequestRow[] {
  return db()
    .prepare<[], PullRequestRow>(
      "SELECT * FROM pull_requests WHERE state = 'open' AND merged = 0 ORDER BY created_at ASC",
    )
    .all();
}

/* ---------------------------------------------------------------- task events */

export function addTaskEvent(input: {
  taskId: string | null;
  eventType: string;
  source: EventSource;
  summary: string;
  metadata?: Record<string, unknown> | null;
}): void {
  db()
    .prepare(
      `INSERT INTO task_events (id, task_id, event_type, source, summary, metadata, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      randomUUID(),
      input.taskId,
      input.eventType,
      input.source,
      input.summary,
      input.metadata ? JSON.stringify(input.metadata) : null,
      now(),
    );
}

export function listTaskEvents(taskId: string, limit = 200): TaskEventRow[] {
  return db()
    .prepare<[string, number], TaskEventRow>(
      'SELECT * FROM task_events WHERE task_id = ? ORDER BY created_at ASC LIMIT ?',
    )
    .all(taskId, limit);
}

export function listRecentJobs(limit = 20): JobRow[] {
  return db()
    .prepare<[number], JobRow>('SELECT * FROM jobs ORDER BY updated_at DESC LIMIT ?')
    .all(limit);
}
