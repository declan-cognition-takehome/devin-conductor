# Devin Conductor

As part of our vision for an event-based SDLC, the Devon Conductor automatically resolves GitHub Issues using Devin, the AI coding agent.

When a member of the configured GitHub organization opens an issue in an enabled repository,
Conductor dispatches a Devin session scoped to that repository,
keeps a single status comment on the issue up to date, and tracks the resulting pull request
until a human merges or closes it.

## Product surfaces

| Surface       | Purpose                                                                                 |
| ------------- | --------------------------------------------------------------------------------------- |
| **Observe**   | Live task list and task detail: state, Devin session deep link, messages, pull requests |
| **Report**    | Dispatch, PR and merge rates, median time to PR, per-repository breakdown               |
| **Configure** | Repository enablement, concurrency ceiling, ACU limit, global pause, connection checks  |

## Architecture

```
GitHub  ──webhook──▶  /api/github/webhook  ──▶  webhook_deliveries  ──▶  jobs (SQLite queue)
                        (HMAC verified,                                      │
                         2 MiB cap, dedup)                                   ▼
                                                              in-process worker loop
                                                    process_delivery → dispatch → reconcile
                                                                 │          │        │
                                          tasks / attempts / messages / pull_requests
                                                                 │          │        │
                                        GitHub status comment ◀──┘          └──▶ Devin v3 API
```

- **Next.js App Router + TypeScript**, one always-running container.
- **SQLite via `better-sqlite3`** (WAL, foreign keys, busy timeout) with transactional migrations
  applied at startup. Everything durable lives on one mounted volume.
- **Durable job queue in SQLite**: transactional claims, two-minute leases, expired-lease
  recovery after a crash or restart, bounded exponential backoff with jitter, dedupe keys, and a
  separate defer path that refunds attempts for pause/concurrency backpressure.
- **Exactly one worker** runs in the process where `WORKER_ENABLED=true`.

### Design decisions worth knowing

- **Nothing is dispatched from the request path.** The webhook only verifies, persists, and
  enqueues, then returns `202`. Devin is called from the worker, so GitHub retries and Devin
  latency are decoupled.
- **Trust is checked before dispatch, and fails closed.** The repository must belong to the
  configured org, be actively installed, and be enabled locally; the issue author must be an
  active org member. If membership cannot be verified, the job retries rather than dispatching.
- **Issue content is untrusted input.** The remediation prompt puts trusted instructions first
  and fences the issue title/body inside an explicit untrusted block.
- **Uncertain dispatch is recoverable.** Every attempt carries a unique dispatch tag. If session
  creation times out with an ambiguous result, recovery looks the session up by exact tag and
  adopts it instead of creating a duplicate; multiple matches adopt the newest and record an
  anomaly for a human.
- **PR facts beat session status.** Business state (`merged`, `pr_ready`) is recomputed from
  pull request facts before falling back to raw Devin status.
- **One issue comment.** The status comment is created once and edited afterwards, and is only
  rewritten when the rendered body hash changes. A deleted comment is recreated.
- **No fabricated numbers.** Ratios with an empty denominator render as `—`.

## Running it

```bash
cp .env.example .env      # fill in the values below
npm install
npm run dev               # http://localhost:3000
```

Docker (how it is meant to run in production):

```bash
docker compose up --build -d
curl localhost:3000/api/health
curl localhost:3000/api/ready
```

The Compose file mounts a named volume at `/data`; SQLite, WAL, and all state live there and
survive `docker restart` and image upgrades.

## Configuration

Required: `APP_BASE_URL`, `SESSION_SECRET` (≥32 chars), `DATABASE_PATH`.

GitHub App: `GITHUB_ORG`, `GITHUB_APP_ID`, `GITHUB_APP_SLUG`, `GITHUB_CLIENT_ID`,
`GITHUB_CLIENT_SECRET`, `GITHUB_WEBHOOK_SECRET`, and the private key via `GITHUB_PRIVATE_KEY`,
`GITHUB_PRIVATE_KEY_BASE64`, or `GITHUB_PRIVATE_KEY_PATH`.

Devin: `DEVIN_ORG_ID` (`org-…`), `DEVIN_API_KEY` (service user `cog_…` with `UseDevinSessions`
and `ViewOrgSessions`), optionally `DEVIN_API_BASE_URL` and `DEVIN_APP_BASE_URL`.

Missing integration configuration degrades the relevant surface with an explicit banner instead
of crashing the app. See `.env.example` for the full list.

### GitHub App setup (manual, once)

1. Create an organization-owned GitHub App.
2. Permissions: Issues (read & write, for the status comment), Pull requests (read),
   Metadata (read), Members (read, for the membership gate).
3. Subscribe to: Issues, Pull request, Installation, Installation repositories.
4. Webhook URL `https://<host>/api/github/webhook`, with the same secret as
   `GITHUB_WEBHOOK_SECRET`.
5. Callback URL `https://<host>/api/auth/callback`.
6. Install it on the repositories you want available, then enable them in **Configure**.

## Security

- Webhook signatures are verified against the raw body with HMAC-SHA256 and a timing-safe
  comparison, before anything is persisted; deliveries are deduplicated by delivery ID.
- Sign-in is GitHub OAuth with state protection and a server-side org membership check; OAuth
  tokens are never persisted, only local user metadata.
- Sessions are signed, `__Host-` prefixed, HttpOnly and Secure; mutations require a
  double-submit CSRF token; unauthenticated API access is rejected.
- Secrets stay in process memory — never in SQLite, never in API responses. Logs and stored job
  errors run through a redactor covering `cog_` keys, GitHub tokens, private keys, bearer
  tokens, signatures and JWTs.

## Operations

- `GET /api/health` — liveness. `GET /api/ready` — migrations applied, queue depth, which
  integrations are configured.
- **Pause** in Configure stops new dispatches without dropping work; queued jobs defer and
  resume when unpaused.
- **Concurrency** and **ACU ceiling** in Configure bound cost and blast radius.
- After a crash, leases expire and in-flight jobs are re-claimed automatically; no manual
  cleanup is required.
- Backup: stop the container (or use `sqlite3 .backup`) and copy the `/data` volume.

## Testing

```bash
npm run format:check && npm run lint && npm run typecheck && npm test && npm run build
```

Coverage focuses on the parts where being wrong is expensive: signature verification, prompt
fencing, state precedence, queue leases/backoff/deferral, the full webhook→trust→dispatch→
reconcile→PR pipeline against a mocked Devin and GitHub, status-comment idempotency, metrics
with empty denominators, and session cookie tampering.
