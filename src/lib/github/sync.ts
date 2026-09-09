import { requireGithubConfig } from '../config';
import { logger } from '../logger';
import { markRepositoriesUninstalled, upsertInstallation, upsertRepository } from '../db/store';
import { appOctokit, installationOctokit } from './app';

/**
 * Refreshes installations and installed repositories for the configured organization.
 * Repositories keep their local automation flag; only installation membership is synced.
 */
export async function syncInstallations(): Promise<{
  installations: number;
  repositories: number;
}> {
  const github = requireGithubConfig();
  const app = appOctokit();
  const installations = await app.paginate(app.rest.apps.listInstallations, { per_page: 100 });

  let repositoryCount = 0;
  let installationCount = 0;

  for (const installation of installations) {
    const login =
      installation.account && 'login' in installation.account ? installation.account.login : null;
    if (!login || login.toLowerCase() !== github.GITHUB_ORG.toLowerCase()) continue;

    installationCount += 1;
    upsertInstallation({
      installationId: installation.id,
      accountId: installation.account && 'id' in installation.account ? installation.account.id : 0,
      accountLogin: login,
      accountType:
        installation.account && 'type' in installation.account
          ? String(installation.account.type)
          : 'Organization',
      status: installation.suspended_at ? 'suspended' : 'active',
      installedAt: new Date(installation.created_at).getTime(),
      suspendedAt: installation.suspended_at ? new Date(installation.suspended_at).getTime() : null,
      lastSyncedAt: Date.now(),
    });

    const octokit = await installationOctokit(installation.id);
    const repositories = await octokit.paginate(
      octokit.rest.apps.listReposAccessibleToInstallation,
      { per_page: 100 },
    );
    const keepIds: number[] = [];
    for (const repository of repositories) {
      keepIds.push(repository.id);
      upsertRepository({
        githubRepoId: repository.id,
        installationId: installation.id,
        owner: repository.owner.login,
        name: repository.name,
        fullName: repository.full_name,
        defaultBranch: repository.default_branch,
        isPrivate: repository.private,
        isInstalled: true,
      });
    }
    markRepositoriesUninstalled(installation.id, keepIds);
    repositoryCount += keepIds.length;
  }

  logger.info('github sync complete', {
    installations: installationCount,
    repositories: repositoryCount,
  });
  return { installations: installationCount, repositories: repositoryCount };
}
