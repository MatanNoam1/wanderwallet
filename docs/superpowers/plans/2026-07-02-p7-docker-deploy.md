# P7 (revised): Docker Deploy Infrastructure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the merged systemd-based P7 deploy artifacts with a Docker Compose stack (app + Caddy + Litestream + restic), matching the box's existing Docker-only convention confirmed on the real VPS.

**Architecture:** Three tasks. Task 1 builds the app's own Dockerfile and verifies it locally with `docker build`. Task 2 writes the compose stack and adapts the Caddyfile, removing the now-obsolete systemd unit files. Task 3 adapts Litestream's config and turns the restic backup script into a container sidecar loop, and updates the README.

**Tech Stack:** Docker, Docker Compose, multi-stage Dockerfile (`node:22-slim`), Caddy 2, Litestream, restic. No new npm dependencies.

## Global Constraints

- No new npm dependencies (Docker/Caddy/Litestream/restic are container images, not npm packages).
- No em dashes or en dashes anywhere in any file.
- Conventional commits; each task ends with a commit.
- `deploy/backup.env` must never be committed (already enforced by the existing `.gitignore` entry - unchanged by this plan).
- `npm test` must show no regressions after each task.
- Base image: `node:22-slim` (Debian-based, glibc) - not `node:22-alpine`. `better-sqlite3` is a native addon whose prebuilt binaries target glibc-linux; Alpine's musl libc would require compiling from source with a full C++ toolchain in the runtime image.
- Do not use Next's `output: "standalone"` build mode - the Prisma CLI (needed for `prisma migrate deploy` at container startup) has its own dependency tree Next's file tracer won't include. Copy the full `node_modules` from the build stage into the runtime image instead.

---

## Task 1: Dockerfile + .dockerignore

**Files:**
- Create: `Dockerfile`
- Create: `.dockerignore`

**Interfaces:**
- Produces: a `wanderwallet:local` image buildable with `docker build -t wanderwallet:local .` from the repo root. Task 2's `docker-compose.yml` builds from this same `Dockerfile` via `build: { context: .., dockerfile: Dockerfile }` (compose file lives in `deploy/`, so `..` resolves to the repo root).

- [ ] **Step 1: Create `.dockerignore`**

```
node_modules
.next
.git
.worktrees
uploads
*.db
*.db-journal
*.db-wal
*.db-shm
.env
.env.local
docs
```

- [ ] **Step 2: Create `Dockerfile`**

```dockerfile
# syntax=docker/dockerfile:1

# ---- deps: install once, reused by the build stage ----
FROM node:22-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ---- build: generate the Prisma client and build the Next.js app ----
FROM node:22-slim AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate
RUN npm run build

# ---- runtime: full node_modules (Prisma CLI needs its own deps at startup,
# see Global Constraints - do not switch this to Next's standalone output) ----
FROM node:22-slim AS runner
WORKDIR /app
ENV NODE_ENV=production

RUN groupadd --system --gid 1001 wanderwallet \
  && useradd --system --uid 1001 --gid wanderwallet wanderwallet

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/prisma.config.ts ./prisma.config.ts
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/next.config.ts ./next.config.ts

RUN mkdir -p /app/data /app/uploads && chown -R wanderwallet:wanderwallet /app/data /app/uploads

USER wanderwallet
EXPOSE 3000

CMD ["sh", "-c", "npx prisma migrate deploy && npm run start"]
```

- [ ] **Step 3: Build the image locally**

```bash
cd "/mnt/c/Users/matan/General Projects/Projects/wanderwallet" && docker build -t wanderwallet:local .
```

Expected: build completes successfully (exits 0), ending with something like `Successfully tagged wanderwallet:local` or the buildkit equivalent `naming to docker.io/library/wanderwallet:local`.

- [ ] **Step 4: Sanity-check the image starts and can reach `npm run start`'s help/version (no real DB or env needed for this smoke check)**

```bash
docker run --rm wanderwallet:local npx next --version
```

Expected: prints a Next.js version string (e.g. `Next.js v16.2.9`), confirming the image's `node_modules` and `next` binary are present and runnable. This does not start the full app (no `.env`/`DATABASE_URL` provided yet - that's exercised for real in Task 2 once the compose stack exists), it only confirms the image itself is not broken.

- [ ] **Step 5: Verify no regressions in the app's own test suite**

```bash
cd "/mnt/c/Users/matan/General Projects/Projects/wanderwallet" && npm test 2>&1 | tail -10
```

Expected: all existing tests still pass (this task adds no app code).

- [ ] **Step 6: Commit**

