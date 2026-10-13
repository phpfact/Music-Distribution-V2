#!/usr/bin/env bash
# Writes a compressed logical backup (pg_dump custom format) of the application
# database to BACKUP_DIR (default: backups/) on the host.
#
# The dump is written to a temporary name, checked for readability with
# pg_restore --list, and only then moved into place, so a file ending in
# ".dump" is always a complete archive.
set -euo pipefail

# shellcheck source=docker/scripts/lib.sh
. "$(dirname "$0")/lib.sh"

require_running postgres

backup_dir=${BACKUP_DIR:-backups}
# Backups contain all application data: keep them private.
umask 077
mkdir -p "$backup_dir"

database=$(service_env postgres POSTGRES_DB)
[ -n "$database" ] || die "could not read POSTGRES_DB from the postgres container."

file="$backup_dir/${database}_$(date -u +%Y%m%dT%H%M%SZ).dump"
partial="$file.partial"
trap 'rm -f "$partial"' EXIT

info "Backing up database '$database'..."
"${compose[@]}" exec -T postgres \
  sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom' > "$partial"

[ -s "$partial" ] || die "pg_dump produced an empty file."

"${compose[@]}" exec -T postgres pg_restore --list < "$partial" > /dev/null \
  || die "the dump could not be read back by pg_restore; backup discarded."

mv "$partial" "$file"
trap - EXIT
restore_owner "$backup_dir"

info "Backup written: $file ($(du -h "$file" | cut -f1 | tr -d ' '))"
info "Restore it with: make restore FILE=$file"
info "Copy it off this machine: a backup on the same disk as the database is not a backup."
