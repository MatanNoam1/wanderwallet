# P7 (revised): Docker Deploy Infrastructure - Design

**Status:** Approved
**Supersedes:** `docs/superpowers/specs/2026-07-01-p7-deploy-backups-design.md` and its implementation plan, both already merged to main as bare-systemd deploy artifacts. This design replaces that approach with Docker, after the user confirmed (via SSH into the real VPS) that the box already runs Docker for another service (a Telegram bot container) and has zero app-level systemd units - Docker is this box's established convention, not bare systemd.

## Why

The original P7 assumed a single-purpose VPS. The real VPS is shared with other services, one of which already runs in Docker. Bare systemd units for wanderwallet would be the only non-containerized app on the box - inconsistent, and loses the isolation benefits (Node version conflicts, clean teardown, per-app resource limits, no shared `node_modules` or port collisions) that matter more on a multi-tenant host than on a dedicated one.

## VPS state (confirmed via SSH, 2026-07-02)

- No process bound to ports 80/443 - no existing reverse proxy to work around.
- Docker and containerd already running as system services.
- One container running: a Telegram affiliate bot (unrelated to wanderwallet).
- No app-level systemd units at all - every other service on this box is (or will be) a container.

This means wanderwallet's Caddy runs in its own compose stack (not registered with some pre-existing shared proxy, because there isn't one), and ports 80/443 are free to bind directly.

## Architecture

Single `docker-compose.yml` stack, 4 services:

- **`app`** - the Next.js server. Multi-stage Dockerfile: a build stage (`npm ci`, `npx prisma generate`, `npm run build`) and a runtime stage that copies the full `node_modules`, `.next` build output, `public/`, and `prisma/` from the build stage, then runs `npm run start`. Not published to the host - only reachable from `caddy` over the compose network. Runs `npx prisma migrate deploy` before starting the server, so schema migrations apply automatically on every deploy.
- **`caddy`** - official `caddy` image, binds `80:80` and `443:443` on the host, mounts an adapted `deploy/Caddyfile`, reverse-proxies to `app`'s internal port. A named volume persists Let's Encrypt certificates across container restarts (so a redeploy doesn't re-trigger ACME issuance and hit Let's Encrypt's rate limits).
- **`litestream`** - official `litestream/litestream` image, shares `app`'s SQLite volume (same file, read-write, since Litestream tails the live WAL), replicates continuously to Cloudflare R2. Same config shape as the merged P7's `litestream.yml`, paths adjusted for the container's filesystem instead of `/opt/wanderwallet`.
- **`restic`** - a small image with `restic` installed, running a `while true; sleep 86400; restic backup ...; done`-style loop instead of a systemd timer (containers don't have cron by default; a sleep loop is the standard sidecar pattern for a daily job that doesn't need sub-second scheduling precision). Shares `app`'s uploads volume read-only (restic only reads, never writes, the uploads directory).

**Volumes** (named, not bind mounts, so `docker compose down` alone never touches data - only `docker compose down -v` would):
- `db-data` - mounted into both `app` and `litestream` at the same path, holds the SQLite file.
- `uploads-data` - mounted read-write into `app`, read-only into `restic`, holds receipt images.
- `caddy-data` - mounted into `caddy` only, holds TLS certs/keys.

**Secrets:** `deploy/backup.env` (already gitignored from the merged P7, unchanged) is read by `litestream` and `restic` via compose's `env_file:` directive - same six var names as before (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `R2_ACCOUNT_ID`, `R2_BUCKET`, `RESTIC_REPOSITORY`, `RESTIC_PASSWORD`). The app's own `.env` (already gitignored) is read by `app` the same way.

## What changes vs. the merged systemd-based P7

**Removed** (systemd-specific, no longer applicable):
- `deploy/wanderwallet.service`
- `deploy/litestream.service`
- `deploy/wanderwallet-backup.service`
- `deploy/wanderwallet-backup.timer`

**Adapted** (same purpose, container paths/mechanism instead of host paths/systemd):
- `deploy/Caddyfile` - `reverse_proxy` target changes from `127.0.0.1:3000` to the compose service name (`app:3000`), everything else (domain, `encode zstd gzip`) stays.
- `deploy/litestream.yml` - `dbs[0].path` changes from `/opt/wanderwallet/dev.db` to the container's mounted volume path; replica config (bucket/endpoint/env-var substitution) is unchanged.
- `deploy/backup-uploads.sh` - becomes the restic container's loop script; the `restic snapshots || restic init` guard, `restic backup`, and `restic forget --prune` retention policy logic (7 daily / 4 weekly / 6 monthly) all carry over unchanged, only the working directory path changes.
- `deploy/backup.env.example` - unchanged, same six vars, just consumed by `env_file:` instead of `EnvironmentFile=`.

**New:**
- `Dockerfile` (repo root)
- `deploy/docker-compose.yml`
- `.dockerignore` (repo root) - excludes `node_modules`, `.next`, `.git`, `uploads/`, `*.db*`, `.env` from the build context.

**Not used:** Next's `output: "standalone"` build mode. It's the usual recommendation for Docker deploys because it prunes `node_modules` to only what the app's own code needs, but this app also runs `npx prisma migrate deploy` as a startup step - the Prisma CLI has its own dependency tree (including `prisma`, `@prisma/*` packages, and transitively `dotenv` for `prisma.config.ts`) that Next's file tracer has no reason to include, since the CLI isn't `require()`-d by app code. Hand-copying just enough of that tree into a pruned `node_modules` is fragile and easy to silently break on a future `npm update`. Copying the full `node_modules` from the build stage instead is simpler and correct by construction; the image is a few hundred MB larger, which doesn't matter for a personal, low-traffic app.

## Base image choice

`node:22-slim` (Debian-based, glibc), not `node:22-alpine`. `better-sqlite3` is a native addon; its prebuilt binary releases target glibc-linux, not Alpine's musl libc. Using slim avoids needing a full C++ toolchain (`python3`, `make`, `g++`) in the build stage just to compile `better-sqlite3` from source, and avoids the runtime image needing musl-compatible native bindings that may not exist as prebuilds. Slim is a few tens of MB larger than Alpine but meaningfully simpler and more reliable for this dependency.

## Testing

No automated tests - like the original P7, this is infrastructure config (Dockerfile, compose file, shell script), not app logic. Verification:
- `docker build .` succeeds and produces a runnable image (this can be done locally as part of the implementation task, doesn't require the real VPS).
- `docker compose config` validates the compose file's YAML/schema without starting anything.
- `npm test` still passes (no app code touched, except the `next.config.ts` one-line addition, which doesn't affect any test).
- Actual container startup, migration, Caddy TLS issuance, and backup runs against real R2 credentials are runbook-time verification on the real VPS, not part of this plan (consistent with how the original P7 scoped VPS activation as a separate runbook).

## Global Constraints (inherited from project)

- No new npm dependencies (Docker/Caddy/Litestream/restic are container images, not npm packages).
- No em dashes or en dashes anywhere in any file.
- Conventional commits.
- `deploy/backup.env` must never be committed (already enforced by the existing `.gitignore` entry from the merged P7 - unchanged).
