import { NextResponse } from 'next/server';
import { isResponse, requireMutation } from '@/lib/auth/guard';
import { addTaskEvent, getTask, updateTask } from '@/lib/db/store';
import { enqueueJob } from '@/lib/queue/jobs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Operator-initiated retry. A new attempt is queued; the previous attempt's history is
 * retained. Tasks that already produced a pull request are not retried.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const session = await requireMutation(request);
  if (isResponse(session)) return session;

  const { id } = await context.params;
  const task = getTask(id);
  if (!task) return NextResponse.json({ error: 'Task not found' }, { status: 404 });
  if (task.ui_state === 'pr_ready' || task.ui_state === 'merged') {
    return NextResponse.json({ error: 'Task already produced a pull request' }, { status: 409 });
  }
  if (task.ui_state === 'ignored') {
    return NextResponse.json({ error: 'Ignored tasks cannot be retried' }, { status: 409 });
  }
  if (task.ui_state === 'working') {
    return NextResponse.json({ error: 'A Devin session is already running' }, { status: 409 });
  }

  updateTask(id, {
    internal_state: 'queued',
    ui_state: 'queued',
    secondary_outcome: null,
    needs_attention_reason: null,
    queued_at: Date.now(),
    terminal_at: null,
  });
  addTaskEvent({
    taskId: id,
    eventType: 'retry_requested',
    source: 'user',
    summary: `Retry requested by @${session.login}`,
  });
  enqueueJob({ jobType: 'dispatch_task', entityId: id, dedupeKey: `dispatch:${id}` });
  return NextResponse.json({ ok: true });
}
