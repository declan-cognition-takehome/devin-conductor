import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { config, requireGithubConfig } from '@/lib/config';
import { logger } from '@/lib/logger';
import { registerSecret, safeErrorSummary } from '@/lib/redact';
import { orgInstallationOctokit, userOctokit } from '@/lib/github/app';
import { checkOrgMembership } from '@/lib/github/membership';
import { upsertUser } from '@/lib/db/store';
import { OAUTH_STATE_COOKIE, newSession, writeSessionCookies } from '@/lib/auth/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function failure(reason: string): NextResponse {
  return NextResponse.redirect(new URL(`/login?error=${reason}`, config().base.APP_BASE_URL));
}

/**
 * Completes GitHub user authorization. Access is granted only to active members of the
 * single configured organization; membership is verified server-side on every login.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const github = requireGithubConfig();
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');

  const store = await cookies();
  const expectedState = store.get(OAUTH_STATE_COOKIE)?.value;
  store.delete(OAUTH_STATE_COOKIE);
  if (!code || !state || !expectedState || state !== expectedState) {
    return failure('invalid_state');
  }

  try {
    const tokenResponse = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify({
        client_id: github.GITHUB_CLIENT_ID,
        client_secret: github.GITHUB_CLIENT_SECRET,
        code,
        redirect_uri: new URL('/api/auth/callback', config().base.APP_BASE_URL).toString(),
      }),
    });
    const token = (await tokenResponse.json()) as { access_token?: string; error?: string };
    if (!token.access_token) return failure('token_exchange_failed');
    registerSecret(token.access_token);

    const octokit = userOctokit(token.access_token);
    const { data: profile } = await octokit.rest.users.getAuthenticated();

    const { octokit: installation } = await orgInstallationOctokit();
    const membership = await checkOrgMembership(installation, github.GITHUB_ORG, profile.login);
    if (membership.status !== 'member') {
      logger.warn('rejected login', { login: profile.login, membership: membership.status });
      if (membership.status === 'not_member') {
        upsertUser({ githubUserId: profile.id, login: profile.login, isMember: false });
        return failure('not_a_member');
      }
      return failure('membership_unverified');
    }

    upsertUser({
      githubUserId: profile.id,
      login: profile.login,
      avatarUrl: profile.avatar_url,
      isMember: true,
    });
    await writeSessionCookies(
      newSession({ userId: profile.id, login: profile.login, avatarUrl: profile.avatar_url }),
    );
    return NextResponse.redirect(new URL('/', config().base.APP_BASE_URL));
  } catch (error) {
    logger.error('login failed', { error: safeErrorSummary(error) });
    return failure('login_failed');
  }
}
