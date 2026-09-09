import { NextResponse } from 'next/server';
import { config } from '@/lib/config';
import { isResponse, requireSession } from '@/lib/auth/guard';
import {
  getSettings,
  listInstallations,
  listRepositories,
  recentDeliveries,
  listRecentJobs,
} from '@/lib/db/store';
import { countPendingJobs } from '@/lib/queue/jobs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Operational status for the Configure area. Never includes secret values. */
export async function GET(): Promise<NextResponse> {
  const session = await requireSession();
  if (isResponse(session)) return session;

  const appConfig = config();
  const settings = getSettings();
  const installations = listInstallations();
  const repositories = listRepositories();

  return NextResponse.json({
    settings,
    installations,
    repositories,
    integrations: {
      github: appConfig.github.configured
        ? {
            configured: true,
            org: appConfig.github.value.GITHUB_ORG,
            appSlug: appConfig.github.value.GITHUB_APP_SLUG,
          }
        : { configured: false, missing: appConfig.github.missing },
      devin: appConfig.devin.configured
        ? { configured: true, orgId: appConfig.devin.value.DEVIN_ORG_ID }
        : { configured: false, missing: appConfig.devin.missing },
    },
    queue: {
      pending: countPendingJobs(),
      recent: listRecentJobs(10).map((job) => ({
        id: job.id,
        type: job.job_type,
        state: job.state,
        attempts: job.attempts,
        maxAttempts: job.max_attempts,
        errorSummary: job.error_summary,
        updatedAt: job.updated_at,
      })),
    },
    deliveries: recentDeliveries(10).map((delivery) => ({
      id: delivery.id,
      event: delivery.event,
      action: delivery.action,
      state: delivery.state,
      repository: delivery.repository_full_name,
      receivedAt: delivery.received_at,
    })),
    worker: { enabled: appConfig.base.WORKER_ENABLED },
  });
}
