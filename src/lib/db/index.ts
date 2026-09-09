import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';
import { config } from '../config';
import { logger } from '../logger';
import { migrations } from './migrations';

export type Db = Database.Database;

let instance: Db | null = null;

function applyMigrations(db: Db): void {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name TEXT PRIMARY KEY,
    applied_at INTEGER NOT NULL
  )`);
  const applied = new Set(
    db
      .prepare<[], { name: string }>('SELECT name FROM schema_migrations')
      .all()
      .map((row) => row.name),
  );
  for (const migration of migrations) {
    if (applied.has(migration.name)) continue;
    const run = db.transaction(() => {
      db.exec(migration.sql);
      db.prepare('INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)').run(
        migration.name,
        Date.now(),
      );
    });
    run();
    logger.info('applied migration', { migration: migration.name });
  }
}

function seedSettings(db: Db): void {
  const now = Date.now();
  db.prepare(
    `INSERT OR IGNORE INTO settings (id, paused, max_concurrent_sessions, max_acu_limit,
       poll_interval_seconds, max_retry_attempts, created_at, updated_at)
     VALUES (1, 0, 1, NULL, 30, 3, ?, ?)`,
  ).run(now, now);
}

export function openDatabase(path: string): Db {
  if (path !== ':memory:') {
    mkdirSync(dirname(path), { recursive: true });
  }
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  applyMigrations(db);
  seedSettings(db);
  return db;
}

export function db(): Db {
  instance ??= openDatabase(config().base.DATABASE_PATH);
  return instance;
}

export function closeDatabase(): void {
  instance?.close();
  instance = null;
}
