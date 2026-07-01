# P7: Deploy Infrastructure (Litestream + restic backups) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add SQLite replication (Litestream) and uploads-directory backup (restic) config, both targeting Cloudflare R2, so the app has durable backups once deployed.

**Architecture:** Three tasks, each a self-contained group of static config/script files under `deploy/`. Task 1 lays the shared credentials template both tools read. Task 2 adds Litestream (continuous DB replication). Task 3 adds the restic backup script + systemd timer, and documents the new `deploy/` contents in the README.

**Tech Stack:** systemd units, YAML (Litestream config), bash (restic script). No app code, no new npm dependencies - Litestream and restic are external binaries installed on the VPS by a separate runbook, not part of this repo's dependency tree.

## Global Constraints

- No new npm dependencies.
- No em dashes or en dashes anywhere in any file, including config files and comments.
- Conventional commits; each task ends with a commit.
- `deploy/backup.env` (the real secrets file) must never be committed - only `deploy/backup.env.example` is tracked.
- `npm test` must show no regressions after each task (these are net-new files, existing tests are unaffected, but confirming this stays true is part of each task's verification).

---

## Task 1: Shared backup credentials template

**Files:**
- Create: `deploy/backup.env.example`
- Modify: `.gitignore`

**Interfaces:**
- Produces: the env var names `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `R2_ACCOUNT_ID`, `R2_BUCKET`, `RESTIC_REPOSITORY`, `RESTIC_PASSWORD` - Task 2 (Litestream) reads `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`/`R2_ACCOUNT_ID`/`R2_BUCKET`. Task 3 (restic) reads all six.

- [ ] **Step 1: Create `deploy/backup.env.example`**

```bash
# Cloudflare R2 credentials and backup config for Litestream + restic.
# Copy to deploy/backup.env on the server and fill in real values.
# deploy/backup.env is gitignored - never commit real credentials.

# R2 API token (Cloudflare dashboard -> R2 -> Manage API Tokens -> Create API Token,
# permissions: Object Read & Write, scoped to the bucket below).
AWS_ACCESS_KEY_ID=""
AWS_SECRET_ACCESS_KEY=""

# R2 account id (Cloudflare dashboard -> R2 -> Overview, shown in the account-level
# S3 API URL) and the bucket name (create one bucket, both tools use different
# path prefixes inside it).
R2_ACCOUNT_ID=""
R2_BUCKET="wanderwallet-backups"

# restic repository (uses R2_ACCOUNT_ID and R2_BUCKET set above) and its
# encryption password - restic encrypts all backup data at rest with this.
# Generate one with: openssl rand -base64 32
RESTIC_REPOSITORY="s3:https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${R2_BUCKET}/uploads"
RESTIC_PASSWORD=""
```

- [ ] **Step 2: Add `deploy/backup.env` to `.gitignore`**

Read the current `.gitignore`, find the `# git worktrees` section near the bottom (added in a prior plan), and add a new section right after it:

```
# git worktrees
.worktrees/

# backup credentials (real secrets, never commit)
deploy/backup.env
```

- [ ] **Step 3: Verify no regressions**

```bash
cd "/mnt/c/Users/matan/General Projects/Projects/wanderwallet" && npm test 2>&1 | tail -10
```

Expected: all existing tests still pass (this task adds no app code, so the count is unchanged from before this task).

- [ ] **Step 4: Commit**

```bash
cd "/mnt/c/Users/matan/General Projects/Projects/wanderwallet"
git add deploy/backup.env.example .gitignore
git commit -m "chore(deploy): add backup credentials template for R2"
```

---

## Task 2: Litestream continuous SQLite replication

**Files:**
- Create: `deploy/litestream.yml`
- Create: `deploy/litestream.service`

**Interfaces:**
- Consumes: `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `R2_ACCOUNT_ID`, `R2_BUCKET` (defined in Task 1's `deploy/backup.env.example` - the real file is injected at runtime via systemd's `EnvironmentFile=`).
- Produces: nothing consumed by later tasks - this is a standalone systemd service.

- [ ] **Step 1: Create `deploy/litestream.yml`**

```yaml
# /opt/wanderwallet/deploy/litestream.yml
# Continuously replicates the app's SQLite DB to Cloudflare R2 (S3-compatible).
# Litestream reads AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY from the process
# environment automatically (set via deploy/backup.env, injected by
# litestream.service's EnvironmentFile= directive) - no credentials appear
# in this file.
dbs:
  - path: /opt/wanderwallet/dev.db
    replicas:
      - type: s3
        bucket: ${R2_BUCKET}
        path: db
        endpoint: https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com
        region: auto
```

- [ ] **Step 2: Create `deploy/litestream.service`**

```
# /etc/systemd/system/litestream.service
# Continuous SQLite replication to R2. Runs alongside wanderwallet.service.
[Unit]
Description=Litestream (continuous SQLite replication to R2)
After=network.target wanderwallet.service

[Service]
Type=simple
User=wanderwallet
EnvironmentFile=/opt/wanderwallet/deploy/backup.env
ExecStart=/usr/bin/litestream replicate -config /opt/wanderwallet/deploy/litestream.yml
Restart=always
RestartSec=3
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

- [ ] **Step 3: Validate the YAML is well-formed**

```bash
cd "/mnt/c/Users/matan/General Projects/Projects/wanderwallet" && python3 -c "import yaml; yaml.safe_load(open('deploy/litestream.yml'))" && echo "valid YAML"
```

Expected: `valid YAML` (if `python3`/`pyyaml` isn't available in this environment, read the file back and manually confirm indentation is consistent 2-space and the structure matches the code block above exactly - note which method was used in the task report).

- [ ] **Step 4: Verify no regressions**

```bash
cd "/mnt/c/Users/matan/General Projects/Projects/wanderwallet" && npm test 2>&1 | tail -10
```

Expected: all existing tests still pass.

- [ ] **Step 5: Commit**

```bash
cd "/mnt/c/Users/matan/General Projects/Projects/wanderwallet"
git add deploy/litestream.yml deploy/litestream.service
git commit -m "chore(deploy): add Litestream config for continuous SQLite replication to R2"
```

---

## Task 3: restic uploads backup + README docs

**Files:**
- Create: `deploy/backup-uploads.sh`
- Create: `deploy/wanderwallet-backup.service`
- Create: `deploy/wanderwallet-backup.timer`
- Modify: `README.md`

**Interfaces:**
- Consumes: `RESTIC_REPOSITORY`, `RESTIC_PASSWORD`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` (from Task 1's `deploy/backup.env.example`, real values in `deploy/backup.env` at runtime).
- Produces: nothing consumed elsewhere - standalone timer-triggered backup.

- [ ] **Step 1: Create `deploy/backup-uploads.sh`**

```bash
#!/usr/bin/env bash
# Daily backup of the uploads/ directory (receipt images) to Cloudflare R2
# via restic. Triggered by wanderwallet-backup.timer -> wanderwallet-backup.service.
set -euo pipefail

cd /opt/wanderwallet

set -a
source deploy/backup.env
set +a

# First run: initialize the restic repository if it doesn't exist yet.
if ! restic snapshots >/dev/null 2>&1; then
  echo "restic repository not initialized, running restic init"
  restic init
fi

restic backup uploads/ --tag wanderwallet-uploads

# Keep 7 daily, 4 weekly, 6 monthly snapshots; prune anything older, so
# storage growth stays bounded without manual attention.
restic forget --keep-daily 7 --keep-weekly 4 --keep-monthly 6 --prune
```

- [ ] **Step 2: Make the script executable**

```bash
cd "/mnt/c/Users/matan/General Projects/Projects/wanderwallet" && chmod +x deploy/backup-uploads.sh
```

- [ ] **Step 3: Create `deploy/wanderwallet-backup.service`**

```
# /etc/systemd/system/wanderwallet-backup.service
# One-shot uploads backup, triggered by wanderwallet-backup.timer.
[Unit]
Description=Wanderwallet uploads backup (restic to R2)

[Service]
Type=oneshot
User=wanderwallet
WorkingDirectory=/opt/wanderwallet
ExecStart=/opt/wanderwallet/deploy/backup-uploads.sh
```

- [ ] **Step 4: Create `deploy/wanderwallet-backup.timer`**

```
# /etc/systemd/system/wanderwallet-backup.timer
[Unit]
Description=Run wanderwallet-backup.service daily

[Timer]
OnCalendar=daily
Persistent=true

[Install]
WantedBy=timers.target
```

- [ ] **Step 5: Add a Backups subsection to README.md**

Read the current `README.md`, find the `## Scripts` section (ends right before `## Roadmap`), and insert a new section between them:

Find:

```markdown
| `npm run typecheck` | `tsc --noEmit` |

## Roadmap
```

Replace with:

```markdown
| `npm run typecheck` | `tsc --noEmit` |

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

## Roadmap
```

- [ ] **Step 6: Verify no regressions**

```bash
cd "/mnt/c/Users/matan/General Projects/Projects/wanderwallet" && npm test 2>&1 | tail -10
```

Expected: all existing tests still pass.

- [ ] **Step 7: Commit**

```bash
cd "/mnt/c/Users/matan/General Projects/Projects/wanderwallet"
git add deploy/backup-uploads.sh deploy/wanderwallet-backup.service deploy/wanderwallet-backup.timer README.md
git commit -m "chore(deploy): add restic uploads backup timer, document backups in README"
```

---

## Self-Review

### Spec coverage

| Spec item | Task |
|-----------|------|
| `deploy/litestream.yml` | Task 2 |
| `deploy/litestream.service` | Task 2 |
| `deploy/backup-uploads.sh` | Task 3 |
| `deploy/wanderwallet-backup.service` | Task 3 |
| `deploy/wanderwallet-backup.timer` | Task 3 |
| `deploy/backup.env.example` | Task 1 |
| `.gitignore` update | Task 1 |
| README Backups subsection | Task 3 |
| Retention policy (7 daily / 4 weekly / 6 monthly) | Task 3, Step 1 |
| No signed image URLs | Correctly absent - dropped in design |
| No VPS/DNS/credential runbook | Correctly absent - separate deliverable after this plan |

### Placeholder scan

None - every file has complete, real content (no TBD/TODO, no "add appropriate X").

### Type consistency

- Env var names are consistent across all three tasks: `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` (Task 1 defines, Task 2 and Task 3 both consume via their respective `EnvironmentFile=` / `source` mechanisms), `R2_ACCOUNT_ID` / `R2_BUCKET` (Task 1 defines, Task 2 consumes in `litestream.yml`'s `${...}` substitution), `RESTIC_REPOSITORY` / `RESTIC_PASSWORD` (Task 1 defines, Task 3 consumes via `backup-uploads.sh`'s `source deploy/backup.env`).
- Both `litestream.service` and `wanderwallet-backup.service` use `User=wanderwallet` and reference `/opt/wanderwallet` as the base path, matching the existing `deploy/wanderwallet.service` from P0 (confirmed by reading that file before writing this plan) - no path/user mismatch introduced.
- `RESTIC_REPOSITORY`'s value in `backup.env.example` references `${R2_ACCOUNT_ID}` and `${R2_BUCKET}` as bash variable expansions - this only resolves correctly because `backup-uploads.sh` sources the file with `set -a; source deploy/backup.env; set +a` (Task 3, Step 1), which evaluates assignments top-to-bottom in the same shell, so `R2_ACCOUNT_ID`/`R2_BUCKET` are already set as shell variables by the time the `RESTIC_REPOSITORY` line is reached. This is called out in a comment in Task 1's file so a future reader doesn't "simplify" it into a plain string and break the substitution.
