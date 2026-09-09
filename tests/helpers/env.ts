import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Each test file gets its own SQLite file and a fully configured environment so the
 * production configuration parser (not a test double) is exercised.
 */
export function setupTestEnv(name: string): { databasePath: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), `conductor-${name}-`));
  const databasePath = join(dir, 'test.sqlite');

  Object.assign(process.env, {
    NODE_ENV: 'test',
    APP_BASE_URL: 'https://conductor.test',
    SESSION_SECRET: 'test-session-secret-value-that-is-long-enough',
    DATABASE_PATH: databasePath,
    WORKER_ENABLED: 'false',
    LOG_LEVEL: 'error',
    GITHUB_ORG: 'test-org',
    GITHUB_APP_ID: '123456',
    GITHUB_APP_SLUG: 'devin-conductor-test',
    GITHUB_CLIENT_ID: 'Iv1.testclientid',
    GITHUB_CLIENT_SECRET: 'test-client-secret',
    GITHUB_WEBHOOK_SECRET: 'test-webhook-secret',
    GITHUB_PRIVATE_KEY:
      '-----BEGIN RSA PRIVATE KEY-----\nnot-a-real-key\n-----END RSA PRIVATE KEY-----',
    DEVIN_ORG_ID: 'org-test',
    DEVIN_API_KEY: 'cog_testtesttesttest',
    DEVIN_API_BASE_URL: 'https://api.devin.test',
    DEVIN_APP_BASE_URL: 'https://app.devin.test',
  });

  return {
    databasePath,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}
