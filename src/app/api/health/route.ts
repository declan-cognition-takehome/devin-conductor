import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Liveness: the process is up. Intentionally does no I/O. */
export function GET(): NextResponse {
  return NextResponse.json({ status: 'ok', time: new Date().toISOString() });
}
