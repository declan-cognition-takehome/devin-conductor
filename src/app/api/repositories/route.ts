import { NextResponse } from 'next/server';
import { z } from 'zod';
import { isResponse, requireMutation, requireSession } from '@/lib/auth/guard';
import { addTaskEvent, listRepositories, setRepositoryAutomation } from '@/lib/db/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  const session = await requireSession();
  if (isResponse(session)) return session;
  return NextResponse.json({ repositories: listRepositories() });
}

const patchSchema = z
  .object({ githubRepoId: z.number().int(), automationEnabled: z.boolean() })
  .strict();

/** Local automation allowlist. Installing the App does not by itself enable automation. */
export async function PATCH(request: Request): Promise<NextResponse> {
  const session = await requireMutation(request);
  if (isResponse(session)) return session;

  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 });

  setRepositoryAutomation(parsed.data.githubRepoId, parsed.data.automationEnabled);
  addTaskEvent({
    taskId: null,
    eventType: 'repository_automation_changed',
    source: 'user',
    summary: `@${session.login} ${parsed.data.automationEnabled ? 'enabled' : 'disabled'} automation for repository ${parsed.data.githubRepoId}`,
  });
  return NextResponse.json({ repositories: listRepositories() });
}
