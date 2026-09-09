import clsx from 'clsx';
import type { UiState } from '@/lib/db/types';

export const STATE_LABELS: Record<UiState, string> = {
  queued: 'Queued',
  working: 'Working',
  pr_ready: 'PR ready',
  merged: 'Merged',
  needs_attention: 'Needs attention',
  ignored: 'Ignored',
};

const STATE_CLASSES: Record<UiState, string> = {
  queued: 'border-border-subtle text-ink-muted',
  working: 'border-accent/40 text-accent',
  pr_ready: 'border-positive/40 text-positive',
  merged: 'border-positive/60 text-positive',
  needs_attention: 'border-critical/50 text-critical',
  ignored: 'border-border-subtle text-ink-muted/70',
};

export function StateBadge({ state }: { state: UiState }) {
  return (
    <span
      className={clsx(
        'inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap',
        STATE_CLASSES[state],
      )}
    >
      {STATE_LABELS[state]}
    </span>
  );
}

export function Card({
  title,
  description,
  actions,
  children,
  className,
}: {
  title?: string;
  description?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={clsx('rounded-xl border border-border-subtle bg-surface p-4 sm:p-5', className)}
    >
      {(title || actions) && (
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            {title && <h2 className="text-sm font-semibold tracking-tight">{title}</h2>}
            {description && <p className="mt-1 text-xs text-ink-muted">{description}</p>}
          </div>
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-dashed border-border-subtle p-8 text-center">
      <p className="text-sm text-ink">{title}</p>
      {hint && <p className="mt-1 text-xs text-ink-muted">{hint}</p>}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div
      role="alert"
      className="rounded-lg border border-critical/40 bg-critical/5 p-4 text-sm text-critical"
    >
      <p>{message}</p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-2 rounded-md border border-critical/40 px-2 py-1 text-xs"
        >
          Try again
        </button>
      )}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={clsx('animate-pulse rounded-md bg-surface-raised', className ?? 'h-4 w-full')}
    />
  );
}

export function Metric({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-border-subtle bg-surface-raised p-3">
      <p className="text-xs text-ink-muted">{label}</p>
      <p className="mt-1 text-xl font-semibold tabular-nums">{value}</p>
      {hint && <p className="mt-1 text-xs text-ink-muted">{hint}</p>}
    </div>
  );
}

export function formatPercent(value: number | null): string {
  return value === null ? '—' : `${Math.round(value * 100)}%`;
}

export function formatDuration(ms: number | null): string {
  if (ms === null) return '—';
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = minutes / 60;
  if (hours < 48) return `${hours.toFixed(1)}h`;
  return `${(hours / 24).toFixed(1)}d`;
}

export function formatTime(ms: number | null): string {
  return ms ? new Date(ms).toLocaleString() : '—';
}

export function formatRelative(ms: number | null): string {
  if (!ms) return '—';
  const delta = Date.now() - ms;
  const minutes = Math.round(delta / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}
