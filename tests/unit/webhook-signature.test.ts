import { describe, expect, it } from 'vitest';
import { signWebhookBody, verifyWebhookSignature } from '@/lib/github/webhook';

const SECRET = 'webhook-secret';
const BODY = JSON.stringify({ action: 'opened', hello: 'wörld' });

describe('verifyWebhookSignature', () => {
  it('accepts a signature over the exact raw body', () => {
    expect(verifyWebhookSignature(BODY, signWebhookBody(BODY, SECRET), SECRET)).toBe(true);
  });

  it('rejects a signature computed over different bytes', () => {
    const signature = signWebhookBody(BODY, SECRET);
    expect(verifyWebhookSignature(`${BODY} `, signature, SECRET)).toBe(false);
  });

  it('rejects a signature made with the wrong secret', () => {
    expect(verifyWebhookSignature(BODY, signWebhookBody(BODY, 'other'), SECRET)).toBe(false);
  });

  it.each([
    ['missing header', null],
    ['wrong algorithm prefix', 'sha1=abc'],
    ['non-hex digest', `sha256=${'z'.repeat(64)}`],
    ['truncated digest', 'sha256=deadbeef'],
    ['empty', ''],
  ])('rejects %s', (_label, header) => {
    expect(verifyWebhookSignature(BODY, header, SECRET)).toBe(false);
  });

  it('rejects when no secret is configured', () => {
    expect(verifyWebhookSignature(BODY, signWebhookBody(BODY, SECRET), '')).toBe(false);
  });
});
