'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import clsx from 'clsx';
import { postJson } from '@/lib/client/api';

const LINKS = [
  { href: '/', label: 'Observe' },
  { href: '/report', label: 'Report' },
  { href: '/configure', label: 'Configure' },
];

export function NavBar({ login, avatarUrl }: { login: string | null; avatarUrl: string | null }) {
  const pathname = usePathname();

  async function signOut() {
    await postJson('/api/auth/logout', {});
    window.location.href = '/login';
  }

  return (
    <header className="border-b border-border-subtle bg-surface">
      <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3 sm:px-6 lg:px-8">
        <Link href="/" className="flex items-center gap-2 text-sm font-semibold tracking-tight">
          <span className="inline-block h-2.5 w-2.5 rounded-full bg-accent" aria-hidden />
          Devin Conductor
        </Link>
        {login && (
          <nav aria-label="Primary" className="flex items-center gap-1">
            {LINKS.map((link) => {
              const active = link.href === '/' ? pathname === '/' : pathname.startsWith(link.href);
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  aria-current={active ? 'page' : undefined}
                  className={clsx(
                    'rounded-md px-3 py-1.5 text-sm transition-colors',
                    active
                      ? 'bg-surface-raised text-ink'
                      : 'text-ink-muted hover:bg-surface-raised hover:text-ink',
                  )}
                >
                  {link.label}
                </Link>
              );
            })}
          </nav>
        )}
        <div className="ml-auto flex items-center gap-3 text-sm text-ink-muted">
          {login ? (
            <>
              {avatarUrl && <img src={avatarUrl} alt="" className="h-6 w-6 rounded-full" />}
              <span className="hidden sm:inline">@{login}</span>
              <button
                type="button"
                onClick={signOut}
                className="rounded-md border border-border-subtle px-2.5 py-1 text-sm hover:bg-surface-raised"
              >
                Sign out
              </button>
            </>
          ) : (
            <Link href="/login" className="rounded-md border border-border-subtle px-2.5 py-1">
              Sign in
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}
