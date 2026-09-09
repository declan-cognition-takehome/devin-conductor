import { redirect } from 'next/navigation';
import { config } from '@/lib/config';
import { currentSession } from '@/lib/auth/session';

export const dynamic = 'force-dynamic';

const REASONS: Record<string, string> = {
  not_a_member: 'That GitHub account is not an active member of the configured organization.',
  invalid_state: 'The sign-in request expired or could not be verified. Please try again.',
  token_exchange_failed: 'GitHub did not complete the sign-in exchange. Please try again.',
  membership_unverified: 'Organization membership could not be verified. Please try again shortly.',
  login_failed: 'Sign-in failed. Please try again.',
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const session = await currentSession();
  if (session) redirect('/');
  const { error } = await searchParams;
  const appConfig = config();

  return (
    <div className="mx-auto flex max-w-sm flex-col gap-5 py-24">
      <div>
        <h1 className="text-page-title font-semibold tracking-[-0.01em] text-ink">
          Devin Conductor
        </h1>
        <p className="mt-2 text-body text-ink-muted">
          Turns trusted GitHub issues into managed Devin sessions. Access is limited to active
          members of the configured GitHub organization.
        </p>
      </div>

      {error && (
        <p
          role="alert"
          className="rounded-[8px] border border-critical/40 bg-critical/[0.06] px-3 py-2.5 text-body text-critical"
        >
          {REASONS[error] ?? 'Sign-in failed. Please try again.'}
        </p>
      )}

      {appConfig.github.configured ? (
        <a
          href="/api/auth/login"
          className="inline-flex h-8 items-center justify-center rounded-[6px] bg-accent px-3 text-body font-medium text-canvas transition-colors duration-150 hover:bg-accent-strong"
        >
          Continue with GitHub
        </a>
      ) : (
        <div className="rounded-[8px] border border-caution/35 bg-caution/[0.06] px-3 py-2.5 text-body text-caution">
          <p>GitHub integration is not configured, so sign-in is unavailable.</p>
          <p className="mt-1 text-meta">Missing: {appConfig.github.missing.join(', ')}</p>
        </div>
      )}
    </div>
  );
}
