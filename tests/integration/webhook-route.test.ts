import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestEnv } from '../helpers/env';

const env = setupTestEnv('webhook');

type Store = typeof import('@/lib/db/store');
type Jobs = typeof import('@/lib/queue/jobs');

let post: typeof import('@/app/api/github/webhook/route').POST;
let sign: typeof import('@/lib/github/webhook').signWebhookBody;
let store: Store;
let jobs: Jobs;
let closeDatabase: () => void;

const SECRET = 'test-webhook-secret';

function issuePayload(overrides: Record<string, unknown> = {}) {
  return {
    action: 'opened',
    issue: {
      id: 1,
      node_id: 'I_1',
      number: 11,
      title: 'Broken export',
      body: 'It breaks.',
      html_url: 'https://github.com/test-org/repo/issues/11',
      created_at: '2026-01-01T00:00:00Z',
      user: { id: 42, login: 'member' },
    },
    repository: {
      id: 900,
      full_name: 'test-org/repo',
      name: 'repo',
      owner: { login: 'test-org', id: 5 },
      default_branch: 'main',
      private: false,
    },
    sender: { id: 42, login: 'member' },
    ...overrides,
  };
}

function request(body: unknown, headers: Record<string, string>): Request {
  const raw = JSON.stringify(body);
  return new Request('https://conductor.test/api/github/webhook', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: raw,
  });
}

function signedHeaders(body: unknown, deliveryId: string, event = 'issues') {
  const raw = JSON.stringify(body);
  return {
    'x-github-event': event,
    'x-github-delivery': deliveryId,
    'x-hub-signature-256': sign(raw, SECRET),
  };
}

beforeAll(async () => {
  ({ POST: post } = await import('@/app/api/github/webhook/route'));
  ({ signWebhookBody: sign } = await import('@/lib/github/webhook'));
  store = await import('@/lib/db/store');
  jobs = await import('@/lib/queue/jobs');
  ({ closeDatabase } = await import('@/lib/db'));
});

afterAll(() => {
  closeDatabase();
  env.cleanup();
});

describe('POST /api/github/webhook', () => {
  it('rejects an invalid signature without persisting anything', async () => {
    const body = issuePayload();
    const response = await post(
      request(body, {
        'x-github-event': 'issues',
        'x-github-delivery': 'bad-signature',
        'x-hub-signature-256': `sha256=${'0'.repeat(64)}`,
      }),
    );
    expect(response.status).toBe(401);
    expect(store.recentDeliveries(50).some((d) => d.github_delivery_id === 'bad-signature')).toBe(
      false,
    );
  });

  it('rejects a request without GitHub headers', async () => {
    const response = await post(request(issuePayload(), {}));
    expect(response.status).toBe(400);
  });

  it('accepts a signed delivery, persists it and enqueues processing', async () => {
    const body = issuePayload();
    const response = await post(request(body, signedHeaders(body, 'delivery-1')));
    expect(response.status).toBe(202);

    const delivery = store.recentDeliveries(50).find((d) => d.github_delivery_id === 'delivery-1');
    expect(delivery?.state).toBe('received');
    expect(delivery?.repository_full_name).toBe('test-org/repo');
    expect(jobs.countPendingJobs()).toBeGreaterThan(0);
  });

  it('is idempotent for a repeated delivery id', async () => {
    const body = issuePayload();
    const before = jobs.countPendingJobs();
    const response = await post(request(body, signedHeaders(body, 'delivery-1')));
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ accepted: true, duplicate: true });
    expect(jobs.countPendingJobs()).toBe(before);
  });

  it('answers ping without persisting a delivery', async () => {
    const body = { zen: 'Keep it logically awesome.' };
    const response = await post(request(body, signedHeaders(body, 'ping-1', 'ping')));
    expect(response.status).toBe(200);
    expect(store.recentDeliveries(50).some((d) => d.github_delivery_id === 'ping-1')).toBe(false);
  });

  it('accepts but does not track unrelated events', async () => {
    const body = { action: 'created' };
    const response = await post(request(body, signedHeaders(body, 'star-1', 'star')));
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ accepted: false, reason: 'event not tracked' });
  });
});
