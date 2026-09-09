import { NextResponse } from 'next/server';
import { clearSessionCookies } from '@/lib/auth/session';
import { requireMutation, isResponse } from '@/lib/auth/guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<NextResponse> {
  const session = await requireMutation(request);
  if (isResponse(session)) return session;
  await clearSessionCookies();
  return NextResponse.json({ ok: true });
}
