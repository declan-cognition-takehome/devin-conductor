import Link from 'next/link';
import { AlertTriangle } from 'lucide-react';
import { config } from '@/lib/config';

export function IntegrationBanner() {
  const { github, devin } = config();
  if (github.configured && devin.configured) return null;

  const missing = [
    ...(github.configured ? [] : [`GitHub App (${github.missing.join(', ')})`]),
    ...(devin.configured ? [] : [`Devin API (${devin.missing.join(', ')})`]),
  ];

  return (
    <div
      role="status"
      className="flex items-start gap-2.5 rounded-[8px] border border-caution/35 bg-caution/[0.06] px-3 py-2.5"
    >
      <AlertTriangle aria-hidden className="mt-px h-3.5 w-3.5 shrink-0 text-caution" />
      <div className="min-w-0 text-body">
        <p className="text-ink">Automation is inactive: {missing.join(' and ')} not configured.</p>
        <p className="mt-0.5 text-meta text-ink-muted">
          Issues are not ingested and no Devin sessions are dispatched. Supply the environment
          variables and restart the container.{' '}
          <Link href="/configure" className="text-accent hover:underline">
            Configure
          </Link>{' '}
          shows current integration status.
        </p>
      </div>
    </div>
  );
}
