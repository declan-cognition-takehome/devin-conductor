import { z } from 'zod';

/** Only the fields Devin Conductor needs are validated; unknown fields are ignored. */

const accountSchema = z.object({
  id: z.number(),
  login: z.string(),
  type: z.string().optional(),
});

const repositorySchema = z.object({
  id: z.number(),
  name: z.string(),
  full_name: z.string(),
  private: z.boolean().optional(),
  default_branch: z.string().optional(),
  owner: accountSchema,
});

export const issuesEventSchema = z.object({
  action: z.string(),
  issue: z.object({
    id: z.number(),
    node_id: z.string().optional(),
    number: z.number(),
    title: z.string(),
    body: z.string().nullable().optional(),
    html_url: z.string(),
    created_at: z.string(),
    user: accountSchema.nullable(),
  }),
  repository: repositorySchema,
  installation: z.object({ id: z.number() }).optional(),
  sender: accountSchema.optional(),
});

export const pullRequestEventSchema = z.object({
  action: z.string(),
  number: z.number(),
  pull_request: z.object({
    number: z.number(),
    html_url: z.string(),
    title: z.string().optional(),
    state: z.string(),
    merged: z.boolean().optional(),
    merged_at: z.string().nullable().optional(),
    created_at: z.string(),
    updated_at: z.string().optional(),
    closed_at: z.string().nullable().optional(),
    user: accountSchema.nullable().optional(),
    body: z.string().nullable().optional(),
  }),
  repository: repositorySchema,
  installation: z.object({ id: z.number() }).optional(),
});

export const installationEventSchema = z.object({
  action: z.string(),
  installation: z.object({
    id: z.number(),
    account: accountSchema.nullable(),
    suspended_at: z.string().nullable().optional(),
    created_at: z.union([z.string(), z.number()]).optional(),
  }),
  repositories: z.array(repositorySchema.partial({ owner: true, full_name: true })).optional(),
});

export const installationRepositoriesEventSchema = z.object({
  action: z.string(),
  installation: z.object({
    id: z.number(),
    account: accountSchema.nullable(),
  }),
  repositories_added: z.array(z.object({ id: z.number(), full_name: z.string() })).optional(),
  repositories_removed: z.array(z.object({ id: z.number(), full_name: z.string() })).optional(),
});

/** Minimal shape shared by every payload used for delivery bookkeeping. */
export const deliveryEnvelopeSchema = z.object({
  action: z.string().optional(),
  installation: z.object({ id: z.number() }).optional(),
  repository: z.object({ id: z.number(), full_name: z.string() }).optional(),
  sender: accountSchema.optional(),
});

export type IssuesEvent = z.infer<typeof issuesEventSchema>;
export type PullRequestEvent = z.infer<typeof pullRequestEventSchema>;

const PR_URL_PATTERN = /^https:\/\/github\.com\/([^/\s]+)\/([^/\s]+)\/pull\/(\d+)(?:[/?#].*)?$/;

export interface ParsedPrUrl {
  owner: string;
  repo: string;
  fullName: string;
  number: number;
}

/** Validates a GitHub PR URL before it is associated with a task. */
export function parsePullRequestUrl(url: string): ParsedPrUrl | null {
  const match = PR_URL_PATTERN.exec(url.trim());
  if (!match) return null;
  const [, owner, repo, number] = match;
  if (!owner || !repo || !number) return null;
  return { owner, repo, fullName: `${owner}/${repo}`, number: Number(number) };
}
