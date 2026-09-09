import { NextResponse } from 'next/server';
import { config } from '@/lib/config';
import { logger } from '@/lib/logger';
import { verifyWebhookSignature } from '@/lib/github/webhook';
import { deliveryEnvelopeSchema } from '@/lib/github/events';
import { insertDelivery, markWebhookDelivery } from '@/lib/db/store';
import { enqueueJob } from '@/lib/queue/jobs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GitHub's documented maximum payload is 25 MB; Conductor only needs far smaller events. */
const MAX_BODY_BYTES = 2 * 1024 * 1024;

const TRACKED_EVENTS = new Set([
  'issues',
  'pull_request',
  'installation',
  'installation_repositories',
]);

export async function POST(request: Request): Promise<NextResponse> {
  const appConfig = config();
  if (!appConfig.github.configured) {
    return NextResponse.json({ error: 'GitHub integration is not configured' }, { status: 503 });
  }

  const event = request.headers.get('x-github-event');
  const deliveryId = request.headers.get('x-github-delivery');
  const signature = request.headers.get('x-hub-signature-256');
  if (!event || !deliveryId) {
    return NextResponse.json({ error: 'Missing GitHub event headers' }, { status: 400 });
  }

  const declaredLength = Number(request.headers.get('content-length') ?? '0');
  if (declaredLength > MAX_BODY_BYTES) {
    return NextResponse.json({ error: 'Payload too large' }, { status: 413 });
  }

  const rawBody = Buffer.from(await request.arrayBuffer());
  if (rawBody.byteLength > MAX_BODY_BYTES) {
    return NextResponse.json({ error: 'Payload too large' }, { status: 413 });
  }

  // Signature verification happens against the raw bytes, before any parsing or persistence.
  if (!verifyWebhookSignature(rawBody, signature, appConfig.github.value.GITHUB_WEBHOOK_SECRET)) {
    logger.warn('rejected webhook with invalid signature', { event, deliveryId });
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody.toString('utf8'));
  } catch {
    return NextResponse.json({ error: 'Invalid JSON payload' }, { status: 400 });
  }

  markWebhookDelivery();

  if (event === 'ping') {
    return NextResponse.json({ ok: true }, { status: 200 });
  }
  if (!TRACKED_EVENTS.has(event)) {
    return NextResponse.json({ accepted: false, reason: 'event not tracked' }, { status: 202 });
  }

  const envelope = deliveryEnvelopeSchema.safeParse(payload);
  const meta = envelope.success ? envelope.data : {};

  const delivery = insertDelivery({
    githubDeliveryId: deliveryId,
    event,
    action: meta.action ?? null,
    installationId: meta.installation?.id ?? null,
    repositoryId: meta.repository?.id ?? null,
    repositoryFullName: meta.repository?.full_name ?? null,
    senderId: meta.sender?.id ?? null,
    senderLogin: meta.sender?.login ?? null,
    payload: rawBody.toString('utf8'),
  });

  if (!delivery) {
    // Duplicate delivery ID: already durably recorded, so this is a no-op.
    return NextResponse.json({ accepted: true, duplicate: true }, { status: 202 });
  }

  enqueueJob({
    jobType: 'process_delivery',
    entityId: delivery.id,
    dedupeKey: `delivery:${delivery.id}`,
  });
  return NextResponse.json({ accepted: true, duplicate: false }, { status: 202 });
}
