import { readFileSync } from 'node:fs';
import { z } from 'zod';

/**
 * Server-side configuration. Secrets stay in the process environment and are never
 * persisted to SQLite, sent to the browser, or logged.
 */

const bool = z
  .string()
  .optional()
  .transform((v) => v === 'true' || v === '1');

const baseSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  APP_BASE_URL: z.url(),
  SESSION_SECRET: z.string().min(32, 'SESSION_SECRET must be at least 32 characters'),
  DATABASE_PATH: z.string().min(1).default('/data/devin-conductor.sqlite'),
  PORT: z.coerce.number().int().positive().default(3000),
  WORKER_ENABLED: z
    .string()
    .optional()
    .transform((v) => v !== 'false'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  DEV_AUTH_BYPASS_LOGIN: z.string().optional(),
  TRUST_PROXY_SECURE_COOKIES: bool,
});

const githubSchema = z.object({
  GITHUB_ORG: z.string().min(1),
  GITHUB_APP_ID: z.string().min(1),
  GITHUB_APP_SLUG: z.string().min(1),
  GITHUB_CLIENT_ID: z.string().min(1),
  GITHUB_CLIENT_SECRET: z.string().min(1),
  GITHUB_WEBHOOK_SECRET: z.string().min(1),
});

const devinSchema = z.object({
  DEVIN_ORG_ID: z.string().min(1),
  DEVIN_API_KEY: z.string().min(1),
  DEVIN_API_BASE_URL: z.url().default('https://api.devin.ai'),
  DEVIN_APP_BASE_URL: z.url().default('https://app.devin.ai'),
});

export type BaseConfig = z.infer<typeof baseSchema>;
export type GithubConfig = z.infer<typeof githubSchema> & { privateKey: string };
export type DevinConfig = z.infer<typeof devinSchema>;

export type IntegrationStatus<T> =
  { configured: true; value: T } | { configured: false; missing: string[] };

export interface AppConfig {
  base: BaseConfig;
  github: IntegrationStatus<GithubConfig>;
  devin: IntegrationStatus<DevinConfig>;
  isProduction: boolean;
  secureCookies: boolean;
}

/**
 * The GitHub App private key may be supplied as a multiline PEM, a base64-encoded PEM,
 * or a path to a mounted secret file. Exactly one mechanism needs to be present.
 */
function resolvePrivateKey(env: NodeJS.ProcessEnv): string | null {
  const file = env.GITHUB_PRIVATE_KEY_PATH?.trim();
  if (file) {
    return readFileSync(file, 'utf8');
  }
  const b64 = env.GITHUB_PRIVATE_KEY_BASE64?.trim();
  if (b64) {
    return Buffer.from(b64, 'base64').toString('utf8');
  }
  const raw = env.GITHUB_PRIVATE_KEY?.trim();
  if (raw) {
    // Docker/compose single-line values commonly encode newlines as \n.
    return raw.includes('\\n') ? raw.replace(/\\n/g, '\n') : raw;
  }
  return null;
}

function missingKeys(shape: z.ZodObject, env: NodeJS.ProcessEnv): string[] {
  return Object.keys(shape.shape).filter((key) => {
    const value = env[key];
    return value === undefined || value.trim() === '';
  });
}

function loadIntegration<T extends z.ZodObject>(
  schema: T,
  env: NodeJS.ProcessEnv,
): IntegrationStatus<z.infer<T>> {
  const missing = missingKeys(schema, env).filter((key) => {
    // Keys with defaults are optional.
    const field = schema.shape[key];
    return field ? !field.safeParse(undefined).success : true;
  });
  if (missing.length > 0) return { configured: false, missing };
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    return {
      configured: false,
      missing: parsed.error.issues.map((issue) => String(issue.path[0] ?? 'unknown')),
    };
  }
  return { configured: true, value: parsed.data };
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const base = baseSchema.safeParse(env);
  if (!base.success) {
    const details = base.error.issues
      .map((issue) => `  - ${issue.path.join('.') || 'config'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid Devin Conductor configuration:\n${details}`);
  }

  const githubBase = loadIntegration(githubSchema, env);
  const privateKey = resolvePrivateKey(env);
  let github: IntegrationStatus<GithubConfig>;
  if (githubBase.configured && privateKey) {
    github = { configured: true, value: { ...githubBase.value, privateKey } };
  } else {
    const missing = githubBase.configured ? [] : githubBase.missing;
    github = {
      configured: false,
      missing: privateKey ? missing : [...missing, 'GITHUB_PRIVATE_KEY'],
    };
  }

  const isProduction = base.data.NODE_ENV === 'production';
  return {
    base: base.data,
    github,
    devin: loadIntegration(devinSchema, env),
    isProduction,
    secureCookies: isProduction || base.data.TRUST_PROXY_SECURE_COOKIES,
  };
}

let cached: AppConfig | null = null;

export function config(): AppConfig {
  cached ??= loadConfig();
  return cached;
}

export function resetConfigCache(): void {
  cached = null;
}

export function requireGithubConfig(): GithubConfig {
  const { github } = config();
  if (!github.configured) {
    throw new Error(`GitHub integration is not configured (missing: ${github.missing.join(', ')})`);
  }
  return github.value;
}

export function requireDevinConfig(): DevinConfig {
  const { devin } = config();
  if (!devin.configured) {
    throw new Error(`Devin integration is not configured (missing: ${devin.missing.join(', ')})`);
  }
  return devin.value;
}
