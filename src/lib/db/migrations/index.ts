import * as init from './0001_init';
import * as issueState from './0002_issue_state';

export interface Migration {
  name: string;
  sql: string;
}

/**
 * Ordered, append-only list of migrations. Migrations are embedded as modules so they
 * survive Next.js standalone bundling without extra file copying at build time.
 */
export const migrations: Migration[] = [init, issueState];
