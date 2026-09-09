# Devin Conductor

Devin Conductor orchestates Devin, the AI coding agent, to automatically author PRs that resolve GitHub issues as soon as they're raised.

When someone opens an issue in an enabled GitHub repository, Conductor
automates the resolution - it starts a Devin session for that repository, keeps one status comment on the issue up to date,
and tracks the resulting pull request until a person merges or closes it.


## The UI

Three pages:

- **Observe** – list of tasks and their current state. Each task links to the Devin session and
  shows messages and pull requests.
- **Report** – Cost tracking, how many issues were dispatched, how many got a PR, how many were merged, median
  time to PR, and adoption metrics.
- **Configure** – which repositories are enabled, max concurrent sessions, ACU limit, a global
  pause switch, and connection checks for GitHub and Devin.

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

- Next.js (App Router) and TypeScript, running as a single container.
- SQLite via `better-sqlite3`. Migrations run at startup. All state lives on one mounted volume.
- The job queue is a SQLite table. Jobs are claimed in a transaction with a two-minute lease;
  if the process dies the lease expires and the job is picked up again. Failed jobs retry with
  exponential backoff. Jobs that can't run yet because of the pause switch or the concurrency
  limit are deferred without counting as a failed attempt.
- One worker loop runs in the process where `WORKER_ENABLED=true`.

### Design notes

- The webhook handler doesn't call Devin. It verifies the signature, stores the delivery,
  enqueues a job, and returns `202`. The worker does the rest, so GitHub's delivery timeout and
  Devin's API latency don't interact.
- Before dispatching, the worker checks that the repository is in the configured org, that the
  app is still installed on it, that it's enabled in Configure, and that the issue author is an
  org member. If the membership check itself fails (e.g. GitHub is down), the job retries later
  rather than dispatching.
- Issue titles and bodies come from users, so the prompt sent to Devin puts our instructions
  first and wraps the issue text in a clearly marked untrusted block.
- Each dispatch attempt gets a unique tag that is passed to Devin. If the create-session call
  times out and we don't know whether it succeeded, the worker searches sessions by that tag and
  adopts the match instead of creating a second session. If there is somehow more than one
  match it takes the newest and flags it for review.
- Task state is derived from pull request facts first (merged, open, closed) and only falls back
  to Devin's session status when there is no PR.
- The status comment on the issue is created once and edited afterwards. It's only rewritten
  when the content actually changes, and it's recreated if someone deletes it.
- Rates with a zero denominator are shown as `—` rather than `0%`.

## Running it

```bash
cp .env.example .env      # fill in the values below
npm install
npm run dev               # http://localhost:3000
```

With Docker:

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

Unit tests (`tests/unit`) cover webhook signature verification, prompt construction, state
derivation, backoff, log redaction, and session cookies.

Integration tests (`tests/integration`) run against a real SQLite database with GitHub and Devin
mocked: the webhook route, the job queue (leases, retries, deferral), the status comment, the
metrics queries, and the full pipeline from webhook to dispatch to reconcile to PR.

To see the UI with data but without a live GitHub App, seed a demo database:

```bash
DATABASE_PATH=./data/devin-conductor.sqlite npx tsx scripts/seed-demo.ts
```
