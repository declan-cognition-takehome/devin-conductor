import { NextResponse } from 'next/server';
import { isResponse, requireMutation } from '@/lib/auth/guard';
import { syncInstallations } from '@/lib/github/sync';
import { listInstallations, listRepositories } from '@/lib/db/store';
import { safeErrorSummary } from '@/lib/redact';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<NextResponse> {
  const session = await requireMutation(request);
  if (isResponse(session)) return session;
  try {
    await syncInstallations();
    return NextResponse.json({
      installations: listInstallations(),
      repositories: listRepositories(),
    });
  } catch (error) {
    return NextResponse.json({ error: safeErrorSummary(error) }, { status: 502 });
  }
}
