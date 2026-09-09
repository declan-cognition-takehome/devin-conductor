import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from 'react';
import clsx from 'clsx';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md';

const BASE =
  'inline-flex items-center justify-center gap-1.5 rounded-[6px] font-medium whitespace-nowrap transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-45 aria-disabled:cursor-not-allowed aria-disabled:opacity-45';

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-accent text-canvas hover:bg-accent-strong',
  secondary: 'border border-border bg-surface-raised text-ink hover:border-border-strong',
  ghost: 'text-ink-muted hover:bg-surface-raised hover:text-ink',
  danger: 'border border-critical/50 text-critical hover:bg-critical/10',
};

const SIZES: Record<Size, string> = {
  sm: 'h-7 px-2.5 text-meta',
  md: 'h-8 px-3 text-body',
};

export function buttonClasses(variant: Variant = 'secondary', size: Size = 'sm', extra?: string) {
  return clsx(BASE, VARIANTS[variant], SIZES[size], extra);
}

export function Button({
  variant = 'secondary',
  size = 'sm',
  className,
  loading = false,
  ref,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  ref?: React.Ref<HTMLButtonElement>;
}) {
  return (
    <button
      type="button"
      ref={ref}
      {...props}
      disabled={props.disabled ?? loading}
      className={buttonClasses(variant, size, className)}
    >
      {loading && <Spinner />}
      {children}
    </button>
  );
}

export function LinkButton({
  variant = 'secondary',
  size = 'sm',
  className,
  children,
  ...props
}: AnchorHTMLAttributes<HTMLAnchorElement> & { variant?: Variant; size?: Size }) {
  return (
    <a {...props} className={buttonClasses(variant, size, className)}>
      {children}
    </a>
  );
}

export function IconButton({
  label,
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      {...props}
      className={clsx(
        'inline-flex h-7 w-7 items-center justify-center rounded-[6px] text-ink-muted transition-colors duration-150 hover:bg-surface-raised hover:text-ink disabled:opacity-45',
        className,
      )}
    >
      {children}
    </button>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={clsx(
        'inline-block h-3 w-3 animate-spin rounded-full border border-current border-t-transparent',
        className,
      )}
    />
  );
}
