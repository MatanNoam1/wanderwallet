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
