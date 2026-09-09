import { NextResponse } from 'next/server';
import { isResponse, requireMutation } from '@/lib/auth/guard';
import { config } from '@/lib/config';
import { devinClient } from '@/lib/devin/client';
import { markDevinContact } from '@/lib/db/store';
import { safeErrorSummary } from '@/lib/redact';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Read-only connection check. The credential itself is never returned. */
export async function POST(request: Request): Promise<NextResponse> {
  const session = await requireMutation(request);
  if (isResponse(session)) return session;
  if (!config().devin.configured) {
    return NextResponse.json(
      { ok: false, error: 'Devin integration is not configured' },
      { status: 503 },
    );
  }
  try {
    await devinClient().connectionTest();
    markDevinContact();
    return NextResponse.json({ ok: true, checkedAt: Date.now() });
  } catch (error) {
    return NextResponse.json({ ok: false, error: safeErrorSummary(error) }, { status: 502 });
  }
}
