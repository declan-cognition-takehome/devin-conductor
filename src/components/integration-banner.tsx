import Link from 'next/link';
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
      className="rounded-lg border border-caution/40 bg-caution/5 p-3 text-sm text-caution"
    >
      <p>
        Automation is inactive: {missing.join(' and ')} not configured. Issues are not ingested and
        no Devin sessions are dispatched, so this view stays empty.
      </p>
      <p className="mt-1 text-xs">
        Supply the environment variables and restart the container.{' '}
        <Link href="/configure" className="underline">
          Configure
        </Link>{' '}
        shows current integration status.
      </p>
    </div>
  );
}
