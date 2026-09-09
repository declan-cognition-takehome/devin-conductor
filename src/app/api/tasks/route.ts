import { NextResponse } from 'next/server';
import { isResponse, requireSession } from '@/lib/auth/guard';
import { listTasks, taskCountsByUiState } from '@/lib/db/store';
import type { UiState } from '@/lib/db/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UI_STATES: UiState[] = [
  'queued',
  'working',
  'pr_ready',
  'merged',
  'needs_attention',
  'closed',
  'ignored',
];

export async function GET(request: Request): Promise<NextResponse> {
  const session = await requireSession();
  if (isResponse(session)) return session;

  const url = new URL(request.url);
  const stateParam = url.searchParams.get('state');
  const repositoryId = url.searchParams.get('repositoryId');
  const limit = Math.min(Number(url.searchParams.get('limit') ?? 50) || 50, 200);
  const offset = Math.max(Number(url.searchParams.get('offset') ?? 0) || 0, 0);

  const { items, total } = listTasks({
    uiState: UI_STATES.includes(stateParam as UiState) ? (stateParam as UiState) : undefined,
    repositoryId: repositoryId ? Number(repositoryId) : undefined,
    search: url.searchParams.get('search') ?? undefined,
    limit,
    offset,
  });

  return NextResponse.json({
    items,
    total,
    counts: taskCountsByUiState(),
    limit,
    offset,
  });
}
