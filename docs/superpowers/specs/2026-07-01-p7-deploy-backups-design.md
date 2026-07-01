# P7: Deploy Infrastructure (Litestream + restic backups) - Design

**Status:** Approved
**Scope:** Repo-side deploy artifacts only - SQLite replication (Litestream) and uploads backup (restic), both targeting Cloudflare R2. VPS provisioning, DNS, Google/Telegram/Gemini credential acquisition, and the actual deploy commands are NOT in this scope - those become a separate manual runbook document, handed over after this plan ships.

## Why

P0 already scaffolded `deploy/Caddyfile` and `deploy/wanderwallet.service` (reverse proxy + app process) but never added the backup half of the original roadmap item ("Litestream + restic backups, server hardening"). Without this, the SQLite DB and uploaded receipt images have zero durability - a lost/corrupted VPS disk means total data loss. This closes that gap before the app goes live on a real host.

## Non-goals

- No code changes to the Next.js app itself. This plan only adds files under `deploy/`.
- No actual VPS provisioning, DNS setup, or credential acquisition - those are manual, host-specific steps that don't belong in a git repo and will be handed to the user as a runbook after this plan merges.
- No signed image URLs (evaluated and dropped - the existing `/api/expenses/[id]/image` route is already session + trip-membership gated, so there's no unauthenticated-link use case to build for).
- No server hardening beyond what's already in `deploy/wanderwallet.service` (non-root user, `MemoryMax`, etc from P0) - firewall/SSH hardening is runbook material, not repo config.

## Backup targets

Both backups go to Cloudflare R2 (S3-compatible, free tier, zero egress fees - chosen over Backblaze B2 per user preference). Two separate concerns, two separate tools:

- **SQLite DB** (`dev.db`, the live app database): Litestream, which continuously streams WAL changes to R2 - point-in-time recovery, no cron needed, runs as its own systemd service alongside the app.
- **Uploaded receipt images** (`uploads/` directory): restic, run on a daily systemd timer - these are static files written once (photo upload) and read many times, a daily snapshot is sufficient (unlike the DB, which changes on every expense).

Both tools' credentials (R2 access key, secret, bucket) live in a separate `deploy/backup.env` file (gitignored, only `deploy/backup.env.example` is committed) - kept apart from the app's own `.env` since these are infrastructure secrets the app process itself never needs to read.

## File Map

| File | Action | Purpose |
|------|--------|---------|
| `deploy/litestream.yml` | Create | Litestream config: replicates `/opt/wanderwallet/dev.db` to R2, env-var substitution for bucket/endpoint/credentials |
| `deploy/litestream.service` | Create | systemd unit running `litestream replicate -config /opt/wanderwallet/deploy/litestream.yml` |
| `deploy/backup-uploads.sh` | Create | Shell script: `restic backup` of `uploads/`, with `restic init` guard for first run, and `restic forget --prune` to cap snapshot retention |
| `deploy/wanderwallet-backup.service` | Create | systemd oneshot unit running `backup-uploads.sh` |
| `deploy/wanderwallet-backup.timer` | Create | systemd timer triggering the above service daily |
| `deploy/backup.env.example` | Create | Template documenting the R2 credentials/bucket vars both tools need |
| `.gitignore` | Modify | Add `deploy/backup.env` (the real secrets file, never committed) |
| `README.md` | Modify | Add a short "Backups" subsection under the existing deploy notes, pointing at `deploy/` and noting the runbook covers activation |

## Configuration details

**Litestream config** (`deploy/litestream.yml`) uses Litestream's built-in `${VAR}` env substitution - no templating step needed, the systemd `EnvironmentFile=` directive injects `deploy/backup.env` directly into the process, and Litestream reads the vars at startup. Replicates one DB (`/opt/wanderwallet/dev.db`) to one R2 bucket, using the `s3` replica type (R2 is S3-compatible, just needs a custom endpoint URL).

**restic script** (`deploy/backup-uploads.sh`) is a plain bash script (not a systemd `ExecStart=` inline command) so it can contain the `restic snapshots || restic init` first-run guard and the `--prune` retention call as readable, testable shell logic rather than cramming conditionals into a unit file. It sources `deploy/backup.env` itself (via `set -a; source; set +a`) since restic reads its repository/password from environment variables the same way Litestream does.

**Retention policy for restic:** keep 7 daily, 4 weekly, 6 monthly snapshots (`restic forget --keep-daily 7 --keep-weekly 4 --keep-monthly 6 --prune`) - reasonable for a personal app with infrequent receipt uploads, bounds storage growth without needing to think about it.

## Testing

No automated tests - these are static config files and a shell script with no app-level logic to unit test. Verification is:
- `litestream.yml` is valid YAML and references only env vars that `backup.env.example` documents.
- `backup-uploads.sh` passes `shellcheck` (already likely available or easy to note as a manual check - not a new npm dependency, it's a standalone linter; if shellcheck isn't available in the execution environment, a careful manual read-through of the script substitutes).
- No `npx tsc --noEmit` relevance here since no TypeScript changes - task steps just need to confirm the app itself remains unaffected (`npm test` still passes, since these are net-new files only).

## Global Constraints (inherited from project)

- No new npm dependencies (Litestream and restic are external binaries installed on the VPS via the runbook, not npm packages).
- No em dashes or en dashes anywhere in any file, including these config files and comments within them.
- Conventional commits.
- `deploy/backup.env` must never be committed - `.gitignore` update is part of this plan, not optional.

## After this plan ships

A separate runbook document (not part of this plan or its implementation) will cover: Hostinger VPS provisioning, DuckDNS setup, `GEMINI_API_KEY`/`TELEGRAM_BOT_TOKEN`/`TELEGRAM_WEBHOOK_SECRET` acquisition, Cloudflare R2 bucket creation, and the actual SSH deploy steps using the Caddyfile/systemd files (existing + new from this plan).
