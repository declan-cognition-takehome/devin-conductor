/**
 * Next.js runs this once per server process. Migrations are applied and the single
 * worker loop is started here so one container serves requests and processes jobs.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { db } = await import('@/lib/db');
  const { startWorkerOnce } = await import('@/lib/worker');
  const { logger } = await import('@/lib/logger');

  db();
  const worker = startWorkerOnce();
  logger.info('server started', { worker: worker !== null });
}
