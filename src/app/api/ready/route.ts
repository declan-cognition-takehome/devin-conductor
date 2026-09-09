import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { config } from '@/lib/config';
import { countPendingJobs } from '@/lib/queue/jobs';
import { safeErrorSummary } from '@/lib/redact';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Readiness: migrations applied and the database is writable. */
export function GET(): NextResponse {
  try {
    const row = db()
      .prepare<[], { count: number }>('SELECT COUNT(*) AS count FROM schema_migrations')
      .get();
    const appConfig = config();
    return NextResponse.json({
      status: 'ready',
      migrations: row?.count ?? 0,
      pendingJobs: countPendingJobs(),
      integrations: {
        github: appConfig.github.configured,
        devin: appConfig.devin.configured,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { status: 'unavailable', error: safeErrorSummary(error) },
      { status: 503 },
    );
  }
}
