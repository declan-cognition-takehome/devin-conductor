import { redirect } from 'next/navigation';
import { currentSession, type SessionPayload } from './session';

/** Server-component guard: unauthenticated visitors are sent to the login page. */
export async function requireUser(): Promise<SessionPayload> {
  const session = await currentSession();
  if (!session) redirect('/login');
  return session;
}
