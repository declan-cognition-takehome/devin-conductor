import { NextResponse } from 'next/server';
import { isResponse, requireSession } from '@/lib/auth/guard';
import {
  getTask,
  listAttempts,
  listMessagesForTask,
  listPullRequests,
  listTaskEvents,
} from '@/lib/db/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const session = await requireSession();
  if (isResponse(session)) return session;

  const { id } = await context.params;
  const task = getTask(id);
  if (!task) return NextResponse.json({ error: 'Task not found' }, { status: 404 });

  return NextResponse.json({
    task,
    attempts: listAttempts(id),
    pullRequests: listPullRequests(id),
    events: listTaskEvents(id),
    messages: listMessagesForTask(id),
  });
}
