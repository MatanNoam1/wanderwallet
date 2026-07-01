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
