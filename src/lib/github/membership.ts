import type { Octokit } from '@octokit/rest';
import { RequestError } from '@octokit/request-error';

export type MembershipResult =
  | { status: 'member'; role?: string }
  | { status: 'not_member' }
  | { status: 'unknown'; reason: string };

/**
 * Checks active organization membership with an installation token. Private membership
 * means `author_association` on the webhook payload cannot be trusted, so the
 * organization members endpoint is authoritative.
 *
 * Fails closed: an indeterminate answer is `unknown`, which callers must not treat as
 * membership. Only a definitive 404 is `not_member`.
 */
export async function checkOrgMembership(
  octokit: Octokit,
  org: string,
  username: string,
): Promise<MembershipResult> {
  try {
    const response = await octokit.rest.orgs.getMembershipForUser({ org, username });
    if (response.data.state === 'active') {
      return { status: 'member', role: response.data.role };
    }
    return { status: 'not_member' };
  } catch (error) {
    if (error instanceof RequestError) {
      if (error.status === 404) return { status: 'not_member' };
      return { status: 'unknown', reason: `GitHub returned ${error.status}` };
    }
    return { status: 'unknown', reason: 'membership lookup failed' };
  }
}
