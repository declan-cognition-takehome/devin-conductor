import { Octokit } from '@octokit/rest';
import { createAppAuth } from '@octokit/auth-app';
import { requireGithubConfig } from '../config';
import { getInstallationForOrg } from '../db/store';

const REQUEST_TIMEOUT_MS = 15_000;

function requestDefaults() {
  return {
    request: {
      timeout: REQUEST_TIMEOUT_MS,
    },
    userAgent: 'devin-conductor',
  };
}

/** App-level client (JWT auth) — used for installation discovery only. */
export function appOctokit(): Octokit {
  const github = requireGithubConfig();
  return new Octokit({
    authStrategy: createAppAuth,
    auth: {
      appId: github.GITHUB_APP_ID,
      privateKey: github.privateKey,
      clientId: github.GITHUB_CLIENT_ID,
      clientSecret: github.GITHUB_CLIENT_SECRET,
    },
    ...requestDefaults(),
  });
}

interface CachedToken {
  token: string;
  expiresAt: number;
}

const tokenCache = new Map<number, CachedToken>();
const TOKEN_SAFETY_MARGIN_MS = 60_000;

/**
 * Installation access tokens are short-lived; they are cached in memory only and never
 * written to SQLite or exposed to the browser.
 */
export async function installationToken(installationId: number): Promise<string> {
  const cached = tokenCache.get(installationId);
  if (cached && cached.expiresAt - TOKEN_SAFETY_MARGIN_MS > Date.now()) {
    return cached.token;
  }
  const github = requireGithubConfig();
  const auth = createAppAuth({
    appId: github.GITHUB_APP_ID,
    privateKey: github.privateKey,
    clientId: github.GITHUB_CLIENT_ID,
    clientSecret: github.GITHUB_CLIENT_SECRET,
  });
  const result = await auth({ type: 'installation', installationId });
  tokenCache.set(installationId, {
    token: result.token,
    expiresAt: new Date(result.expiresAt).getTime(),
  });
  return result.token;
}

export async function installationOctokit(installationId: number): Promise<Octokit> {
  const token = await installationToken(installationId);
  return new Octokit({ auth: token, ...requestDefaults() });
}

export function userOctokit(token: string): Octokit {
  return new Octokit({ auth: token, ...requestDefaults() });
}

export class MissingInstallationError extends Error {
  constructor(org: string) {
    super(`No active GitHub App installation found for organization ${org}`);
    this.name = 'MissingInstallationError';
  }
}

/** Resolves the installation client for the single configured organization. */
export async function orgInstallationOctokit(): Promise<{
  octokit: Octokit;
  installationId: number;
}> {
  const github = requireGithubConfig();
  const installation = getInstallationForOrg(github.GITHUB_ORG);
  if (!installation) throw new MissingInstallationError(github.GITHUB_ORG);
  return {
    octokit: await installationOctokit(installation.installation_id),
    installationId: installation.installation_id,
  };
}

export function clearTokenCache(): void {
  tokenCache.clear();
}
