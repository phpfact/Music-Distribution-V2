#!/usr/bin/env bash
# Host side of the `make aistor-*` targets (README, "MinIO AIStor").
#
# Checks the configuration on the host, then runs docker/aistor/admin.sh in the
# one-off `aistor-admin` container (docker/compose.yaml) for everything that
# talks to AIStor. Secrets are never printed: problems name variables only.
#
# Usage: aistor.sh config-check | install | health | buckets | inspect | smoke
#                  | validate | usage | shell
#   inspect reads the bucket name from BUCKET (make aistor-bucket-inspect bucket=<name>).
set -euo pipefail

# shellcheck source=docker/scripts/lib.sh
. "$(dirname "$0")/lib.sh"

env_file=${ENV_FILE:-.env}

# Defaults, identical to the ones in docker/compose.yaml and .env.example.
readonly DEFAULT_LICENSE_FILE="../minio/minio.license"
readonly DEFAULT_PLATFORM_ACCESS_KEY="md-platform"
readonly DEFAULT_BACKUP_ACCESS_KEY="md-backup"
readonly AISTOR_IMAGE_NAME="quay.io/minio/aistor/minio"

# Description: Read a setting the way Compose does.
# Input: $1 = variable name, $2 = optional default.
# Output: The value from the caller's environment if set, otherwise from the
#   env file, otherwise the default. Never printed by callers.
# Use case: config-check.
# Author: Mr. Sachin Sharma
# Created: 2026-10-17
# Last modified: 2026-10-17
setting() {
  local name=$1 fallback=${2:-} value
  value=${!name:-}
  [ -n "$value" ] || value=$(env_file_value "$name")
  printf '%s' "${value:-$fallback}"
}

