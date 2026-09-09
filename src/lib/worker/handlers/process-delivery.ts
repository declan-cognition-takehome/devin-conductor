import { requireGithubConfig } from '../../config';
import { logger } from '../../logger';
import {
  addTaskEvent,
  createTask,
  getDelivery,
  getRepository,
  getTaskByIssue,
  markRepositoriesUninstalled,
  recomputeTaskState,
  setDeliveryState,
  setInstallationStatus,
  upsertInstallation,
  upsertPullRequest,
  upsertRepository,
  upsertUser,
} from '../../db/store';
import { enqueueJob } from '../../queue/jobs';
import { orgInstallationOctokit } from '../../github/app';
import { checkOrgMembership } from '../../github/membership';
import {
  installationEventSchema,
  installationRepositoriesEventSchema,
  issuesEventSchema,
  pullRequestEventSchema,
} from '../../github/events';
import { syncInstallations } from '../../github/sync';

/** Thrown for conditions that should retry with backoff rather than be dropped. */
export class TransientProcessingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TransientProcessingError';
  }
}

export async function processDelivery(deliveryId: string): Promise<void> {
  const delivery = getDelivery(deliveryId);
  if (!delivery) return;
  if (delivery.state === 'processed' || delivery.state === 'ignored') return;

  const payload: unknown = JSON.parse(delivery.payload);
  const log = logger.child({ deliveryId: delivery.github_delivery_id, event: delivery.event });

  switch (delivery.event) {
    case 'issues':
      await handleIssues(deliveryId, payload, log);
      break;
    case 'pull_request':
      await handlePullRequest(deliveryId, payload);
      break;
    case 'installation':
      await handleInstallation(deliveryId, payload);
      break;
    case 'installation_repositories':
      await handleInstallationRepositories(deliveryId, payload);
      break;
    default:
      setDeliveryState(deliveryId, 'ignored', `unhandled event ${delivery.event}`);
  }
}

async function handleIssues(
  deliveryId: string,
  payload: unknown,
  log: ReturnType<typeof logger.child>,
): Promise<void> {
  const parsed = issuesEventSchema.safeParse(payload);
  if (!parsed.success) {
    setDeliveryState(deliveryId, 'ignored', 'issues payload did not match expected shape');
    return;
  }
  const event = parsed.data;
  if (event.action !== 'opened') {
    setDeliveryState(deliveryId, 'ignored', `issues action ${event.action} does not start tasks`);
    return;
  }

  const github = requireGithubConfig();
  const repository = getRepository(event.repository.id);
  const author = event.issue.user;

  const ignore = (reason: string): void => {
    const existing = getTaskByIssue(event.repository.id, event.issue.number);
    const task =
      existing ??
      createTask({
        repositoryId: event.repository.id,
        repositoryFullName: event.repository.full_name,
        issueId: event.issue.id,
        issueNodeId: event.issue.node_id ?? null,
        issueNumber: event.issue.number,
        issueUrl: event.issue.html_url,
        issueTitle: event.issue.title,
        // Untrusted issues never reach Devin, so the body is not retained.
        issueBody: null,
        authorId: author?.id ?? null,
        authorLogin: author?.login ?? 'unknown',
        issueCreatedAt: Date.parse(event.issue.created_at),
        internalState: 'ignored',
        uiState: 'ignored',
        statusReason: reason,
      }).task;
    addTaskEvent({
      taskId: task.id,
      eventType: 'ignored',
      source: 'devin_conductor',
      summary: reason,
    });
    setDeliveryState(deliveryId, 'processed', null);
    log.info('issue ignored by trust policy', { reason, repo: event.repository.full_name });
  };

  if (event.repository.owner.login.toLowerCase() !== github.GITHUB_ORG.toLowerCase()) {
    ignore('Ignored — repository is outside the configured organization');
    return;
  }
  if (!repository || repository.is_installed === 0) {
    ignore('Ignored — repository is not part of an active GitHub App installation');
    return;
  }
  if (repository.automation_enabled === 0) {
    ignore('Ignored — automation is disabled for this repository');
    return;
  }
  if (!author) {
    ignore('Ignored — issue author could not be identified');
    return;
  }

  const { octokit } = await orgInstallationOctokit();
  const membership = await checkOrgMembership(octokit, github.GITHUB_ORG, author.login);
  if (membership.status === 'unknown') {
    // Fail closed but keep retrying: a transient GitHub failure must not start Devin,
    // and must not be recorded as a definitive rejection either.
    throw new TransientProcessingError(`membership check inconclusive: ${membership.reason}`);
  }
  upsertUser({
    githubUserId: author.id,
    login: author.login,
    isMember: membership.status === 'member',
  });
  if (membership.status === 'not_member') {
    ignore('Ignored — untrusted author (not an active organization member)');
    return;
  }

  const { task, created } = createTask({
    repositoryId: event.repository.id,
    repositoryFullName: event.repository.full_name,
    issueId: event.issue.id,
    issueNodeId: event.issue.node_id ?? null,
    issueNumber: event.issue.number,
    issueUrl: event.issue.html_url,
    issueTitle: event.issue.title,
    issueBody: event.issue.body ?? null,
    authorId: author.id,
    authorLogin: author.login,
    issueCreatedAt: Date.parse(event.issue.created_at),
    internalState: 'queued',
    uiState: 'queued',
  });

  if (created) {
    addTaskEvent({
      taskId: task.id,
      eventType: 'task_created',
      source: 'github',
      summary: `Issue #${event.issue.number} accepted from ${event.repository.full_name}`,
      metadata: { author: author.login },
    });
    enqueueJob({ jobType: 'dispatch_task', entityId: task.id, dedupeKey: `dispatch:${task.id}` });
  }
  setDeliveryState(deliveryId, 'processed', null);
}

