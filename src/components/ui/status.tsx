import type { LucideIcon } from 'lucide-react';
import {
  AlertTriangle,
  CircleDashed,
  CircleSlash,
  GitMerge,
  GitPullRequestArrow,
  Loader,
  Timer,
} from 'lucide-react';
import clsx from 'clsx';
import type { UiState } from '@/lib/db/types';

export const STATE_LABELS: Record<UiState, string> = {
  queued: 'Queued',
  working: 'Working',
  pr_ready: 'PR ready',
  merged: 'Merged',
  needs_attention: 'Needs attention',
  closed: 'Issue closed',
  ignored: 'Ignored',
};

const STATE_ICONS: Record<UiState, LucideIcon> = {
  queued: Timer,
  working: Loader,
  pr_ready: GitPullRequestArrow,
  merged: GitMerge,
  needs_attention: AlertTriangle,
  closed: CircleDashed,
  ignored: CircleSlash,
};

const STATE_TONES: Record<UiState, string> = {
  queued: 'text-ink-muted',
  working: 'text-accent',
  pr_ready: 'text-positive',
  merged: 'text-positive',
  needs_attention: 'text-caution',
  closed: 'text-ink-faint',
  ignored: 'text-ink-faint',
};

/** Icon + label, deliberately not a coloured capsule: colour is never the only signal. */
export function StateIndicator({
  state,
  className,
  size = 'md',
}: {
  state: UiState;
  className?: string;
  size?: 'sm' | 'md';
}) {
  const Icon = STATE_ICONS[state];
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1.5 whitespace-nowrap',
        size === 'sm' ? 'text-meta' : 'text-body',
        state === 'ignored' || state === 'closed' ? 'text-ink-muted' : 'text-ink',
        className,
      )}
    >
      <Icon
        aria-hidden
        className={clsx('h-3.5 w-3.5 shrink-0', STATE_TONES[state], {
          'live-dot': state === 'working',
        })}
      />
      {STATE_LABELS[state]}
    </span>
  );
}

export type Tone = 'neutral' | 'accent' | 'positive' | 'caution' | 'critical';

const DOT_TONES: Record<Tone, string> = {
  neutral: 'bg-ink-faint',
  accent: 'bg-accent',
  positive: 'bg-positive',
  caution: 'bg-caution',
  critical: 'bg-critical',
};

export function StatusDot({
  tone,
  live = false,
  className,
}: {
  tone: Tone;
  live?: boolean;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={clsx(
        'inline-block h-1.5 w-1.5 shrink-0 rounded-full',
        DOT_TONES[tone],
        live && 'live-dot',
        className,
      )}
    />
  );
}

const TAG_TONES: Record<Tone, string> = {
  neutral: 'border-border text-ink-muted',
  accent: 'border-accent/40 text-accent',
  positive: 'border-positive/40 text-positive',
  caution: 'border-caution/45 text-caution',
  critical: 'border-critical/45 text-critical',
};

/** Reserved for genuinely categorical values (job state, delivery state, PR state). */
export function Tag({
  tone = 'neutral',
  children,
  className,
}: {
  tone?: Tone;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1 rounded-[4px] border px-1.5 py-0.5 text-meta whitespace-nowrap',
        TAG_TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function HealthIndicator({
  tone,
  label,
  className,
}: {
  tone: Tone;
  label: string;
  className?: string;
}) {
  const text: Record<Tone, string> = {
    neutral: 'text-ink-muted',
    accent: 'text-accent',
    positive: 'text-positive',
    caution: 'text-caution',
    critical: 'text-critical',
  };
  return (
    <span className={clsx('inline-flex items-center gap-1.5 text-meta', text[tone], className)}>
      <StatusDot tone={tone} live={tone === 'accent'} />
      {label}
    </span>
  );
}
