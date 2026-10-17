#!/usr/bin/env bash
# DESTRUCTIVE: stops the stack and permanently deletes its named volumes
# (PostgreSQL data, Redis data, AIStor objects, pgAdmin and Redis Insight
# settings, and in development the dependency/build caches).
#
# This is the only place in the project that deletes volumes. It is never run
# by another target and always requires an explicit, typed confirmation.
set -euo pipefail

# shellcheck source=docker/scripts/lib.sh
. "$(dirname "$0")/lib.sh"

project=$(project_name)
[ -n "$project" ] || die "could not determine the Compose project name."

phrase="destroy $project"
volumes=$("${docker[@]}" volume ls -q --filter "label=com.docker.compose.project=$project")

cat <<EOF

  !!  DANGER: PERMANENT DATA LOSS  !!

  This stops the '$project' stack and DELETES its volumes, including the
  PostgreSQL database, Redis data and every object stored in AIStor (all
  buckets, including backups kept there). This cannot be undone, and Docker
  volumes are not backups. Take one first if in doubt:  make backup
  and keep copies of anything stored in AIStor off this machine.

  Volumes that currently exist for this project:
EOF
if [ -n "$volumes" ]; then
  printf '%s\n' "$volumes" | sed 's/^/    - /'
else
  echo "    (none)"
fi
echo

if [ "${CONFIRM_DESTROY:-}" = "$phrase" ]; then
  info "Confirmed via CONFIRM_DESTROY."
elif [ -n "${CONFIRM_DESTROY:-}" ]; then
  die "CONFIRM_DESTROY does not match; nothing was deleted."
elif [ -t 0 ]; then
  printf 'Type "%s" to delete this data: ' "$phrase"
  read -r answer
  [ "$answer" = "$phrase" ] || die "confirmation did not match; nothing was deleted."
else
  die "not running interactively and no confirmation given; nothing was deleted."
fi

"${compose[@]}" --profile tools down --volumes
info "Stack removed and its volumes deleted."
