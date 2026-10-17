#!/usr/bin/env bash
# Runs prisma/seed.ts with the initial platform owner credentials.
#
#   create  creates the first platform owner if none exists (make db-seed)
#   rotate  sets the existing owner's password and revokes its sessions
#           (make db-rotate-owner-password)
#
# The two credentials are read from the env file and handed to the seed process
# only. They are not part of any service's environment, so the running
# application never holds the initial password. Values exported in the caller's
# environment take precedence over the env file.
#
# Usage:  seed.sh create|rotate
set -euo pipefail

# shellcheck source=docker/scripts/lib.sh
. "$(dirname "$0")/lib.sh"

case "${1:-}" in
  create) script=db:seed ;;
  rotate) script=db:seed:rotate-password ;;
  *) die "unknown action '${1:-}' (expected 'create' or 'rotate')." ;;
esac

env_file=${ENV_FILE:-.env}
[ -f "$env_file" ] || die "'$env_file' not found. Create it with: make init"

# env_file_value (lib.sh) reads one key from the env file without sourcing it.
for name in PLATFORM_OWNER_INITIAL_USERNAME PLATFORM_OWNER_INITIAL_PASSWORD; do
  value=${!name:-}
  [ -n "$value" ] || value=$(env_file_value "$name")
  [ -n "$value" ] || die "$name is not set in '$env_file' (see .env.example)."
  export "$name=$value"
done
unset value

# Passed by name (-e NAME), so the values never appear on a command line.
pass_env=(-e PLATFORM_OWNER_INITIAL_USERNAME -e PLATFORM_OWNER_INITIAL_PASSWORD)

if [ "${MODE:-dev}" = "prod" ]; then
  image="${APP_IMAGE:-mdnext-app}:${APP_TAG:-local}-migrate"
  "${docker[@]}" image inspect "$image" >/dev/null 2>&1 \
    || die "image '$image' not found locally. Build it (make prod-build) or pull it first."
  # `compose run` has no --no-build flag (Compose v2.40); it builds only when
  # the image is missing, which the check above has just ruled out.
  "${compose[@]}" --profile migrate run --rm "${pass_env[@]}" migrate \
    npm run --silent "$script"
else
  require_running app
  require_running postgres
  "${compose[@]}" exec -T "${pass_env[@]}" app npm run --silent "$script"
fi
