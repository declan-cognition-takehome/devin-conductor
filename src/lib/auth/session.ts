import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';
import { config } from '../config';

export const SESSION_COOKIE = '__Host-conductor_session';
export const CSRF_COOKIE = '__Host-conductor_csrf';
export const OAUTH_STATE_COOKIE = '__Host-conductor_oauth';
export const CSRF_HEADER = 'x-conductor-csrf';

const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

export interface SessionPayload {
  userId: number;
  login: string;
  avatarUrl: string | null;
  issuedAt: number;
  expiresAt: number;
}

function sign(value: string): string {
  return createHmac('sha256', config().base.SESSION_SECRET).update(value).digest('base64url');
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/** Stateless signed session value: `<base64url(payload)>.<hmac>`. */
export function encodeSession(payload: SessionPayload): string {
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  return `${body}.${sign(body)}`;
}

export function decodeSession(value: string | undefined): SessionPayload | null {
  if (!value) return null;
  const [body, signature] = value.split('.');
  if (!body || !signature) return null;
  if (!safeEqual(signature, sign(body))) return null;
  try {
    const parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as SessionPayload;
    if (typeof parsed.userId !== 'number' || typeof parsed.login !== 'string') return null;
    if (typeof parsed.expiresAt !== 'number' || parsed.expiresAt < Date.now()) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function newSession(user: {
  userId: number;
  login: string;
  avatarUrl: string | null;
}): SessionPayload {
  const issuedAt = Date.now();
  return { ...user, issuedAt, expiresAt: issuedAt + SESSION_TTL_MS };
}

function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: config().secureCookies,
    path: '/',
  };
}

export async function writeSessionCookies(payload: SessionPayload): Promise<string> {
  const store = await cookies();
  const csrfToken = randomBytes(32).toString('base64url');
  store.set(SESSION_COOKIE, encodeSession(payload), {
    ...cookieOptions(),
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  });
  // Readable by the browser so the client can echo it back in a header (double submit).
  store.set(CSRF_COOKIE, csrfToken, {
    ...cookieOptions(),
    httpOnly: false,
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  });
  return csrfToken;
}

export async function clearSessionCookies(): Promise<void> {
  const store = await cookies();
  for (const name of [SESSION_COOKIE, CSRF_COOKIE, OAUTH_STATE_COOKIE]) {
    store.set(name, '', { ...cookieOptions(), httpOnly: name !== CSRF_COOKIE, maxAge: 0 });
  }
}

export async function currentSession(): Promise<SessionPayload | null> {
  const store = await cookies();
  return decodeSession(store.get(SESSION_COOKIE)?.value);
}

/** Double-submit CSRF check for every state-changing request. */
export async function verifyCsrf(request: Request): Promise<boolean> {
  const store = await cookies();
  const cookieToken = store.get(CSRF_COOKIE)?.value;
  const headerToken = request.headers.get(CSRF_HEADER);
  if (!cookieToken || !headerToken) return false;
  return safeEqual(cookieToken, headerToken);
}

export function randomState(): string {
  return randomBytes(24).toString('base64url');
}
