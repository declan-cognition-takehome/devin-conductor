import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestEnv } from '../helpers/env';

const env = setupTestEnv('session');

let decodeSession: typeof import('@/lib/auth/session').decodeSession;
let encodeSession: typeof import('@/lib/auth/session').encodeSession;
let newSession: typeof import('@/lib/auth/session').newSession;

beforeAll(async () => {
  ({ decodeSession, encodeSession, newSession } = await import('@/lib/auth/session'));
});

afterAll(() => env.cleanup());

describe('signed session cookies', () => {
  it('round-trips an issued session', () => {
    const payload = newSession({ userId: 42, login: 'member', avatarUrl: null });
    expect(decodeSession(encodeSession(payload))).toEqual(payload);
  });

  it('rejects a tampered payload', () => {
    const payload = newSession({ userId: 42, login: 'member', avatarUrl: null });
    const [, signature] = encodeSession(payload).split('.');
    const forged = Buffer.from(JSON.stringify({ ...payload, userId: 1 }), 'utf8').toString(
      'base64url',
    );
    expect(decodeSession(`${forged}.${signature}`)).toBeNull();
  });

  it('rejects an expired session', () => {
    const payload = newSession({ userId: 42, login: 'member', avatarUrl: null });
    expect(decodeSession(encodeSession({ ...payload, expiresAt: Date.now() - 1 }))).toBeNull();
  });

  it.each([undefined, '', 'no-signature', 'a.b'])('rejects malformed value %s', (value) => {
    expect(decodeSession(value)).toBeNull();
  });
});
