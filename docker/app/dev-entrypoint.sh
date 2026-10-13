#!/bin/sh
# Development entrypoint: keeps the node_modules volume in sync with the
# bind-mounted package.json / package-lock.json, then runs the given command.
set -eu

cd /app

if [ ! -f package.json ]; then
  echo "[dev] /app/package.json not found. Is the project bind-mounted at /app?" >&2
  exit 1
fi

manifest_hash() {
  if [ -f package-lock.json ]; then
    cat package.json package-lock.json | sha256sum | cut -d' ' -f1
  else
    sha256sum package.json | cut -d' ' -f1
  fi
}

stamp=node_modules/.manifest-hash

if [ ! -f "$stamp" ] || [ "$(cat "$stamp")" != "$(manifest_hash)" ]; then
  if [ -f package-lock.json ]; then
    echo "[dev] Dependencies changed; running npm ci..."
    npm ci --no-audit --no-fund
  else
    echo "[dev] No package-lock.json; running npm install to create one..."
    npm install --no-audit --no-fund
  fi
  # Hash again afterwards: npm install may have just written the lockfile.
  manifest_hash > "$stamp"
  echo "[dev] Dependencies are up to date."
fi

exec "$@"
