import { NextResponse } from 'next/server';
import { isResponse, requireSession } from '@/lib/auth/guard';
import { collectMetrics } from '@/lib/metrics';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<NextResponse> {
  const session = await requireSession();
  if (isResponse(session)) return session;
  const days = Number(new URL(request.url).searchParams.get('days') ?? 30);
  const windowDays = Number.isFinite(days) ? Math.min(Math.max(Math.trunc(days), 1), 365) : 30;
  return NextResponse.json(collectMetrics(windowDays));
}
