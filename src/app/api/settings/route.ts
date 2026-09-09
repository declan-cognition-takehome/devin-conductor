import { NextResponse } from 'next/server';
import { z } from 'zod';
import { isResponse, requireMutation, requireSession } from '@/lib/auth/guard';
import { getSettings, updateSettings } from '@/lib/db/store';
import { addTaskEvent } from '@/lib/db/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const patchSchema = z
  .object({
    paused: z.boolean().optional(),
    maxConcurrentSessions: z.number().int().min(1).max(20).optional(),
    maxAcuLimit: z.number().int().min(1).max(1000).nullable().optional(),
    acuRateUsd: z.number().min(0).max(1000).nullable().optional(),
    estimateUnmeteredCosts: z.boolean().optional(),
    pollIntervalSeconds: z.number().int().min(10).max(3600).optional(),
    maxRetryAttempts: z.number().int().min(1).max(10).optional(),
  })
  .strict();

export async function GET(): Promise<NextResponse> {
  const session = await requireSession();
  if (isResponse(session)) return session;
  return NextResponse.json({ settings: getSettings() });
}

export async function PATCH(request: Request): Promise<NextResponse> {
  const session = await requireMutation(request);
  if (isResponse(session)) return session;

  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid settings', issues: parsed.error.issues.map((i) => i.message) },
      { status: 400 },
    );
  }
  const settings = updateSettings(parsed.data);
  addTaskEvent({
    taskId: null,
    eventType: 'settings_updated',
    source: 'user',
    summary: `Settings updated by @${session.login}`,
    metadata: parsed.data,
  });
  return NextResponse.json({ settings });
}
