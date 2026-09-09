import { NextResponse } from 'next/server';
import { currentSession, verifyCsrf, type SessionPayload } from './session';

export class UnauthorizedError extends Error {
  constructor(message = 'Authentication required') {
    super(message);
    this.name = 'UnauthorizedError';
  }
}

export function jsonError(status: number, message: string): NextResponse {
  return NextResponse.json({ error: message }, { status });
}

/** Requires an authenticated organization member for read endpoints. */
export async function requireSession(): Promise<SessionPayload | NextResponse> {
  const session = await currentSession();
  if (!session) return jsonError(401, 'Authentication required');
  return session;
}

/** Requires an authenticated member and a valid CSRF token for mutations. */
export async function requireMutation(request: Request): Promise<SessionPayload | NextResponse> {
  const session = await currentSession();
  if (!session) return jsonError(401, 'Authentication required');
  if (!(await verifyCsrf(request))) return jsonError(403, 'Invalid CSRF token');
  return session;
}

export function isResponse(value: unknown): value is NextResponse {
  return value instanceof NextResponse;
}
