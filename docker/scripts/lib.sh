#!/usr/bin/env bash
# Shared helpers for the scripts in this directory. Sourced, not executed.
# The Makefile exports COMPOSE (the full `docker compose ...` command for the
# selected mode) and DOCKER; the scripts are meant to be run through `make`.

if [ -z "${COMPOSE:-}" ]; then
  echo "error: COMPOSE is not set. Run this through the Makefile (see 'make help')." >&2
  exit 1
fi

# Split the command strings into arrays so each word is passed as one argument.
read -r -a compose <<< "$COMPOSE"
read -r -a docker <<< "${DOCKER:-docker}"

# When run through sudo, give files created on the host back to the user who
# invoked it, so a later run without sudo can still read them.
restore_owner() {
  if [ "$(id -u)" = "0" ] && [ -n "${SUDO_UID:-}" ]; then
    chown -R "$SUDO_UID:${SUDO_GID:-$SUDO_UID}" "$@"
  fi
}

info() { printf '%s\n' "$*"; }
warn() { printf 'warning: %s\n' "$*" >&2; }
die() { printf 'error: %s\n' "$*" >&2; exit 1; }

# Reads an environment variable from inside a running service container, so
# scripts use the values the service was actually started with.
service_env() {
  local service=$1 name=$2
  "${compose[@]}" exec -T "$service" printenv "$name" | tr -d '\r'
}

require_running() {
  local service=$1
  if [ -z "$("${compose[@]}" ps -q --status running "$service" 2>/dev/null)" ]; then
    die "service '$service' is not running. Start the stack first (make up / make prod-up)."
  fi
}

project_name() {
  "${compose[@]}" config 2>/dev/null | sed -n 's/^name: //p' | head -n 1
}

# Prints the value of one key from the env file (ENV_FILE, default .env). The
# file is read line by line, never sourced: nothing in it is executed, and no
# other key is looked at. Surrounding quotes are optional; the last definition
# wins, as in Compose.
env_file_value() {
  local key=$1 file=${ENV_FILE:-.env} line value=""
  [ -f "$file" ] || return 0
  while IFS= read -r line || [ -n "$line" ]; do
    line=${line%$'\r'}
    case "$line" in
      "$key="*) value=${line#*=} ;;
    esac
  done < "$file"
  case "$value" in
    \"*\") value=${value#\"}; value=${value%\"} ;;
    \'*\') value=${value#\'}; value=${value%\'} ;;
  esac
  printf '%s' "$value"
}
