import type { Metadata } from 'next';
import './globals.css';
import { currentSession } from '@/lib/auth/session';
import { AppShell } from '@/components/app-shell';
import { ToastProvider } from '@/components/ui';

export const metadata: Metadata = {
  title: 'Devin Conductor',
  description: 'Orchestrator for your AI software engineer',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const session = await currentSession();
  return (
    <html lang="en">
      <body className="min-h-screen bg-canvas text-ink antialiased">
        <ToastProvider>
          {session ? (
            <AppShell login={session.login} avatarUrl={session.avatarUrl}>
              {children}
            </AppShell>
          ) : (
            <main className="mx-auto w-full max-w-[1440px] px-4 py-6 sm:px-6 lg:px-8">
              {children}
            </main>
          )}
        </ToastProvider>
      </body>
    </html>
  );
}
