import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { config } from '@/lib/config';
import { OAUTH_STATE_COOKIE, randomState } from '@/lib/auth/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Starts the GitHub App user authorization flow. */
export async function GET(): Promise<NextResponse> {
  const appConfig = config();
  if (!appConfig.github.configured) {
    return NextResponse.redirect(
      new URL('/login?error=github_not_configured', appConfig.base.APP_BASE_URL),
    );
  }
  const state = randomState();
  const store = await cookies();
  store.set(OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: 'lax',
    secure: appConfig.secureCookies,
    path: '/',
    maxAge: 600,
  });

  const authorizeUrl = new URL('https://github.com/login/oauth/authorize');
  authorizeUrl.searchParams.set('client_id', appConfig.github.value.GITHUB_CLIENT_ID);
  authorizeUrl.searchParams.set(
    'redirect_uri',
    new URL('/api/auth/callback', appConfig.base.APP_BASE_URL).toString(),
  );
  authorizeUrl.searchParams.set('state', state);
  return NextResponse.redirect(authorizeUrl.toString());
}
