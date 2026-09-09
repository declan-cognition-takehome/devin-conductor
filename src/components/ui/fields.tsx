'use client';

import { useEffect, useId, useState } from 'react';
import { Search, X } from 'lucide-react';
import clsx from 'clsx';
import { IconButton } from './button';

export function SearchField({
  value,
  onChange,
  label,
  placeholder,
  shortcutHint,
  className,
  inputRef,
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
  placeholder?: string;
  shortcutHint?: string;
  className?: string;
  inputRef?: React.Ref<HTMLInputElement>;
}) {
  const id = useId();
  return (
    <div className={clsx('relative', className)}>
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <Search
        aria-hidden
        className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-ink-faint"
      />
      <input
        id={id}
        ref={inputRef}
        type="text"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className={clsx(
          'h-8 w-full rounded-[6px] border border-border bg-surface pl-8 text-body text-ink transition-colors duration-150 placeholder:text-ink-faint hover:border-border-strong focus:border-accent',
          value ? 'pr-8' : shortcutHint ? 'pr-10' : 'pr-2.5',
        )}
      />
      {value ? (
        <span className="absolute top-1/2 right-1 -translate-y-1/2">
          <IconButton label="Clear search" onClick={() => onChange('')} className="h-6 w-6">
            <X aria-hidden className="h-3.5 w-3.5" />
          </IconButton>
        </span>
      ) : (
        shortcutHint && (
          <kbd
            aria-hidden
            className="numeric absolute top-1/2 right-2 -translate-y-1/2 rounded-[4px] border border-border px-1 py-px text-[11px] text-ink-faint"
          >
            {shortcutHint}
          </kbd>
        )
      )}
    </div>
  );
}

export function Switch({
  checked,
  onChange,
  label,
  describedBy,
  disabled,
  id,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  describedBy?: string;
  disabled?: boolean;
  id?: string;
}) {
  return (
    <button
      type="button"
      id={id}
      role="switch"
      aria-checked={checked}
      aria-label={label}
      aria-describedby={describedBy}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={clsx(
        'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-45',
        checked ? 'border-accent/60 bg-accent/80' : 'border-border-strong bg-surface-raised',
      )}
    >
      <span
        aria-hidden
        className={clsx(
          'inline-block h-3.5 w-3.5 rounded-full bg-ink transition-transform duration-150',
          checked ? 'translate-x-[18px]' : 'translate-x-[3px]',
        )}
      />
    </button>
  );
}

export function TextInput({
  className,
  invalid,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }) {
  return (
    <input
      {...props}
      aria-invalid={invalid || undefined}
      className={clsx(
        'h-8 rounded-[6px] border bg-surface px-2.5 text-body text-ink transition-colors duration-150 placeholder:text-ink-faint hover:border-border-strong focus:border-accent disabled:opacity-45',
        invalid ? 'border-critical' : 'border-border',
        className,
      )}
    />
  );
}

export function NumberField({
  label,
  hint,
  unit,
  value,
  min,
  max,
  nullable = false,
  disabled,
  onCommit,
}: {
  label: string;
  hint?: string;
  unit?: string;
  value: number | null;
  min: number;
  max: number;
  nullable?: boolean;
  disabled?: boolean;
  onCommit: (value: number | null) => void;
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  const [draft, setDraft] = useState(value === null ? '' : String(value));
  const [invalid, setInvalid] = useState<string | null>(null);

  useEffect(() => {
    setDraft(value === null ? '' : String(value));
    setInvalid(null);
  }, [value]);

  function reset() {
    setDraft(value === null ? '' : String(value));
  }

  function commit() {
    if (draft.trim() === '') {
      if (nullable) {
        setInvalid(null);
        if (value !== null) onCommit(null);
        return;
      }
      setInvalid(`Enter a whole number between ${min} and ${max}.`);
      reset();
      return;
    }
    const parsed = Number(draft);
    if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
      setInvalid(`Enter a whole number between ${min} and ${max}.`);
      reset();
      return;
    }
    setInvalid(null);
    if (parsed !== value) onCommit(parsed);
  }

  return (
    <div className="flex flex-wrap items-start justify-between gap-x-8 gap-y-2 py-3.5 first:pt-0 last:pb-0">
      <div className="min-w-0 max-w-xl">
        <label htmlFor={id} className="block text-body font-medium text-ink">
          {label}
        </label>
        {hint && (
          <p id={hintId} className="mt-0.5 text-meta text-ink-muted">
            {hint}
          </p>
        )}
        {invalid && (
          <p role="alert" className="mt-1 text-meta text-critical">
            {invalid}
          </p>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <TextInput
          id={id}
          type="number"
          inputMode="numeric"
          min={min}
          max={max}
          value={draft}
          disabled={disabled}
          invalid={invalid !== null}
          aria-describedby={hint ? hintId : undefined}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur();
            if (event.key === 'Escape') reset();
          }}
          className="numeric w-24 text-right"
        />
        {unit && <span className="w-16 text-meta text-ink-muted">{unit}</span>}
      </div>
    </div>
  );
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
  className,
}: {
  options: Array<{ value: T; label: string; count?: number }>;
  value: T;
  onChange: (value: T) => void;
  label: string;
  className?: string;
}) {
  return (
    <div
      role="tablist"
      aria-label={label}
      className={clsx(
        'inline-flex max-w-full items-center gap-0.5 overflow-x-auto rounded-[6px] border border-border bg-surface p-0.5',
        className,
      )}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            role="tab"
            type="button"
            aria-selected={active}
            onClick={() => onChange(option.value)}
            className={clsx(
              'inline-flex items-center gap-1.5 rounded-[4px] px-2.5 py-1 text-meta whitespace-nowrap transition-colors duration-150',
              active ? 'bg-surface-raised font-medium text-ink' : 'text-ink-muted hover:text-ink',
            )}
          >
            {option.label}
            {option.count !== undefined && (
              <span className={clsx('numeric', active ? 'text-ink-muted' : 'text-ink-faint')}>
                {option.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