# Description: Turn AISTOR_LICENSE_FILE into a path usable from the project root.
# Input: The configured path (absolute, or relative to docker/ as Compose reads it).
# Output: The path as seen from the project root.
# Use case: config-check (license file checks).
# Author: Mr. Sachin Sharma
# Created: 2026-10-17
# Last modified: 2026-10-17
license_path() {
  local configured
  configured=$(setting AISTOR_LICENSE_FILE "$DEFAULT_LICENSE_FILE")
  case "$configured" in
    /*) printf '%s' "$configured" ;;
    *) printf 'docker/%s' "$configured" ;;
  esac
}

# Description: Print a file's permission bits.
# Input: $1 = file path.
# Output: Octal mode such as 600 (GNU stat first; BSD/macOS stat rejects -c).
# Use case: config-check (license file permissions).
# Author: Mr. Sachin Sharma
# Created: 2026-10-17
# Last modified: 2026-10-17
file_mode() {
  stat -c '%a' "$1" 2>/dev/null || stat -f '%Lp' "$1"
}

# Description: Run admin.sh in the one-off aistor-admin container.
# Input: The admin.sh command and its arguments.
# Output: Its output and exit status. --no-deps: it never starts AIStor itself.
# Use case: Every command that talks to AIStor.
# Author: Mr. Sachin Sharma
# Created: 2026-10-17
# Last modified: 2026-10-17
run_admin() {
  "${compose[@]}" --profile aistor-admin run --rm --no-deps -T aistor-admin "$@"
}

# Description: Validate the AIStor configuration without starting anything.
# Input: The env file, the caller's environment and the Compose files.
# Output: "AIStor configuration OK" plus any warnings, or every problem by
#   variable name and a non-zero exit. Values are never printed.
# Use case: make aistor-config-check; the first step of install.
# Author: Mr. Sachin Sharma
# Created: 2026-10-17
# Last modified: 2026-10-17
cmd_config_check() {
  local -a problems=() warnings=()
  local name value minimum root_user platform_key backup_key license mode images
  local production=no
  # Byte-wise character classes for the checks below (bash applies it at once).
  local LC_ALL=C
  [ "${MODE:-dev}" = "prod" ] && production=yes

  # 1. Root credentials and service secrets.
  for name in MINIO_ROOT_USER MINIO_ROOT_PASSWORD AISTOR_PLATFORM_SECRET_KEY AISTOR_BACKUP_SECRET_KEY; do
    value=$(setting "$name")
    if [ -z "$value" ]; then
      problems+=("$name is not set in $env_file (see .env.example and README, \"MinIO AIStor\")")
      continue
    fi
    # Printable ASCII without spaces (LC_ALL=C above makes [:graph:] ASCII-only):
    # safe in URLs once encoded, and in env files.
    if [[ $value == *[![:graph:]]* ]]; then
      problems+=("$name must contain printable ASCII characters only, without spaces")
    fi
    if [ "$value" = "minioadmin" ]; then
      problems+=("$name must not be the well-known default \"minioadmin\"")
    fi
    if [ "$production" = yes ] && [[ $value == change-me* ]]; then
      problems+=("$name still has its placeholder value; set a real secret for production")
    fi
    # MinIO's own minimums are 3 (user) and 8 (secrets); production needs 16
    # for every secret, as for the other secrets of this project.
    minimum=8
    [ "$name" = "MINIO_ROOT_USER" ] && minimum=3
    [ "$production" = yes ] && [ "$name" != "MINIO_ROOT_USER" ] && minimum=16
    if [ "${#value}" -lt "$minimum" ]; then
      problems+=("$name must be at least $minimum characters")
    fi
  done

  # 2. Service identity names: valid, and all different from each other and root.
  root_user=$(setting MINIO_ROOT_USER)
  platform_key=$(setting AISTOR_PLATFORM_ACCESS_KEY "$DEFAULT_PLATFORM_ACCESS_KEY")
  backup_key=$(setting AISTOR_BACKUP_ACCESS_KEY "$DEFAULT_BACKUP_ACCESS_KEY")
  for name in AISTOR_PLATFORM_ACCESS_KEY AISTOR_BACKUP_ACCESS_KEY; do
    value=$platform_key
    [ "$name" = "AISTOR_BACKUP_ACCESS_KEY" ] && value=$backup_key
    if ! [[ $value =~ ^[A-Za-z0-9._-]{3,64}$ ]]; then
      problems+=("$name must be 3 to 64 characters: letters, digits, dot, underscore, hyphen")
    fi
  done
  if [ "$platform_key" = "$backup_key" ] || [ "$platform_key" = "$root_user" ] || [ "$backup_key" = "$root_user" ]; then
    problems+=("MINIO_ROOT_USER, AISTOR_PLATFORM_ACCESS_KEY and AISTOR_BACKUP_ACCESS_KEY must all be different")
  fi

  # 3. License file: present, non-empty, readable. Its contents are never read here.
  license=$(license_path)
  if [ ! -f "$license" ]; then
    problems+=("license file not found at '$license' (AISTOR_LICENSE_FILE). Get one at https://www.min.io/pricing; see README, \"MinIO AIStor\"")
  elif [ ! -s "$license" ]; then
    problems+=("license file '$license' is empty (AISTOR_LICENSE_FILE)")
  elif [ ! -r "$license" ]; then
    problems+=("license file '$license' is not readable by $(id -un) (AISTOR_LICENSE_FILE)")
  else
    mode=$(file_mode "$license")
    # Development: only you should read it. Production (Linux) needs it readable
    # by the container's root, so README allows root ownership or mode 644 there.
    if [ "$production" = no ] && [ "${mode: -2}" != "00" ]; then
      warnings+=("license file '$license' has mode $mode; 600 is recommended (chmod 600 '$license')")
    fi
  fi

  # Stop here: Compose cannot render its configuration without these values.
  if [ "${#problems[@]}" -eq 0 ]; then
    # 4. Compose configuration valid, and the AIStor image pinned by digest.
    if ! images=$("${compose[@]}" config --images 2>/dev/null); then
      problems+=("the Compose configuration is invalid; run make validate for details")
    else
      while IFS= read -r value; do
        case "$value" in
          "$AISTOR_IMAGE_NAME"*@sha256:*) ;;
          "$AISTOR_IMAGE_NAME"*) problems+=("the AIStor image '$value' is not pinned by digest (docker/compose.yaml)") ;;
        esac
      done <<< "$images"
    fi
  fi

  for value in "${warnings[@]+"${warnings[@]}"}"; do warn "$value"; done
  if [ "${#problems[@]}" -gt 0 ]; then
    for value in "${problems[@]}"; do printf 'problem: %s\n' "$value" >&2; done
    die "${#problems[@]} AIStor configuration problem(s); nothing was started."
  fi
  info "AIStor configuration OK (MODE=${MODE:-dev})."
}

# Description: Print where the AIStor Console and S3 API are published.
# Input: The running aistor container.
# Output: Lines like "AIStor Console  http://127.0.0.1:9001".
# Use case: install (the Makefile's `urls` target prints the same lines).
# Author: Mr. Sachin Sharma
# Created: 2026-10-17
# Last modified: 2026-10-17
print_urls() {
  local address
  address=$("${compose[@]}" port aistor 9001 2>/dev/null || true)
  [ -z "$address" ] || printf '  %-15s http://%s\n' "AIStor Console" "$address"
  address=$("${compose[@]}" port aistor 9000 2>/dev/null || true)
  [ -z "$address" ] || printf '  %-15s http://%s\n' "AIStor S3 API" "$address"
}

# Description: First-time setup, safe to repeat.
# Input: The env file and the license file.
# Output: AIStor running and healthy; platform/backup buckets, policies and
#   identities in place and validated; the Console URL printed.
# Use case: make aistor-install.
# Author: Mr. Sachin Sharma
# Created: 2026-10-17
# Last modified: 2026-10-17
cmd_install() {
  cmd_config_check
  info "Starting AIStor and waiting until it is healthy..."
  "${compose[@]}" up -d --wait --wait-timeout 300 aistor \
    || die "AIStor did not become healthy. Inspect it with: make logs s=aistor"
  info ""
  run_admin install
  info ""
  info "AIStor is ready. Console login: MINIO_ROOT_USER / MINIO_ROOT_PASSWORD from $env_file."
  print_urls
}

# Description: Container state plus AIStor's own health report.
# Input: The running stack.
# Output: State and health of the aistor container, then probes, license and
#   drives (admin.sh health); non-zero when anything is unhealthy.
# Use case: make aistor-health.
# Author: Mr. Sachin Sharma
# Created: 2026-10-17
# Last modified: 2026-10-17
cmd_health() {
  local id state health
  id=$("${compose[@]}" ps -a -q aistor 2>/dev/null | head -n 1)
  [ -n "$id" ] || die "the aistor container does not exist. Start it with: make up (first time: make aistor-install)"
  state=$("${docker[@]}" inspect --format '{{.State.Status}}' "$id")
  health=$("${docker[@]}" inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}-{{end}}' "$id")
  printf 'Container: %s, %s\n' "$state" "$health"
  [ "$state" = "running" ] || die "aistor is not running. See: make logs s=aistor"
  run_admin health
}

# Description: Storage usage plus the container's resource use.
# Input: The running stack.
# Output: admin.sh usage (drives, buckets) and `docker stats` for aistor.
# Use case: make aistor-usage.
# Author: Mr. Sachin Sharma
# Created: 2026-10-17
# Last modified: 2026-10-17
cmd_usage() {
  local id
  require_running aistor
  run_admin usage
  id=$("${compose[@]}" ps -q aistor | head -n 1)
  info ""
  info "Container resources (now):"
  printf '  %s\n' "$("${docker[@]}" stats --no-stream --format 'CPU {{.CPUPerc}}  memory {{.MemUsage}} ({{.MemPerc}})  disk I/O {{.BlockIO}}' "$id")"
  printf '  restarts %s\n' "$("${docker[@]}" inspect --format '{{.RestartCount}}' "$id")"
}

# Description: Interactive admin shell with mc.
# Input: A terminal.
# Output: An interactive session in the one-off admin container.
# Use case: make aistor-mc.
# Author: Mr. Sachin Sharma
# Created: 2026-10-17
# Last modified: 2026-10-17
cmd_shell() {
  [ -t 0 ] || die "make aistor-mc needs an interactive terminal."
  require_running aistor
  "${compose[@]}" --profile aistor-admin run --rm --no-deps aistor-admin shell
}

case "${1:-}" in
  config-check) cmd_config_check ;;
  install) cmd_install ;;
  health) cmd_health ;;
  usage) cmd_usage ;;
  shell) cmd_shell ;;
  buckets | smoke | validate)
    require_running aistor
    run_admin "$1"
    ;;
  inspect)
    [ -n "${BUCKET:-}" ] || die "no bucket given. Usage: make aistor-bucket-inspect bucket=<name>"
    require_running aistor
    run_admin inspect "$BUCKET"
    ;;
  *) die "unknown action '${1:-}' (expected config-check, install, health, buckets, inspect, smoke, validate, usage or shell)." ;;
esac
