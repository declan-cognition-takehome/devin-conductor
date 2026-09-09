import { z } from 'zod';
import { requireDevinConfig } from '../config';
import { safeErrorSummary } from '../redact';

/**
 * Devin v3 organization API client.
 *
 * Endpoints (service-user credential, `cog_` prefix, bearer auth):
 *   POST /v3/organizations/{org_id}/sessions
 *   GET  /v3/organizations/{org_id}/sessions
 *   GET  /v3/organizations/{org_id}/sessions/{devin_id}
 *   GET  /v3/organizations/{org_id}/sessions/{devin_id}/messages
 *
 * Required service-user permissions: `UseDevinSessions` to create, `ViewOrgSessions` to read.
 */

export const sessionPullRequestSchema = z.object({
  pr_url: z.string(),
  pr_state: z.string().nullable().optional(),
});

export const sessionResponseSchema = z.object({
  session_id: z.string(),
  url: z.string(),
  status: z.string(),
  status_detail: z.string().nullable().optional(),
  tags: z.array(z.string()).default([]),
  org_id: z.string().optional(),
  created_at: z.number().optional(),
  updated_at: z.number().optional(),
  acus_consumed: z.number().optional(),
  title: z.string().nullable().optional(),
  pull_requests: z.array(sessionPullRequestSchema).default([]),
});

export type DevinSession = z.infer<typeof sessionResponseSchema>;

export const sessionMessageSchema = z.object({
  event_id: z.string(),
  source: z.string(),
  message: z.string(),
  created_at: z.number(),
});

export type DevinSessionMessage = z.infer<typeof sessionMessageSchema>;

const paginatedMessagesSchema = z.object({
  items: z.array(sessionMessageSchema),
  end_cursor: z.string().nullable().optional(),
  has_next_page: z.boolean().default(false),
});

const paginatedSessionsSchema = z.object({
  items: z.array(sessionResponseSchema),
  end_cursor: z.string().nullable().optional(),
  has_next_page: z.boolean().default(false),
});

export interface CreateSessionInput {
  prompt: string;
  title?: string;
  repos?: string[];
  sessionLinks?: string[];
  tags?: string[];
  maxAcuLimit?: number | null;
  idempotencyKey?: string;
}

export class DevinApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'DevinApiError';
  }
}

/** Signals that a create request may or may not have produced a session. */
export class DevinUncertainDispatchError extends Error {
  constructor(readonly cause: unknown) {
    super(`Devin session creation outcome is uncertain: ${safeErrorSummary(cause)}`);
    this.name = 'DevinUncertainDispatchError';
  }
}

export interface DevinClientOptions {
  baseUrl?: string;
  apiKey?: string;
  orgId?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 20_000;

export class DevinClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly orgId: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(options: DevinClientOptions = {}) {
    const configured = options.apiKey && options.orgId ? null : requireDevinConfig();
    this.baseUrl = (options.baseUrl ?? configured?.DEVIN_API_BASE_URL ?? '').replace(/\/$/, '');
    this.apiKey = options.apiKey ?? configured?.DEVIN_API_KEY ?? '';
    this.orgId = options.orgId ?? configured?.DEVIN_ORG_ID ?? '';
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  private async request<T>(
    method: 'GET' | 'POST',
    path: string,
    schema: z.ZodType<T>,
    init: { body?: unknown; query?: Record<string, string | number | string[] | undefined> } = {},
  ): Promise<T> {
    const url = new URL(`${this.baseUrl}${path}`);
    for (const [key, value] of Object.entries(init.query ?? {})) {
      if (value === undefined) continue;
      if (Array.isArray(value)) {
        for (const item of value) url.searchParams.append(key, item);
      } else {
        url.searchParams.set(key, String(value));
      }
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: Response;
    try {
      response = await this.fetchImpl(url.toString(), {
        method,
        headers: {
          authorization: `Bearer ${this.apiKey}`,
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      const retryable = response.status === 429 || response.status >= 500;
      throw new DevinApiError(
        response.status,
        `Devin API ${method} ${path} failed with ${response.status}: ${safeErrorSummary(text, 200)}`,
        retryable,
      );
    }

    const json: unknown = await response.json();
    const parsed = schema.safeParse(json);
    if (!parsed.success) {
      throw new DevinApiError(
        response.status,
        `Devin API ${method} ${path} returned an unexpected payload: ${parsed.error.issues[0]?.message ?? 'schema mismatch'}`,
        false,
      );
    }
    return parsed.data;
  }

  async createSession(input: CreateSessionInput): Promise<DevinSession> {
    try {
      return await this.request(
        'POST',
        `/v3/organizations/${encodeURIComponent(this.orgId)}/sessions`,
        sessionResponseSchema,
        {
          body: {
            prompt: input.prompt,
            title: input.title,
            repos: input.repos,
            session_links: input.sessionLinks,
            tags: input.tags,
            max_acu_limit: input.maxAcuLimit ?? undefined,
          },
        },
      );
    } catch (error) {
      // A network failure, timeout, or 5xx leaves the outcome unknown: the session may
      // already exist. Callers must attempt tag-based recovery before creating another.
      if (error instanceof DevinApiError && !error.retryable) throw error;
      throw new DevinUncertainDispatchError(error);
    }
  }

  async getSession(sessionId: string): Promise<DevinSession> {
    return this.request(
      'GET',
      `/v3/organizations/${encodeURIComponent(this.orgId)}/sessions/${encodeURIComponent(sessionId)}`,
      sessionResponseSchema,
    );
  }

  async listSessions(
    query: { tags?: string[]; createdAfter?: number; first?: number; after?: string } = {},
  ): Promise<z.infer<typeof paginatedSessionsSchema>> {
    return this.request(
      'GET',
      `/v3/organizations/${encodeURIComponent(this.orgId)}/sessions`,
      paginatedSessionsSchema,
      {
        query: {
          tags: query.tags,
          created_after: query.createdAfter,
          first: query.first ?? 100,
          after: query.after,
        },
      },
    );
  }

  async listMessages(
    sessionId: string,
    options: { after?: string | null; first?: number } = {},
  ): Promise<z.infer<typeof paginatedMessagesSchema>> {
    return this.request(
      'GET',
      `/v3/organizations/${encodeURIComponent(this.orgId)}/sessions/${encodeURIComponent(sessionId)}/messages`,
      paginatedMessagesSchema,
      {
        query: {
          after: options.after ?? undefined,
          first: options.first ?? 100,
        },
      },
    );
  }

  /** Harmless read used by the Configure connection test. */
  async connectionTest(): Promise<{ ok: true; sessionCount: number }> {
    const result = await this.listSessions({ first: 1 });
    return { ok: true, sessionCount: result.items.length };
  }
}

let cachedClient: DevinClient | null = null;

export function devinClient(): DevinClient {
  cachedClient ??= new DevinClient();
  return cachedClient;
}

export function resetDevinClient(): void {
  cachedClient = null;
}