```bash
cd "/mnt/c/Users/matan/General Projects/Projects/wanderwallet"
git add Dockerfile .dockerignore
git commit -m "chore(deploy): add multi-stage Dockerfile for the app"
```

---

## Task 2: Docker Compose stack + Caddyfile adaptation + remove obsolete systemd files

**Files:**
- Create: `deploy/docker-compose.yml`
- Modify: `deploy/Caddyfile`
- Delete: `deploy/wanderwallet.service`
- Delete: `deploy/litestream.service`
- Delete: `deploy/wanderwallet-backup.service`
- Delete: `deploy/wanderwallet-backup.timer`

**Interfaces:**
- Consumes: `Dockerfile` from Task 1 (referenced by `build:` in the compose file).
- Produces: compose service names `app` (port 3000 internal), `caddy` (80/443 published), `litestream`, `restic`; named volumes `db-data`, `uploads-data`, `caddy-data`. Task 3's `deploy/litestream.yml` and `deploy/backup-uploads.sh` are mounted into the `litestream` and `restic` services by name - Task 3 must keep those exact filenames since this task's compose file already references them (`./litestream.yml`, `./backup-uploads.sh`, both relative to `deploy/` where the compose file lives).

- [ ] **Step 1: Create `deploy/docker-compose.yml`**

```yaml
# deploy/docker-compose.yml
# Run from the repo root: docker compose -f deploy/docker-compose.yml up -d
# Requires deploy/backup.env (copy from deploy/backup.env.example) and the
# app's own .env (copy from .env.example) both present at the repo root
# before starting.
services:
  app:
    build:
      context: ..
      dockerfile: Dockerfile
    restart: always
    env_file:
      - ../.env
    environment:
      # Overrides .env's DATABASE_URL to point at the mounted volume path -
      # the value in .env is for local `npm run dev`, this is for the container.
      DATABASE_URL: "file:/app/data/dev.db"
    volumes:
      - db-data:/app/data
      - uploads-data:/app/uploads
    expose:
      - "3000"

  caddy:
    image: caddy:2-alpine
    restart: always
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy-data:/data
    depends_on:
      - app

  litestream:
    image: litestream/litestream:latest
    restart: always
    env_file:
      - ./backup.env
    volumes:
      - db-data:/app/data
      - ./litestream.yml:/etc/litestream.yml:ro
    command: ["replicate", "-config", "/etc/litestream.yml"]
    depends_on:
      - app

  restic:
    image: restic/restic:latest
    restart: always
    env_file:
      - ./backup.env
    volumes:
      - uploads-data:/data/uploads:ro
      - ./backup-uploads.sh:/backup-uploads.sh:ro
    entrypoint: ["/bin/sh", "/backup-uploads.sh"]
    depends_on:
      - app

volumes:
  db-data:
  uploads-data:
  caddy-data:
```

- [ ] **Step 2: Validate the compose file's syntax**

```bash
cd "/mnt/c/Users/matan/General Projects/Projects/wanderwallet" && docker compose -f deploy/docker-compose.yml config --quiet
```

Expected: no output and exit code 0 (validates YAML + schema without starting anything; `--quiet` suppresses the resolved config dump on success).

- [ ] **Step 3: Adapt `deploy/Caddyfile`**

Read the current file, then replace its entire contents:

```
# deploy/Caddyfile
# Automatic TLS (Let's Encrypt) + reverse proxy to the app container.
wanderwallet.example.com {
	encode zstd gzip
	reverse_proxy app:3000
}
```

(Only change from the previous version: `reverse_proxy 127.0.0.1:3000` -> `reverse_proxy app:3000`, since Caddy now reaches the app over the Docker Compose network by service name instead of a host port.)

- [ ] **Step 4: Delete the obsolete systemd unit files**

```bash
cd "/mnt/c/Users/matan/General Projects/Projects/wanderwallet"
git rm deploy/wanderwallet.service deploy/litestream.service deploy/wanderwallet-backup.service deploy/wanderwallet-backup.timer
```

- [ ] **Step 5: Verify no regressions**

```bash
cd "/mnt/c/Users/matan/General Projects/Projects/wanderwallet" && npm test 2>&1 | tail -10
```

Expected: all existing tests still pass.

- [ ] **Step 6: Commit**

```bash
cd "/mnt/c/Users/matan/General Projects/Projects/wanderwallet"
git add deploy/docker-compose.yml deploy/Caddyfile
git commit -m "chore(deploy): add docker-compose stack, adapt Caddyfile, remove systemd units"
```