async function handlePullRequest(deliveryId: string, payload: unknown): Promise<void> {
  const parsed = pullRequestEventSchema.safeParse(payload);
  if (!parsed.success) {
    setDeliveryState(deliveryId, 'ignored', 'pull_request payload did not match expected shape');
    return;
  }
  const event = parsed.data;
  const pr = event.pull_request;
  const existing = upsertPullRequest({
    taskId: null,
    attemptId: null,
    githubRepoId: event.repository.id,
    repositoryFullName: event.repository.full_name,
    number: pr.number,
    url: pr.html_url,
    title: pr.title ?? null,
    authorLogin: pr.user?.login ?? null,
    state: pr.merged ? 'closed' : pr.state,
    merged: Boolean(pr.merged),
    mergedAt: pr.merged_at ? Date.parse(pr.merged_at) : null,
    prCreatedAt: Date.parse(pr.created_at),
    prUpdatedAt: pr.updated_at ? Date.parse(pr.updated_at) : null,
    prClosedAt: pr.closed_at ? Date.parse(pr.closed_at) : null,
  });

  if (existing.task_id) {
    addTaskEvent({
      taskId: existing.task_id,
      eventType: `pull_request_${event.action}`,
      source: 'github',
      summary: `Pull request #${pr.number} ${pr.merged ? 'merged' : event.action}`,
      metadata: { url: pr.html_url },
    });
    recomputeTaskState(existing.task_id);
    enqueueJob({
      jobType: 'sync_comment',
      entityId: existing.task_id,
      dedupeKey: `comment:${existing.task_id}`,
    });
  }
  setDeliveryState(deliveryId, 'processed', null);
}

async function handleInstallation(deliveryId: string, payload: unknown): Promise<void> {
  const parsed = installationEventSchema.safeParse(payload);
  if (!parsed.success) {
    setDeliveryState(deliveryId, 'ignored', 'installation payload did not match expected shape');
    return;
  }
  const event = parsed.data;
  const account = event.installation.account;
  if (account) {
    upsertInstallation({
      installationId: event.installation.id,
      accountId: account.id,
      accountLogin: account.login,
      accountType: account.type ?? 'Organization',
      status:
        event.action === 'deleted'
          ? 'deleted'
          : event.action === 'suspend'
            ? 'suspended'
            : 'active',
    });
  }
  if (event.action === 'deleted') {
    markRepositoriesUninstalled(event.installation.id, []);
    setInstallationStatus(event.installation.id, 'deleted');
  } else {
    await syncInstallations();
  }
  setDeliveryState(deliveryId, 'processed', null);
}

async function handleInstallationRepositories(deliveryId: string, payload: unknown): Promise<void> {
  const parsed = installationRepositoriesEventSchema.safeParse(payload);
  if (!parsed.success) {
    setDeliveryState(deliveryId, 'ignored', 'installation_repositories payload mismatch');
    return;
  }
  const event = parsed.data;
  for (const repository of event.repositories_added ?? []) {
    const [owner, name] = repository.full_name.split('/');
    upsertRepository({
      githubRepoId: repository.id,
      installationId: event.installation.id,
      owner: owner ?? '',
      name: name ?? repository.full_name,
      fullName: repository.full_name,
      isInstalled: true,
    });
  }
  for (const repository of event.repositories_removed ?? []) {
    const [owner, name] = repository.full_name.split('/');
    upsertRepository({
      githubRepoId: repository.id,
      installationId: event.installation.id,
      owner: owner ?? '',
      name: name ?? repository.full_name,
      fullName: repository.full_name,
      isInstalled: false,
    });
  }
  setDeliveryState(deliveryId, 'processed', null);
}
