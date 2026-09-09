import type { LucideIcon } from 'lucide-react';
import { AlertCircle, Inbox } from 'lucide-react';
import clsx from 'clsx';
import { Button } from './button';

export function EmptyState({
  title,
  hint,
  icon: Icon = Inbox,
  action,
  compact = false,
  className,
}: {
  title: string;
  hint?: string;
  icon?: LucideIcon;
  action?: React.ReactNode;
  compact?: boolean;
  className?: string;
}) {
  return (
    <div
      className={clsx(
        'flex flex-col items-center text-center',
        compact ? 'gap-1 py-6' : 'gap-1.5 py-14',
        className,
      )}
    >
      <Icon aria-hidden className={clsx('text-ink-faint', compact ? 'h-4 w-4' : 'h-5 w-5')} />
      <p className="text-body font-medium text-ink">{title}</p>
      {hint && <p className="max-w-sm text-meta text-ink-muted">{hint}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div
      role="alert"
      className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[8px] border border-critical/40 bg-critical/[0.06] px-3 py-2.5 text-body text-critical"
    >
      <AlertCircle aria-hidden className="h-4 w-4 shrink-0" />
      <p className="min-w-0 flex-1">{message}</p>
      {onRetry && (
        <Button variant="danger" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={clsx('animate-pulse rounded-[4px] bg-surface-raised', className ?? 'h-3 w-full')}
    />
  );
}

/** Loading placeholder that mirrors the real row rhythm rather than a generic block. */
export function RowSkeleton({ rows = 6, className }: { rows?: number; className?: string }) {
  return (
    <div className={clsx('divide-y divide-border-subtle', className)} aria-hidden>
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="flex items-center gap-4 px-3 py-3.5">
          <div className="min-w-0 flex-1 space-y-1.5">
            <Skeleton className="h-3 w-[42%]" />
            <Skeleton className="h-2.5 w-24 opacity-70" />
          </div>
          <Skeleton className="h-3 w-32 opacity-70" />
          <Skeleton className="h-3 w-20 opacity-70" />
          <Skeleton className="h-3 w-12 opacity-70" />
        </div>
      ))}
    </div>
  );
}

export function Metric({
  label,
  value,
  hint,
  className,
}: {
  label: string;
  value: string;
  hint?: string;
  className?: string;
}) {
  return (
    <div className={clsx('px-3 py-2.5', className)}>
      <p className="text-meta text-ink-muted">{label}</p>
      <p className="numeric mt-1 text-lg font-semibold text-ink">{value}</p>
      {hint && <p className="mt-0.5 text-meta text-ink-faint">{hint}</p>}
    </div>
  );
}
