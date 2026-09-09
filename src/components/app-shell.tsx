'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { LucideIcon } from 'lucide-react';
import {
  Activity,
  BarChart3,
  ListTodo,
  LogOut,
  Menu as MenuIcon,
  PanelLeftClose,
  PanelLeftOpen,
  Settings2,
  X,
} from 'lucide-react';
import clsx from 'clsx';
import { getJson, postJson } from '@/lib/client/api';
import { IconButton, Menu, MenuItem, StatusDot, Tooltip } from './ui';

interface Destination {
  href: string;
  label: string;
  icon: LucideIcon;
}

const DESTINATIONS: Destination[] = [
  { href: '/', label: 'Observe', icon: ListTodo },
  { href: '/report', label: 'Report', icon: BarChart3 },
  { href: '/configure', label: 'Configure', icon: Settings2 },
];

const COLLAPSE_KEY = 'conductor:sidebar-collapsed';

interface Readiness {
  status: string;
  pendingJobs: number;
  integrations: { github: boolean; devin: boolean };
}

export function AppShell({
  login,
  avatarUrl,
  children,
}: {
  login: string;
  avatarUrl: string | null;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    setCollapsed(window.localStorage.getItem(COLLAPSE_KEY) === '1');
  }, []);

  useEffect(() => {
    setDrawerOpen(false);
  }, [pathname]);

  const toggleCollapsed = useCallback(() => {
    setCollapsed((value) => {
      window.localStorage.setItem(COLLAPSE_KEY, value ? '0' : '1');
      return !value;
    });
  }, []);

  return (
    <div className="flex min-h-screen">
      <div
        className={clsx(
          'hidden shrink-0 lg:block',
          collapsed ? 'w-[60px]' : 'w-[232px]',
          'transition-[width] duration-150',
        )}
      >
        <Sidebar
          collapsed={collapsed}
          onToggleCollapsed={toggleCollapsed}
          pathname={pathname}
          login={login}
          avatarUrl={avatarUrl}
          className="fixed inset-y-0 left-0"
          width={collapsed ? 60 : 232}
        />
      </div>

      {drawerOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div
            className="absolute inset-0 bg-black/60"
            onClick={() => setDrawerOpen(false)}
            aria-hidden
          />
          <Sidebar
            collapsed={false}
            pathname={pathname}
            login={login}
            avatarUrl={avatarUrl}
            width={256}
            className="absolute inset-y-0 left-0 shadow-[var(--shadow-overlay)]"
            onClose={() => setDrawerOpen(false)}
          />
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-2 border-b border-border-subtle bg-nav px-3 py-2 lg:hidden">
          <IconButton label="Open navigation" onClick={() => setDrawerOpen(true)}>
            <MenuIcon aria-hidden className="h-4 w-4" />
          </IconButton>
          <ProductMark />
          <span className="ml-auto">
            <AccountMenu login={login} avatarUrl={avatarUrl} align="end" />
          </span>
        </header>
        <main className="mx-auto w-full max-w-[1440px] flex-1 px-4 py-5 sm:px-6 lg:px-8 lg:py-7">
          {children}
        </main>
      </div>
    </div>
  );
}

function Sidebar({
  collapsed,
  onToggleCollapsed,
  onClose,
  pathname,
  login,
  avatarUrl,
  className,
  width,
}: {
  collapsed: boolean;
  onToggleCollapsed?: () => void;
  onClose?: () => void;
  pathname: string;
  login: string;
  avatarUrl: string | null;
  className?: string;
  width: number;
}) {
  return (
    <div
      style={{ width }}
      className={clsx(
        'z-50 flex h-full flex-col border-r border-border-subtle bg-nav',
        collapsed ? 'px-2 py-3' : 'px-3 py-3',
        className,
      )}
    >
      <div className={clsx('flex items-center', collapsed ? 'justify-center' : 'justify-between')}>
        {collapsed ? <ProductMark markOnly /> : <ProductMark />}
        {onToggleCollapsed && (
          <IconButton
            label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            onClick={onToggleCollapsed}
            className={collapsed ? 'hidden' : undefined}
          >
            <PanelLeftClose aria-hidden className="h-4 w-4" />
          </IconButton>
        )}
        {onClose && (
          <IconButton label="Close navigation" onClick={onClose}>
            <X aria-hidden className="h-4 w-4" />
          </IconButton>
        )}
      </div>

      {collapsed && onToggleCollapsed && (
        <div className="mt-2 flex justify-center">
          <IconButton label="Expand sidebar" onClick={onToggleCollapsed}>
            <PanelLeftOpen aria-hidden className="h-4 w-4" />
          </IconButton>
        </div>
      )}

      <nav aria-label="Primary" className="mt-4 flex flex-col gap-0.5">
        {DESTINATIONS.map((destination) => (
          <NavItem
            key={destination.href}
            destination={destination}
            collapsed={collapsed}
            active={
              destination.href === '/'
                ? pathname === '/' || pathname.startsWith('/tasks')
                : pathname.startsWith(destination.href)
            }
          />
        ))}
      </nav>

      <div className="mt-auto space-y-2 pt-4">
        <HealthItem collapsed={collapsed} />
        <div className={clsx('h-px bg-border-subtle', collapsed && '-mx-2')} />
        <AccountMenu login={login} avatarUrl={avatarUrl} collapsed={collapsed} align="start" />
      </div>
    </div>
  );
}

