import type { Metadata } from 'next';
import './globals.css';
import { currentSession } from '@/lib/auth/session';
import { NavBar } from '@/components/nav-bar';

export const metadata: Metadata = {
  title: 'Devin Conductor',
  description: 'Orchestrator for your AI software engineer',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const session = await currentSession();
  return (
    <html lang="en">
      <body className="min-h-screen bg-canvas text-ink">
        <NavBar login={session?.login ?? null} avatarUrl={session?.avatarUrl ?? null} />
        <main className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8">{children}</main>
      </body>
    </html>
  );
}
