'use client';

import { useEffect, useId, useRef, useState } from 'react';
import clsx from 'clsx';
import { Button } from './button';

export function Tooltip({
  label,
  children,
  side = 'top',
  className,
}: {
  label: string;
  children: React.ReactNode;
  side?: 'top' | 'bottom';
  className?: string;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  return (
    <span
      className={clsx('relative inline-flex', className)}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
    >
      <span aria-describedby={open ? id : undefined} className="inline-flex min-w-0">
        {children}
      </span>
      {open && (
        <span
          role="tooltip"
          id={id}
          className={clsx(
            'pointer-events-none absolute left-1/2 z-50 -translate-x-1/2 rounded-[6px] border border-border-strong bg-surface-raised px-2 py-1 text-meta whitespace-nowrap text-ink shadow-[var(--shadow-overlay)]',
            side === 'top' ? 'bottom-[calc(100%+6px)]' : 'top-[calc(100%+6px)]',
          )}
        >
          {label}
        </span>
      )}
    </span>
  );
}

export function Menu({
  trigger,
  label,
  children,
  align = 'end',
  side = 'bottom',
  className,
}: {
  trigger: (props: {
    onClick: () => void;
    'aria-expanded': boolean;
    'aria-haspopup': 'menu';
  }) => React.ReactNode;
  label: string;
  children: (close: () => void) => React.ReactNode;
  align?: 'start' | 'end';
  /** `top` opens the panel above the trigger, for triggers near the bottom of the viewport. */
  side?: 'top' | 'bottom';
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div ref={container} className={clsx('relative', className)}>
      {trigger({
        onClick: () => setOpen((value) => !value),
        'aria-expanded': open,
        'aria-haspopup': 'menu',
      })}
      {open && (
        <div
          role="menu"
          aria-label={label}
          className={clsx(
            'absolute z-40 min-w-44 rounded-[8px] border border-border-strong bg-surface-raised p-1 shadow-[var(--shadow-overlay)]',
            align === 'end' ? 'right-0' : 'left-0',
            side === 'top' ? 'bottom-full mb-1' : 'top-full mt-1',
          )}
        >
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

export function MenuItem({
  onSelect,
  href,
  external,
  children,
  tone = 'default',
}: {
  onSelect?: () => void;
  href?: string;
  external?: boolean;
  children: React.ReactNode;
  tone?: 'default' | 'critical';
}) {
  const className = clsx(
    'flex w-full items-center gap-2 rounded-[4px] px-2 py-1.5 text-left text-body transition-colors duration-150',
    tone === 'critical'
      ? 'text-critical hover:bg-critical/10'
      : 'text-ink-muted hover:bg-surface hover:text-ink',
  );
  if (href) {
    return (
      <a
        role="menuitem"
        href={href}
        target={external ? '_blank' : undefined}
        rel={external ? 'noreferrer' : undefined}
        onClick={onSelect}
        className={className}
      >
        {children}
      </a>
    );
  }
  return (
    <button role="menuitem" type="button" onClick={onSelect} className={className}>
      {children}
    </button>
  );
}

export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  cancelLabel = 'Cancel',
  destructive = false,
  busy = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  body: React.ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  destructive?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const titleId = useId();
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    confirmRef.current?.focus();
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onCancel();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60" onClick={onCancel} aria-hidden />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative w-full max-w-sm rounded-[8px] border border-border-strong bg-surface p-4 shadow-[var(--shadow-overlay)]"
      >
        <h2 id={titleId} className="text-section font-semibold text-ink">
          {title}
        </h2>
        <div className="mt-1.5 text-body text-ink-muted">{body}</div>
        <div className="mt-4 flex justify-end gap-2">
          <Button onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </Button>
          <Button
            ref={confirmRef}
            variant={destructive ? 'danger' : 'primary'}
            onClick={onConfirm}
            loading={busy}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
