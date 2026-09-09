import { config } from '../config';
import { closeDatabase, db } from './index';
import { logger } from '../logger';

/** Applies pending migrations and exits. Used by the container entrypoint. */
function main(): void {
  db();
  logger.info('migrations applied', { database: config().base.DATABASE_PATH });
  closeDatabase();
}

main();
