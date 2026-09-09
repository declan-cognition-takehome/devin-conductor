import type { ReactNode } from 'react';
import clsx from 'clsx';

export function PageHeader({
  title,
  description,
  breadcrumb,
  actions,
  meta,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  breadcrumb?: ReactNode;
  actions?: ReactNode;
  meta?: ReactNode;
  className?: string;
}) {
  return (
    <header
      className={clsx('flex flex-wrap items-start justify-between gap-x-6 gap-y-3', className)}
    >
      <div className="min-w-0">
        {breadcrumb && <div className="mb-1 text-meta text-ink-faint">{breadcrumb}</div>}
        <h1 className="text-page-title font-semibold tracking-[-0.01em] text-ink">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-body text-ink-muted">{description}</p>}
        {meta && <div className="mt-1.5 text-meta text-ink-muted">{meta}</div>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </header>
  );
}

export function SectionHeader({
  title,
  description,
  actions,
  className,
  id,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <div className={clsx('flex flex-wrap items-center justify-between gap-x-4 gap-y-2', className)}>
      <div className="min-w-0">
        <h2 id={id} className="text-section font-semibold tracking-[-0.01em] text-ink">
          {title}
        </h2>
        {description && <p className="mt-0.5 text-meta text-ink-muted">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}

/** A quiet grouping: heading plus a hairline, no enclosing rectangle. */
export function Section({
  title,
  description,
  actions,
  children,
  className,
  id,
}: {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <section className={clsx('space-y-3', className)} aria-labelledby={id}>
      {title && (
        <>
          <SectionHeader id={id} title={title} description={description} actions={actions} />
          <div className="h-px bg-border-subtle" />
        </>
      )}
      {children}
    </section>
  );
}

/** Used sparingly, only where content genuinely needs to sit above the page surface. */
export function Panel({
  children,
  className,
  tone = 'default',
}: {
  children: ReactNode;
  className?: string;
  tone?: 'default' | 'caution' | 'critical';
}) {
  return (
    <div
      className={clsx(
        'rounded-[8px] border',
        tone === 'default' && 'border-border bg-surface',
        tone === 'caution' && 'border-caution/35 bg-caution/[0.06]',
        tone === 'critical' && 'border-critical/40 bg-critical/[0.06]',
        className,
      )}
    >
      {children}
    </div>
  );
}

export function Divider({ className }: { className?: string }) {
  return <div className={clsx('h-px bg-border-subtle', className)} aria-hidden />;
}

/** label / control row used across settings screens. */
export function SettingRow({
  label,
  htmlFor,
  description,
  control,
  className,
}: {
  label: ReactNode;
  htmlFor?: string;
  description?: ReactNode;
  control: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={clsx(
        'flex flex-wrap items-start justify-between gap-x-8 gap-y-2 py-3.5 first:pt-0 last:pb-0',
        className,
      )}
    >
      <div className="min-w-0 max-w-xl">
        <label htmlFor={htmlFor} className="block text-body font-medium text-ink">
          {label}
        </label>
        {description && <p className="mt-0.5 text-meta text-ink-muted">{description}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-2">{control}</div>
    </div>
  );
}
