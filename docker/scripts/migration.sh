#!/usr/bin/env bash
# Creates a migration from the edits made to a Prisma schema, applies it to a
# development database, and regenerates the Prisma clients.
#
#   control  prisma/control/schema.prisma, applied to the control-plane database
#   tenant   prisma/tenant/schema.prisma, applied to a scratch tenant database
#            (<POSTGRES_DB>_tenant_dev, created on first use). Real tenant
#            databases get the migration afterwards with `make db-migrate`.
#
# Usage:  NAME=<what_changed> migration.sh control|tenant
set -euo pipefail

# shellcheck source=docker/scripts/lib.sh
. "$(dirname "$0")/lib.sh"

target=${1:-}
name=${NAME:-}
case "$target" in
  control) make_target=db-migration ;;
  tenant) make_target=tenant-migration ;;
  *) die "unknown schema '$target' (expected 'control' or 'tenant')." ;;
esac
[ -n "$name" ] || die "no migration name given. Usage: make $make_target name=add_customer_notes"
[[ "$name" =~ ^[a-z0-9_]+$ ]] || die "the name may contain only lower-case letters, digits and underscores."

require_running app
require_running postgres

# Prisma asks before doing anything destructive, which needs a terminal.
# Without one it stops with an explanation instead of asking.
tty=()
[ -t 0 ] || tty=(-T)

target_env=()
if [ "$target" = "tenant" ]; then
  database="$(service_env postgres POSTGRES_DB)_tenant_dev"
  [ "${#database}" -le 63 ] || die "POSTGRES_DB is too long to derive a scratch database name from."
  "${compose[@]}" exec -T postgres sh -c '
    psql -X -U "$POSTGRES_USER" -d postgres -lqtA | cut -d"|" -f1 | grep -qxF "$1" \
      || { createdb -U "$POSTGRES_USER" "$1" && echo "Created scratch tenant database: $1"; }
  ' sh "$database"
  target_env=(-e "TENANT_DATABASE=$database")
fi

# ${array[@]+...} keeps bash 3.2 (macOS) from treating an empty array as unset.
"${compose[@]}" exec ${tty[@]+"${tty[@]}"} ${target_env[@]+"${target_env[@]}"} app \
  node_modules/.bin/prisma migrate dev --config "prisma/$target.config.ts" --name "$name"

"${compose[@]}" exec -T app npm run --silent db:generate

info "If a migration was created, review its SQL under prisma/$target/migrations/ before committing it."
info "The running dev server keeps its old Prisma client until restarted: make restart s=app"
