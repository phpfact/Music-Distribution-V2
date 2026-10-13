#!/usr/bin/env bash
# Reports host ports that this stack wants but something else already holds.
#
# Usage: check-ports.sh VAR:default [VAR:default ...]
#   e.g. check-ports.sh APP_PORT:3000 REDIS_HOST_PORT:6380
# Each port is read from the env file (ENV_FILE) and falls back to the default,
# which must match the default in the Compose files.
set -euo pipefail

# shellcheck source=docker/scripts/lib.sh
. "$(dirname "$0")/lib.sh"

env_file=${ENV_FILE:-.env}

env_value() {
  [ -f "$env_file" ] || return 0
  sed -n "s/^[[:space:]]*$1[[:space:]]*=[[:space:]]*//p" "$env_file" | tail -n 1 | tr -d "\"'\r"
}

port_in_use() {
  (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null
}

# Containers that belong to this stack may legitimately hold the ports already.
own_containers=$("${compose[@]}" --profile tools ps -q 2>/dev/null || true)

conflicts=0
for spec in "$@"; do
  name=${spec%%:*}
  port=$(env_value "$name")
  port=${port:-${spec##*:}}

  case "$port" in
    '' | *[!0-9]*) die "$name must be a port number (got '$port')." ;;
  esac

  port_in_use "$port" || continue

  holder=$("${docker[@]}" ps --no-trunc -q --filter "publish=$port" 2>/dev/null | head -n 1)
  if [ -n "$holder" ] && printf '%s\n' "$own_containers" | grep -qx "$holder"; then
    continue
  fi

  conflicts=$((conflicts + 1))
  if [ -n "$holder" ]; then
    owner="container '$("${docker[@]}" inspect --format '{{.Name}}' "$holder" | sed 's#^/##')'"
  else
    # lsof exits non-zero when it finds nothing, and without root it only sees
    # this user's processes, so an empty result is normal here.
    owner=$(lsof -nP -iTCP:"$port" -sTCP:LISTEN 2>/dev/null | awk 'NR==2 {print $1 " (pid " $2 ")"}' || true)
    if [ -n "$owner" ]; then
      owner="process $owner"
    else
      owner="a process owned by another user (identify it with: sudo lsof -nP -iTCP:$port -sTCP:LISTEN)"
    fi
  fi
  echo "Port $port ($name) is already in use by $owner." >&2
  echo "  Fix: set $name=<free port> in $env_file, or stop whatever is using it." >&2
done

if [ "$conflicts" -gt 0 ]; then
  die "$conflicts port conflict(s) found; nothing was started."
fi