(The `git rm` in Step 4 stages the deletions; they're included in this same commit alongside the additions/modifications in the `git add` above - one commit for the whole compose-stack switch, since these files are all part of the same coherent change and reviewing them split apart would be less clear than reviewing the switch as a whole.)

---

## Task 3: Litestream + restic container adaptation, README update

**Files:**
- Modify: `deploy/litestream.yml`
- Modify: `deploy/backup-uploads.sh`
- Modify: `README.md`

**Interfaces:**
- Consumes: the exact filenames `deploy/litestream.yml` and `deploy/backup-uploads.sh`, which Task 2's `docker-compose.yml` already mounts by these names into the `litestream` and `restic` services respectively - do not rename either file.

- [ ] **Step 1: Adapt `deploy/litestream.yml`**

Read the current file, then replace its entire contents:

```yaml
# deploy/litestream.yml
# Continuously replicates the app's SQLite DB to Cloudflare R2 (S3-compatible).
# Runs in the litestream sidecar container - see deploy/docker-compose.yml.
# Litestream reads AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY from the process
# environment automatically (injected via compose's env_file: deploy/backup.env)
# - no credentials appear in this file.
dbs:
  - path: /app/data/dev.db
    replicas:
      - type: s3
        bucket: ${R2_BUCKET}
        path: db
        endpoint: https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com
        region: auto
```

(Only change from the previous version: the `path` changes from `/opt/wanderwallet/dev.db` to `/app/data/dev.db`, matching the `db-data` volume's mount point in the `app` and `litestream` services from Task 2.)

- [ ] **Step 2: Adapt `deploy/backup-uploads.sh`**

Read the current file, then replace its entire contents:

```sh
#!/bin/sh
# Daily backup of the uploads volume (receipt images) to Cloudflare R2 via
# restic. Runs in the restic sidecar container - see deploy/docker-compose.yml.
# Credentials come from deploy/backup.env via compose's env_file:, already
# present in this container's environment - no sourcing needed here.
set -eu

backup_once() {
  if ! restic snapshots >/dev/null 2>&1; then
    echo "restic repository not initialized, running restic init"
    restic init
  fi

  restic backup /data/uploads --tag wanderwallet-uploads

  # Keep 7 daily, 4 weekly, 6 monthly snapshots; prune anything older, so
  # storage growth stays bounded without manual attention.
  restic forget --keep-daily 7 --keep-weekly 4 --keep-monthly 6 --prune
}

# The restic image has no cron - loop with a daily sleep instead.
while true; do
  backup_once
  sleep 86400
done
```

Changes from the previous version: shebang `#!/usr/bin/env bash` -> `#!/bin/sh` (the official `restic/restic` image is Alpine-based with only POSIX `sh`, no bash); `set -euo pipefail` -> `set -eu` (`pipefail` is a bash-only option, not available in POSIX `sh`); dropped the `cd /opt/wanderwallet` and `source deploy/backup.env` lines (compose's `env_file:` already injects the vars directly into the container's environment, no host filesystem paths or manual sourcing needed); `uploads/` -> `/data/uploads` (matches the `uploads-data:/data/uploads:ro` mount in the `restic` service from Task 2); wrapped the backup logic in a `backup_once` function called from an infinite loop with a 24-hour sleep, replacing the systemd timer's daily trigger.

- [ ] **Step 3: Verify the script is still marked executable in git's index**

This repo runs on a WSL/NTFS checkout where `core.fileMode` may be `false`, meaning a plain `chmod +x` might not register through `git add` (this bit the P6 backlog-cleanup task before). Check first:

```bash
cd "/mnt/c/Users/matan/General Projects/Projects/wanderwallet" && git ls-files -s deploy/backup-uploads.sh
```

If the mode shown (first column) is `100644` instead of `100755`, force it:

```bash
git update-index --chmod=+x deploy/backup-uploads.sh
```

Then re-run the `git ls-files -s` command above and confirm it now shows `100755` before proceeding.

- [ ] **Step 4: Add a Docker note to the README's Backups section**

Read the current `README.md`, find the `## Backups` section (added in the previous, now-superseded systemd-based P7), and replace its entire contents:

Find:

```markdown
## Backups

Production deploys replicate the SQLite DB continuously with
[Litestream](https://litestream.io) and back up the `uploads/` directory
daily with [restic](https://restic.net), both to a Cloudflare R2 bucket.
Config lives in `deploy/` (`litestream.yml`, `litestream.service`,
`backup-uploads.sh`, `wanderwallet-backup.service`,
`wanderwallet-backup.timer`). Credentials go in `deploy/backup.env` (copy
from `deploy/backup.env.example`, gitignored, never committed). VPS
provisioning and service activation are covered in the deploy runbook, not
in this repo.
```

Replace with:

```markdown
## Deploy

Runs as a Docker Compose stack: the app, Caddy (reverse proxy + automatic
HTTPS), Litestream (continuous SQLite replication), and restic (daily
uploads backup), all defined in `deploy/docker-compose.yml`. Start with
`docker compose -f deploy/docker-compose.yml up -d` from the repo root.
Requires `.env` (copy from `.env.example`) and `deploy/backup.env` (copy
from `deploy/backup.env.example`) both present at the repo root first.

## Backups

Litestream replicates the SQLite DB continuously and restic backs up the
`uploads/` directory daily, both to a Cloudflare R2 bucket, running as
sidecar containers in the compose stack (`deploy/litestream.yml`,
`deploy/backup-uploads.sh`). Credentials go in `deploy/backup.env`
(gitignored, never committed). VPS provisioning, DNS, and API-key
acquisition are covered in the deploy runbook, not in this repo.
```

- [ ] **Step 5: Verify no regressions**

```bash
cd "/mnt/c/Users/matan/General Projects/Projects/wanderwallet" && npm test 2>&1 | tail -10
```

Expected: all existing tests still pass.

- [ ] **Step 6: Commit**

```bash
cd "/mnt/c/Users/matan/General Projects/Projects/wanderwallet"
git add deploy/litestream.yml deploy/backup-uploads.sh README.md
git commit -m "chore(deploy): adapt Litestream and restic for containers, update README"
```

---

## Self-Review

### Spec coverage

| Design item | Task |
|-------------|------|
| `Dockerfile` (multi-stage, `node:22-slim`, full `node_modules` not standalone) | Task 1 |
| `.dockerignore` | Task 1 |
| `deploy/docker-compose.yml` (4 services, 3 named volumes) | Task 2 |
| `deploy/Caddyfile` adaptation (`app:3000` instead of `127.0.0.1:3000`) | Task 2 |
| Remove `wanderwallet.service`, `litestream.service`, `wanderwallet-backup.service`, `wanderwallet-backup.timer` | Task 2 |
| `deploy/litestream.yml` adaptation (container DB path) | Task 3 |
| `deploy/backup-uploads.sh` adaptation (sh not bash, sidecar loop, container paths) | Task 3 |
| `deploy/backup.env.example` unchanged | Correctly absent from this plan - design states it's unchanged |
| README Docker/Backups update | Task 3 |
| No `output: "standalone"` | Correctly absent - Dockerfile in Task 1 uses full `node_modules` |
| Base image `node:22-slim` not alpine | Task 1, Dockerfile content |

### Placeholder scan

None - every step has complete file contents or exact commands.

### Type consistency

- Volume mount paths are consistent across all three tasks: `/app/data` (DB) appears in Task 1's Dockerfile (`RUN mkdir -p /app/data`), Task 2's compose file (`db-data:/app/data` for both `app` and `litestream`), and Task 3's `litestream.yml` (`path: /app/data/dev.db`). `/app/uploads` (Task 1, Task 2's `app` service) and `/data/uploads` (Task 2's `restic` service, Task 3's `backup-uploads.sh`) are intentionally different paths - `uploads-data` is one volume mounted at two different paths in two different containers, which is normal Docker behavior (each service picks its own mount point), not a mismatch.
- `DATABASE_URL: "file:/app/data/dev.db"` in Task 2's compose `environment:` matches `/app/data/dev.db` used in Task 3's `litestream.yml` - same file, same path, from two different services' perspectives, as required for Litestream to tail the live DB Prisma is writing to.
- Task 2's compose file references `./litestream.yml` and `./backup-uploads.sh` by exact filename (relative to `deploy/`, where the compose file lives) - Task 3 modifies those same two files in place rather than renaming them, so no dangling reference.
- Env var names in `deploy/backup.env.example` (unchanged, not part of this plan) - `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `R2_ACCOUNT_ID`, `R2_BUCKET`, `RESTIC_REPOSITORY`, `RESTIC_PASSWORD` - are consumed identically by Task 2's `litestream` and `restic` services (`env_file: ./backup.env`) and Task 3's `litestream.yml`/`backup-uploads.sh` (`${R2_BUCKET}`, `${R2_ACCOUNT_ID}` substitution; `RESTIC_REPOSITORY`/`RESTIC_PASSWORD` read directly by the `restic` binary from its environment).
