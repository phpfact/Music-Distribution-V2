#!/usr/bin/env bash
# Restores a pg_dump custom-format backup into the application database.
#
# Nothing is overwritten in place. The backup is restored into a NEW database
# first; only if that succeeds completely are the names swapped:
#
#   <db>                    -> <db>_before_restore_<timestamp>   (kept)
#   <db>_restore_<timestamp> -> <db>
#
# If the restore fails, the live database is never touched. After a successful
# swap the previous database still exists under its new name until you drop it.
#
# Usage:  FILE=backups/<name>.dump pg-restore.sh
# Confirmation: type the database name when asked, or pass CONFIRM=<db name>
# for non-interactive use.
set -euo pipefail

# shellcheck source=docker/scripts/lib.sh
. "$(dirname "$0")/lib.sh"

file=${FILE:-}
[ -n "$file" ] || die "no backup given. Usage: make restore FILE=backups/<name>.dump"
[ -f "$file" ] || die "backup file '$file' does not exist."
[ -s "$file" ] || die "backup file '$file' is empty."

require_running postgres

database=$(service_env postgres POSTGRES_DB)
user=$(service_env postgres POSTGRES_USER)
[ -n "$database" ] && [ -n "$user" ] || die "could not read POSTGRES_DB / POSTGRES_USER from the postgres container."

stamp=$(date -u +%Y%m%d%H%M%S)
staging="${database}_restore_${stamp}"
previous="${database}_before_restore_${stamp}"
[ "${#previous}" -le 63 ] || die "database name '$database' is too long to derive a restore name from."

# Runs SQL against the maintenance database as the superuser. SQL on stdin.
admin_sql() {
  "${compose[@]}" exec -T postgres psql -v ON_ERROR_STOP=1 -q -X -U "$user" -d postgres "$@"
}

info "Checking that '$file' is a readable backup..."
"${compose[@]}" exec -T postgres pg_restore --list < "$file" > /dev/null \
  || die "'$file' is not a valid pg_dump custom-format archive."

cat <<EOF

  You are about to REPLACE the contents of a database.

    Compose project : $(project_name)
    Database        : $database
    Restore from    : $file

  The current database is not deleted: it will be renamed to
    $previous
  and stays there until you drop it. Open connections to '$database'
  (including the application's) are closed during the switch.

EOF

if [ "${CONFIRM:-}" = "$database" ]; then
  info "Confirmed via CONFIRM."
elif [ -n "${CONFIRM:-}" ]; then
  die "CONFIRM does not match the database name '$database'; nothing was changed."
elif [ -t 0 ]; then
  printf "Type the database name (%s) to continue: " "$database"
  read -r answer
  [ "$answer" = "$database" ] || die "confirmation did not match; nothing was changed."
else
  die "not running interactively. Re-run with CONFIRM=$database to confirm; nothing was changed."
fi

info "Restoring into staging database '$staging'..."
admin_sql -c "CREATE DATABASE \"$staging\" OWNER \"$user\" TEMPLATE template0"

if ! "${compose[@]}" exec -T postgres \
  pg_restore -U "$user" -d "$staging" --no-owner --no-privileges --single-transaction --exit-on-error < "$file"; then
  warn "restore failed; removing the staging database. The live database was not touched."
  admin_sql -c "DROP DATABASE IF EXISTS \"$staging\"" || true
  exit 1
fi

info "Restore succeeded. Switching '$database' to the restored copy..."
# New connections are refused before existing ones are closed, so the
# application cannot reconnect in the middle of the rename.
if ! admin_sql > /dev/null <<SQL; then
ALTER DATABASE "$database" WITH ALLOW_CONNECTIONS false;
SELECT pg_terminate_backend(pid) FROM pg_stat_activity
  WHERE datname IN ('$database', '$staging') AND pid <> pg_backend_pid();
ALTER DATABASE "$database" RENAME TO "$previous";
ALTER DATABASE "$staging" RENAME TO "$database";
ALTER DATABASE "$previous" WITH ALLOW_CONNECTIONS true;
SQL
  warn "the switch did not complete. Re-enabling connections..."
  admin_sql -c "ALTER DATABASE \"$database\" WITH ALLOW_CONNECTIONS true" 2>/dev/null || true
  admin_sql -c "ALTER DATABASE \"$previous\" WITH ALLOW_CONNECTIONS true" 2>/dev/null || true
  admin_sql -c "SELECT datname, datallowconn FROM pg_database WHERE datname LIKE '${database}%' ORDER BY 1" || true
  die "inspect the databases listed above. The restored data is in '$staging' or '$database'; the original is in '$database' or '$previous'."
fi

cat <<EOF

Done. '$database' now contains the restored data.

The previous database was kept as:
  $previous

Once you have checked the result, remove it with:
  make psql
  DROP DATABASE "$previous";

To undo the restore instead, see README ("Undoing a restore").
EOF
