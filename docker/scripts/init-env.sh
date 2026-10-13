#!/usr/bin/env bash
# Creates the env file from .env.example, replacing every "change-me..."
# placeholder with a freshly generated random secret.
# Never overwrites an existing file.
set -euo pipefail

template=${1:-.env.example}
target=${2:-.env}

[ -f "$template" ] || { echo "error: template '$template' not found." >&2; exit 1; }

if [ -e "$target" ]; then
  echo "'$target' already exists; leaving it untouched."
  exit 0
fi

generate_secret() {
  # 48 hex characters (192 bits). Hex only, so it is safe in any config format.
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex 24
  else
    LC_ALL=C od -An -N24 -tx1 /dev/urandom | tr -d ' \n'
  fi
}

umask 077
tmp=$(mktemp "${target}.XXXXXX")
trap 'rm -f "$tmp"' EXIT

count=0
while IFS= read -r line || [ -n "$line" ]; do
  case "$line" in
    [A-Za-z_]*=change-me*)
      printf '%s=%s\n' "${line%%=*}" "$(generate_secret)"
      count=$((count + 1))
      ;;
    *)
      printf '%s\n' "$line"
      ;;
  esac
done < "$template" > "$tmp"

mv "$tmp" "$target"
trap - EXIT

# When run through sudo, give the file back to the user who invoked it, so a
# later run without sudo can still read it.
if [ "$(id -u)" = "0" ] && [ -n "${SUDO_UID:-}" ]; then
  chown "$SUDO_UID:${SUDO_GID:-$SUDO_UID}" "$target"
fi

echo "Created '$target' (mode 600) with $count generated secrets."
echo "Review it before first start: these credentials are baked into the data"
echo "volumes when the services initialize (see README, \"Credentials\")."
