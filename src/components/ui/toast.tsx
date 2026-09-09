'use client';

import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Check, Info, X } from 'lucide-react';
import clsx from 'clsx';
import { IconButton } from './button';

type ToastTone = 'success' | 'error' | 'info';

interface Toast {
  id: number;
  tone: ToastTone;
  message: string;
}

interface ToastApi {
  show: (tone: ToastTone, message: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

const TONE_STYLES: Record<ToastTone, { icon: typeof Check; className: string }> = {
  success: { icon: Check, className: 'text-positive' },
  error: { icon: AlertTriangle, className: 'text-critical' },
  info: { icon: Info, className: 'text-accent' },
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(0);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const show = useCallback(
    (tone: ToastTone, message: string) => {
      const id = nextId.current++;
      setToasts((current) => [...current, { id, tone, message }]);
      window.setTimeout(() => dismiss(id), tone === 'error' ? 8000 : 4500);
    },
    [dismiss],
  );

  const api = useMemo(() => ({ show }), [show]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed right-4 bottom-4 z-50 flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2"
      >
        {toasts.map((toast) => {
          const { icon: Icon, className } = TONE_STYLES[toast.tone];
          return (
            <div
              key={toast.id}
              className="pointer-events-auto flex items-start gap-2 rounded-[8px] border border-border-strong bg-surface-raised px-3 py-2.5 shadow-[var(--shadow-overlay)]"
            >
              <Icon aria-hidden className={clsx('mt-px h-3.5 w-3.5 shrink-0', className)} />
              <p className="min-w-0 flex-1 text-body text-ink">{toast.message}</p>
              <IconButton
                label="Dismiss"
                onClick={() => dismiss(toast.id)}
                className="-mr-1 h-5 w-5"
              >
                <X aria-hidden className="h-3.5 w-3.5" />
              </IconButton>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast must be used inside ToastProvider');
  return context;
}
