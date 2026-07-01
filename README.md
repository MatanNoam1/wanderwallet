# Wanderwallet

Shared travel expense tracker for two people. Snap a receipt or send a Telegram
message and an LLM extracts the structured data into a shared dashboard with
budget tracking, category breakdown, and per-currency totals. Self-hosted on a
single VPS.

> Status: building. P0 (scaffold, schema, auth) complete. P1 (manual entry +
> dashboard) in progress. See the roadmap below.

## Why

Manual trip expense tracking is tedious, especially when two people split costs.
Wanderwallet has four capture channels feeding one shared ledger:

- App camera (snap a receipt)
- App manual entry
- Telegram photo
- Telegram text ("lunch 240 thb")

Receipts and messages are parsed by Gemini (vision + text), normalized to a
single trip ledger, and shown on a dark dashboard.

## Stack

- **Next.js 16** (App Router, TypeScript)
- **Prisma 7** + **SQLite** (`better-sqlite3` adapter, WAL mode)
- **Auth.js v5** (Google OAuth, database sessions)
- **Gemini** for receipt/text parsing
- **Telegram Bot API** via webhook
- Money stored as **integer minor units** (JPY=0 decimals, USD/EUR=2)

No Redis. Background work runs through a SQLite job table + in-process worker,
realtime via SSE. Deploys as a single Next process behind Caddy, DB backed up
with Litestream.

## Getting started

```bash
npm install
cp .env.example .env        # fill in AUTH_SECRET (npx auth secret) + Google creds
npx prisma migrate dev      # apply schema
npm run dev                 # http://localhost:3000
```

`AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` come from the Google Cloud Console
(redirect URI `http://localhost:3000/api/auth/callback/google` for dev).

## Scripts

| Command | What |
|---------|------|
| `npm run dev` | Dev server |
| `npm run build` | Production build |
| `npm run start` | Run production build |
| `npm run lint` | ESLint |
| `npm run typecheck` | `tsc --noEmit` |

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

## Roadmap

- **P0** — scaffold, Prisma schema + migration, Auth.js Google login, WAL mode ✅
- **P1** — money/FX helpers, manual expense entry, dashboard read
- **P2** — job table + worker + SSE, Telegram webhook + text parse
- **P3** — app camera + Telegram photo + vision parse + line items
- **P4** — budget/breakdown, payment methods, CSV + PDF export
- **P5** — signed image route, Litestream + restic backups, server hardening

## Contributing

Work happens on feature branches merged via pull request. CI (lint, typecheck,
build) must pass before merge. See `.github/pull_request_template.md`.

## License

MIT - see [LICENSE](LICENSE).