function NavItem({
  destination,
  active,
  collapsed,
}: {
  destination: Destination;
  active: boolean;
  collapsed: boolean;
}) {
  const { href, label, icon: Icon } = destination;
  const link = (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={clsx(
        'relative flex items-center rounded-[6px] text-body transition-colors duration-150',
        collapsed ? 'h-8 w-9 justify-center' : 'h-8 gap-2.5 px-2',
        active
          ? 'bg-accent/[0.12] font-medium text-ink'
          : 'text-ink-muted hover:bg-surface-raised hover:text-ink',
      )}
    >
      {active && (
        <span
          aria-hidden
          className="absolute top-1.5 bottom-1.5 -left-3 w-0.5 rounded-r-full bg-accent lg:-left-3"
        />
      )}
      <Icon aria-hidden className={clsx('h-4 w-4 shrink-0', active && 'text-accent')} />
      {!collapsed && label}
      {collapsed && <span className="sr-only">{label}</span>}
    </Link>
  );
  return collapsed ? (
    <Tooltip label={label} side="bottom" className="justify-center">
      {link}
    </Tooltip>
  ) : (
    link
  );
}

function HealthItem({ collapsed }: { collapsed: boolean }) {
  const [ready, setReady] = useState<Readiness | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    async function load(signal?: AbortSignal) {
      try {
        setReady(await getJson<Readiness>('/api/ready', signal));
      } catch {
        setReady(null);
      }
    }
    void load(controller.signal);
    const timer = setInterval(() => void load(), 60_000);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, []);

  if (!ready) return null;

  const integrationsReady = ready.integrations.github && ready.integrations.devin;
  const tone = ready.status !== 'ready' ? 'critical' : integrationsReady ? 'positive' : 'caution';
  const label = !integrationsReady
    ? 'Integrations incomplete'
    : ready.pendingJobs > 0
      ? `${ready.pendingJobs} job${ready.pendingJobs === 1 ? '' : 's'} queued`
      : 'All systems normal';

  const content = (
    <Link
      href="/configure"
      className={clsx(
        'flex items-center rounded-[6px] text-meta text-ink-muted transition-colors duration-150 hover:bg-surface-raised hover:text-ink',
        collapsed ? 'h-8 w-9 justify-center' : 'h-8 gap-2 px-2',
      )}
    >
      {collapsed ? (
        <span className="relative">
          <Activity aria-hidden className="h-4 w-4" />
          <StatusDot tone={tone} className="absolute -top-0.5 -right-0.5" />
        </span>
      ) : (
        <>
          <StatusDot tone={tone} />
          <span className="truncate">{label}</span>
        </>
      )}
      <span className="sr-only">System status: {label}</span>
    </Link>
  );

  return collapsed ? (
    <Tooltip label={label} side="top" className="justify-center">
      {content}
    </Tooltip>
  ) : (
    content
  );
}

function AccountMenu({
  login,
  avatarUrl,
  collapsed = false,
  align,
}: {
  login: string;
  avatarUrl: string | null;
  collapsed?: boolean;
  align: 'start' | 'end';
}) {
  async function signOut() {
    await postJson('/api/auth/logout', {});
    window.location.href = '/login';
  }

  return (
    <Menu
      label="Account"
      align={align}
      trigger={(props) => (
        <button
          type="button"
          {...props}
          className={clsx(
            'flex w-full items-center rounded-[6px] text-body text-ink-muted transition-colors duration-150 hover:bg-surface-raised hover:text-ink',
            collapsed ? 'h-8 w-9 justify-center' : 'h-8 gap-2 px-1.5',
          )}
        >
          <Avatar login={login} avatarUrl={avatarUrl} />
          {!collapsed && <span className="truncate">@{login}</span>}
          {collapsed && <span className="sr-only">Account: {login}</span>}
        </button>
      )}
    >
      {(close) => (
        <>
          <p className="px-2 py-1.5 text-meta text-ink-faint">Signed in as @{login}</p>
          <MenuItem
            onSelect={() => {
              close();
              void signOut();
            }}
          >
            <LogOut aria-hidden className="h-3.5 w-3.5" />
            Sign out
          </MenuItem>
        </>
      )}
    </Menu>
  );
}

function Avatar({ login, avatarUrl }: { login: string; avatarUrl: string | null }) {
  if (avatarUrl) {
    return <img src={avatarUrl} alt="" className="h-5 w-5 shrink-0 rounded-full" />;
  }
  return (
    <span
      aria-hidden
      className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-surface-raised text-[10px] font-medium text-ink-muted uppercase"
    >
      {login.slice(0, 1)}
    </span>
  );
}

export function ProductMark({ markOnly = false }: { markOnly?: boolean }) {
  return (
    <Link
      href="/"
      className="flex items-center gap-2 rounded-[6px] text-body font-semibold tracking-[-0.01em] text-ink"
    >
      <span
        aria-hidden
        className="flex h-5 w-5 shrink-0 items-center justify-center rounded-[5px] border border-accent/40 bg-accent/15"
      >
        <span className="h-1.5 w-1.5 rounded-[1px] bg-accent" />
      </span>
      {markOnly ? <span className="sr-only">Devin Conductor</span> : 'Devin Conductor'}
    </Link>
  );
}
