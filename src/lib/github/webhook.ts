import { createHmac, timingSafeEqual } from 'node:crypto';

export const MAX_WEBHOOK_BODY_BYTES = 2_000_000;

/**
 * Verifies GitHub's `X-Hub-Signature-256` header over the raw request body using a
 * timing-safe comparison. Any malformed or missing signature is rejected.
 */
export function verifyWebhookSignature(
  rawBody: string | Buffer,
  signatureHeader: string | null | undefined,
  secret: string,
): boolean {
  if (!signatureHeader || !secret) return false;
  if (!signatureHeader.startsWith('sha256=')) return false;
  const provided = signatureHeader.slice('sha256='.length);
  if (!/^[a-f0-9]{64}$/i.test(provided)) return false;

  const expected = createHmac('sha256', secret)
    .update(typeof rawBody === 'string' ? Buffer.from(rawBody, 'utf8') : rawBody)
    .digest('hex');

  const providedBuffer = Buffer.from(provided.toLowerCase(), 'utf8');
  const expectedBuffer = Buffer.from(expected, 'utf8');
  if (providedBuffer.length !== expectedBuffer.length) return false;
  return timingSafeEqual(providedBuffer, expectedBuffer);
}

export function signWebhookBody(rawBody: string, secret: string): string {
  return `sha256=${createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex')}`;
}
