#!/usr/bin/env bash
# MinIO AIStor administration. Runs INSIDE the one-off `aistor-admin` container
# (docker/compose.yaml), started by docker/scripts/aistor.sh, which the
# Makefile calls. Never run it on the host.
#
# Usage: admin.sh install | health | buckets | inspect <bucket> | smoke
#                 | validate | usage | shell
#
# Credentials arrive as environment variables (docker/compose.yaml). They are
# URL-encoded into MC_HOST_<alias> variables, which `mc` reads, so they never
# appear on the host's command line, in output or in logs.
#
# The image provides bash, mc, curl, sha256sum, head and mktemp, but no grep,
# sed or awk: all parsing below uses bash pattern matching.
set -euo pipefail

# --- Fixed names (TRD §9.1) --------------------------------------------------
# Changing one later strands the existing bucket, policy or identity.
readonly PLATFORM_BUCKET="md-platform"      # Platform Owner bucket
readonly BACKUP_BUCKET="md-backups"         # database backup storage
readonly PLATFORM_POLICY="md-platform-rw"   # read/write/delete on PLATFORM_BUCKET
readonly BACKUP_POLICY="md-backup-rw"       # read/write (no delete) on BACKUP_BUCKET
readonly OWNER_TAG_KEY="md-owner"           # bucket ownership marker (TRD §4.4)
readonly SMOKE_PREFIX="smoke"               # probe objects of smoke tests

# Number of failed checks in `validate` / `smoke`.
failures=0

# Probe objects ("<bucket>/<key>") and probe buckets created by this run, and
# local temporary files; all removed by cleanup on exit.
smoke_objects=()
probe_buckets=()
temp_files=()

# Object path ("<bucket>/<key>") of the most recent round_trip probe.
last_probe=""

# --- Output helpers ----------------------------------------------------------

info() { printf '%s\n' "$*"; }
warn() { printf 'warning: %s\n' "$*" >&2; }
die() { printf 'error: %s\n' "$*" >&2; exit 1; }

# Description: Record one check result and print it.
# Input: $1 = "ok" or "fail", $2 = what was checked.
# Output: One line "  ok    ..." or "  FAIL  ..."; increments `failures` on fail.
# Use case: validate and smoke checks.
# Author: Mr. Sachin Sharma
# Created: 2026-10-17
# Last modified: 2026-10-17
check() {
  if [ "$1" = "ok" ]; then
    printf '  ok    %s\n' "$2"
  else
    printf '  FAIL  %s\n' "$2"
    failures=$((failures + 1))
  fi
}

# Description: Run a test command and record whether it succeeded.
# Input: $1 = what is checked, then the command (e.g. [ "$a" = "$b" ]).
# Output: One check line; a failing command counts as a failed check.
# Use case: validate (positive checks).
# Author: Mr. Sachin Sharma
# Created: 2026-10-17
# Last modified: 2026-10-17
check_that() {
  local description=$1
  shift
  if "$@"; then
    check ok "$description"
  else
    check fail "$description"
  fi
}

# --- Credentials -------------------------------------------------------------

# Description: Percent-encode a string for use inside a URL.
# Input: $1 = the string (printable ASCII; checked by aistor-config-check).
# Output: The encoded string on stdout; unreserved characters stay as they are.
# Use case: Building MC_HOST_<alias> URLs from credentials with any characters.
# Author: Mr. Sachin Sharma
# Created: 2026-10-17
# Last modified: 2026-10-17
url_encode() {
  local text=$1 encoded="" char index
  for (( index = 0; index < ${#text}; index++ )); do
    char=${text:index:1}
    case "$char" in
      [A-Za-z0-9._~-]) encoded+=$char ;;
      # "'x" makes printf print the character's code.
      *) printf -v char '%%%02X' "'$char"; encoded+=$char ;;
    esac
  done
  printf '%s' "$encoded"
}

# Description: Define an mc alias through the environment, not the config file.
# Input: $1 = alias name, $2 = access key, $3 = secret key.
# Output: Exports MC_HOST_<alias>=<scheme>://<key>:<secret>@<host:port>.
# Use case: Root, platform and backup aliases used by every command.
# Author: Mr. Sachin Sharma
# Created: 2026-10-17
# Last modified: 2026-10-17
set_alias() {
  local alias=$1 access_key=$2 secret_key=$3
  local scheme=${AISTOR_ENDPOINT%%://*}
  local host_port=${AISTOR_ENDPOINT#*://}
  export "MC_HOST_${alias}=${scheme}://$(url_encode "$access_key"):$(url_encode "$secret_key")@${host_port}"
}

# Description: Check the required environment variables and define the aliases.
# Input: The container environment (docker/compose.yaml, aistor-admin).
# Output: Aliases `aistor` (root), `platform` and `backup`; exits naming any
#   missing variable (never a value).
# Use case: Every command, before talking to AIStor.
# Author: Mr. Sachin Sharma
# Created: 2026-10-17
# Last modified: 2026-10-17
load_credentials() {
  local name
  for name in AISTOR_ENDPOINT MINIO_ROOT_USER MINIO_ROOT_PASSWORD \
              AISTOR_PLATFORM_ACCESS_KEY AISTOR_PLATFORM_SECRET_KEY \
              AISTOR_BACKUP_ACCESS_KEY AISTOR_BACKUP_SECRET_KEY; do
    [ -n "${!name:-}" ] || die "$name is not set (see .env.example)."
  done
  set_alias aistor "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD"
  set_alias platform "$AISTOR_PLATFORM_ACCESS_KEY" "$AISTOR_PLATFORM_SECRET_KEY"
  set_alias backup "$AISTOR_BACKUP_ACCESS_KEY" "$AISTOR_BACKUP_SECRET_KEY"
}

# --- Bucket helpers ----------------------------------------------------------

# Description: Tell whether a bucket exists.
# Input: $1 = bucket name.
# Output: Exit status 0 when it exists.
# Use case: ensure_bucket, inspect, validate.
# Author: Mr. Sachin Sharma
# Created: 2026-10-17
# Last modified: 2026-10-17
bucket_exists() {
  mc stat --json "aistor/$1" >/dev/null 2>&1
}

# Description: Read a bucket's ownership tag.
# Input: $1 = bucket name.
# Output: The value of the md-owner tag, or nothing when the bucket has none.
# Use case: Telling our buckets from foreign ones (never adopt a foreign bucket).
# Author: Mr. Sachin Sharma
# Created: 2026-10-17
# Last modified: 2026-10-17
bucket_owner() {
  local output pattern="\"${OWNER_TAG_KEY}\":\"([^\"]*)\""
  # `mc tag list` exits non-zero when the bucket has no tags at all.
  output=$(mc tag list --json "aistor/$1" 2>/dev/null || true)
  if [[ $output =~ $pattern ]]; then
    printf '%s' "${BASH_REMATCH[1]}"
  fi
}

# Description: Tell whether a bucket holds no objects (any version).
# Input: $1 = bucket name.
# Output: Exit status 0 when empty.
# Use case: Finishing a system bucket left untagged by an interrupted install.
# Author: Mr. Sachin Sharma
# Created: 2026-10-17
# Last modified: 2026-10-17
bucket_is_empty() {
  local first
  # head closes the pipe after one line; the resulting SIGPIPE is expected.
  first=$(mc ls --recursive --versions "aistor/$1" 2>/dev/null | head -n 1 || true)
  [ -z "$first" ]
}

# Description: Read a bucket's anonymous (public) access setting.
# Input: $1 = bucket name.
# Output: "private", "download", "upload", "public", "custom" or "unknown".
# Use case: buckets table, inspect, validate.
# Author: Mr. Sachin Sharma
# Created: 2026-10-17
# Last modified: 2026-10-17
bucket_anonymous() {
  local output pattern='"permission":"([^"]*)"'
  output=$(mc anonymous get --json "aistor/$1" 2>/dev/null || true)
  if [[ $output =~ $pattern ]]; then
    printf '%s' "${BASH_REMATCH[1]}"
  else
    printf 'unknown'
  fi
}

# Description: Format a byte count for people.
# Input: $1 = number of bytes.
# Output: e.g. "0 B", "512 KiB", "3 GiB" (whole units, rounded down).
# Use case: buckets table and inspect.
# Author: Mr. Sachin Sharma
# Created: 2026-10-17
# Last modified: 2026-10-17
human_size() {
  local bytes=$1 unit=0
  local units=(B KiB MiB GiB TiB PiB)
  while [ "$bytes" -ge 1024 ] && [ "$unit" -lt 5 ]; do
    bytes=$((bytes / 1024))
    unit=$((unit + 1))
  done
  printf '%s %s' "$bytes" "${units[$unit]}"
}

# Description: Summarize a bucket's usage.
# Input: $1 = bucket name.
# Output: "<size>, <n> objects", or "unknown" when AIStor does not answer.
# Use case: buckets table and inspect.
# Author: Mr. Sachin Sharma
# Created: 2026-10-17
# Last modified: 2026-10-17
bucket_usage() {
  local output size_pattern='"size":([0-9]+)' objects_pattern='"objects":([0-9]+)' size objects
  output=$(mc du --json "aistor/$1" 2>/dev/null || true)
  if [[ $output =~ $size_pattern ]]; then size=${BASH_REMATCH[1]}; else printf 'unknown'; return; fi
  if [[ $output =~ $objects_pattern ]]; then objects=${BASH_REMATCH[1]}; else objects="?"; fi
  printf '%s, %s objects' "$(human_size "$size")" "$objects"
}

# Description: Create a system bucket, or confirm an existing one is ours.
# Input: $1 = bucket name, $2 = expected ownership tag value.
# Output: The bucket exists, carries the ownership tag and has no anonymous
#   access. A bucket tagged for another owner, or untagged but holding objects,
#   is a conflict: it is left untouched and the script exits.
# Use case: install.
# Author: Mr. Sachin Sharma
# Created: 2026-10-17
# Last modified: 2026-10-17
ensure_bucket() {
  local bucket=$1 owner=$2 current created=no
  if ! bucket_exists "$bucket"; then
    mc mb --quiet "aistor/$bucket" >/dev/null
    created=yes
    info "  created bucket $bucket"
  fi

  current=$(bucket_owner "$bucket")
  if [ "$current" = "$owner" ]; then
    [ "$created" = yes ] || info "  bucket $bucket already set up"
  elif [ -z "$current" ] && bucket_is_empty "$bucket"; then
    # New, or left untagged by an interrupted install: empty, so nothing of
    # anyone else's can be adopted.
    [ "$created" = yes ] || warn "bucket $bucket existed empty and untagged; finishing its setup."
    mc tag set "aistor/$bucket" "${OWNER_TAG_KEY}=${owner}" >/dev/null
  else
    die "bucket '$bucket' exists but is not ours (owner tag: '${current:-none, and it holds objects}'). Nothing was changed. Inspect it with: make aistor-bucket-inspect bucket=$bucket"
  fi

  # No anonymous (public) access, ever (TRD §9.3).
  mc anonymous set private "aistor/$bucket" >/dev/null
}

# --- Identity helpers --------------------------------------------------------

# Description: Write a least-privilege policy for one bucket.
# Input: $1 = bucket name, $2 = "yes" to allow deleting objects, $3 = file path.
# Output: The policy JSON in the file: list the bucket; read and write objects
#   (and delete them only when allowed); manage multipart uploads.
# Use case: ensure_policy.
# Author: Mr. Sachin Sharma
# Created: 2026-10-17
# Last modified: 2026-10-17
write_policy() {
  local bucket=$1 allow_delete=$2 file=$3
  local object_actions='"s3:GetObject", "s3:PutObject", "s3:AbortMultipartUpload", "s3:ListMultipartUploadParts"'
  [ "$allow_delete" = yes ] && object_actions+=', "s3:DeleteObject"'
  cat > "$file" <<JSON
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["s3:GetBucketLocation", "s3:ListBucket", "s3:ListBucketMultipartUploads"],
      "Resource": ["arn:aws:s3:::${bucket}"]
    },
    {
      "Effect": "Allow",
      "Action": [${object_actions}],
      "Resource": ["arn:aws:s3:::${bucket}/*"]
    }
  ]
}
JSON
}

# Description: Create or update a policy (`mc admin policy create` replaces an
#   existing policy of the same name, so this converges on every run).
# Input: $1 = policy name, $2 = bucket name, $3 = "yes" to allow deletes.
# Output: The policy exists with exactly the generated statements.
# Use case: install.
# Author: Mr. Sachin Sharma
# Created: 2026-10-17
# Last modified: 2026-10-17
ensure_policy() {
  local name=$1 bucket=$2 allow_delete=$3 file
  file=$(mktemp)
  write_policy "$bucket" "$allow_delete" "$file"
  mc admin policy create aistor "$name" "$file" >/dev/null
  rm -f "$file"
  info "  policy $name: limited to bucket $bucket"
}

# Description: Read which policies are attached to an identity.
# Input: $1 = access key.
# Output: The attached policy names (comma-separated), or nothing.
# Use case: ensure_identity, validate.
# Author: Mr. Sachin Sharma
# Created: 2026-10-17
# Last modified: 2026-10-17
identity_policy() {
  local output pattern='"policyName":"([^"]*)"'
  output=$(mc admin user info --json aistor "$1" 2>/dev/null || true)
  if [[ $output =~ $pattern ]]; then
    printf '%s' "${BASH_REMATCH[1]}"
  fi
}

# Description: Read an identity's status.
# Input: $1 = access key.
# Output: "enabled", "disabled", or nothing when the identity does not exist.
# Use case: ensure_identity, validate.
# Author: Mr. Sachin Sharma
# Created: 2026-10-17
# Last modified: 2026-10-17
identity_status() {
  local output pattern='"userStatus":"([a-z]*)"'
  output=$(mc admin user info --json aistor "$1" 2>/dev/null || true)
  if [[ $output =~ $pattern ]]; then
    printf '%s' "${BASH_REMATCH[1]}"
  fi
}

# Description: Create a service identity, or bring an existing one in line.
# Input: $1 = access key, $2 = secret key, $3 = the only policy it may hold.
# Output: The identity exists with the secret key from the env file and exactly
#   that policy. An identity holding another policy, or one that was disabled,
#   is reported and left as it is (someone changed it on purpose).
# Use case: install.
# Author: Mr. Sachin Sharma
# Created: 2026-10-17
# Last modified: 2026-10-17
ensure_identity() {
  local access_key=$1 secret_key=$2 policy=$3 attached status
  status=$(identity_status "$access_key")
  if [ "$status" = "disabled" ]; then
    die "identity '$access_key' is disabled. Re-enable it on purpose with: make aistor-mc, then mc admin user enable aistor $access_key"
  fi

  attached=$(identity_policy "$access_key")
  if [ -n "$attached" ] && [ "$attached" != "$policy" ]; then
    die "identity '$access_key' holds policy '$attached', expected only '$policy'. Nothing was changed; inspect it with make aistor-mc."
  fi

  # Creates the identity, or sets an existing one's secret key to the env
  # file's value (the argument is visible only inside this one-off container).
  mc admin user add aistor "$access_key" "$secret_key" >/dev/null
  # Attaching an already attached policy is a no-op.
  mc admin policy attach aistor "$policy" --user "$access_key" >/dev/null
  info "  identity $access_key: policy $policy"
}

# --- Smoke test helpers ------------------------------------------------------

# Description: Remove everything this run created: probe objects and probe
#   buckets (as root) and local temporary files.
# Input: The smoke_objects, probe_buckets and temp_files arrays.
# Output: Nothing; best effort, never fails the script.
# Use case: EXIT trap, so a failed or interrupted run leaves nothing behind.
# Author: Mr. Sachin Sharma
# Created: 2026-10-17
# Last modified: 2026-10-17
cleanup() {
  local item
  for item in "${smoke_objects[@]+"${smoke_objects[@]}"}"; do
    mc rm --quiet "aistor/$item" >/dev/null 2>&1 || true
  done
  for item in "${probe_buckets[@]+"${probe_buckets[@]}"}"; do
    mc rb --force "aistor/$item" >/dev/null 2>&1 || true
  done
  for item in "${temp_files[@]+"${temp_files[@]}"}"; do
    rm -f "$item"
  done
}

# Description: Upload a random probe through one identity, read it back and
#   compare checksums.
# Input: $1 = alias (platform or backup), $2 = bucket, $3 = local probe file.
# Output: Two check lines (upload, read-back checksum). Sets the global
#   `last_probe` to the probe's "<bucket>/<key>" and registers it for cleanup.
# Use case: smoke.
# Author: Mr. Sachin Sharma
# Created: 2026-10-17
# Last modified: 2026-10-17
round_trip() {
  local alias=$1 bucket=$2 file=$3 key expected actual
  key="${SMOKE_PREFIX}/$(date -u +%Y%m%dT%H%M%SZ)-${RANDOM}${RANDOM}.bin"
  smoke_objects+=("$bucket/$key")
  last_probe="$bucket/$key"

  if mc cp --quiet "$file" "$alias/$bucket/$key" >/dev/null 2>&1; then
    check ok "$alias identity uploads to $bucket"
  else
    check fail "$alias identity uploads to $bucket"
    return
  fi

  expected=$(sha256sum < "$file")
  actual=$(mc cat "$alias/$bucket/$key" 2>/dev/null | sha256sum || true)
  if [ "$expected" = "$actual" ]; then
    check ok "$alias identity reads it back from $bucket (SHA-256 matches)"
  else
    check fail "$alias identity reads it back from $bucket (SHA-256 matches)"
  fi
}

# Description: Expect an operation to be refused (a negative isolation check).
# Input: $1 = description, then the command to run.
# Output: One check line: ok when the command fails, FAIL when it succeeds.
# Use case: validate and smoke (least privilege, no anonymous access).
# Author: Mr. Sachin Sharma
# Created: 2026-10-17
# Last modified: 2026-10-17
expect_denied() {
  local description=$1
  shift
  if "$@" >/dev/null 2>&1; then
    check fail "$description is denied"
  else
    check ok "$description is denied"
  fi
}

# Description: Expect an unauthenticated HTTP request to be refused.
# Input: $1 = description, $2 = URL path on the AIStor endpoint.
# Output: One check line: ok for HTTP 403 (or 401), FAIL otherwise.
# Use case: validate (no anonymous access through the S3 API itself).
# Author: Mr. Sachin Sharma
# Created: 2026-10-17
# Last modified: 2026-10-17
expect_anonymous_denied() {
  local description=$1 path=$2 code
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "${AISTOR_ENDPOINT}${path}" || true)
  if [ "$code" = "403" ] || [ "$code" = "401" ]; then
    check ok "$description is denied (HTTP $code)"
  else
    check fail "$description is denied (got HTTP ${code:-no answer})"
  fi
}

# --- Commands ----------------------------------------------------------------

# Description: Set up the platform buckets, policies and identities, then validate.
# Input: The container environment.
# Output: Converged setup; exits non-zero on a conflict or a failed check.
# Use case: make aistor-install (safe to run again at any time).
# Author: Mr. Sachin Sharma
# Created: 2026-10-17
# Last modified: 2026-10-17
cmd_install() {
  info "Buckets:"
  ensure_bucket "$PLATFORM_BUCKET" platform
  ensure_bucket "$BACKUP_BUCKET" backups
  info "Policies:"
  ensure_policy "$PLATFORM_POLICY" "$PLATFORM_BUCKET" yes
  ensure_policy "$BACKUP_POLICY" "$BACKUP_BUCKET" no
  info "Identities:"
  ensure_identity "$AISTOR_PLATFORM_ACCESS_KEY" "$AISTOR_PLATFORM_SECRET_KEY" "$PLATFORM_POLICY"
  ensure_identity "$AISTOR_BACKUP_ACCESS_KEY" "$AISTOR_BACKUP_SECRET_KEY" "$BACKUP_POLICY"
  info ""
  cmd_validate
}

# Description: Report probes, license and drive state.
# Input: The container environment.
# Output: Probe HTTP codes, license plan and expiry (never its ID), and
#   `mc admin info`; exits non-zero when a probe is not 200.
# Use case: make aistor-health.
# Author: Mr. Sachin Sharma
# Created: 2026-10-17
# Last modified: 2026-10-17
cmd_health() {
  local probe code output plan expires bad=0
  local plan_pattern='"Plan":"([^"]*)"' expires_pattern='"ExpiresAt":"([^"]*)"'

  info "Health probes:"
  for probe in live ready cluster; do
    code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "${AISTOR_ENDPOINT}/minio/health/${probe}" || true)
    printf '  %-8s HTTP %s\n' "$probe" "${code:-none}"
    [ "$code" = "200" ] || bad=1
  done

  info "License:"
  output=$(mc license info --json aistor 2>/dev/null || true)
  if [[ $output =~ $plan_pattern ]]; then plan=${BASH_REMATCH[1]}; else plan="unknown"; fi
  if [[ $output =~ $expires_pattern ]]; then expires=${BASH_REMATCH[1]}; else expires="unknown"; fi
  # The zero time means the license does not expire.
  [ "$expires" = "0001-01-01T00:00:00Z" ] && expires="no expiry"
  printf '  plan     %s\n  expires  %s\n' "$plan" "$expires"

  info "Server and drives:"
  mc admin info --no-color aistor || bad=1

  [ "$bad" -eq 0 ] || die "AIStor is not healthy. See: make logs s=aistor"
}

# Description: List every bucket with its owner tag, anonymous access and usage.
# Input: The container environment.
# Output: A table; buckets without an ownership tag show "unmapped".
# Use case: make aistor-buckets, make aistor-usage.
# Author: Mr. Sachin Sharma
# Created: 2026-10-17
# Last modified: 2026-10-17
cmd_buckets() {
  local line bucket owner pattern='"key":"([^"]*)/"'
  local -a lines
  mapfile -t lines < <(mc ls --json aistor 2>&1)
  for line in "${lines[@]+"${lines[@]}"}"; do
    [[ $line == *'"status":"error"'* ]] && die "could not list buckets. See: make aistor-health"
  done
  printf '%-32s %-12s %-10s %s\n' BUCKET OWNER ANONYMOUS USAGE
  for line in "${lines[@]+"${lines[@]}"}"; do
    [[ $line =~ $pattern ]] || continue
    bucket=${BASH_REMATCH[1]}
    owner=$(bucket_owner "$bucket")
    printf '%-32s %-12s %-10s %s\n' "$bucket" "${owner:-unmapped}" \
      "$(bucket_anonymous "$bucket")" "$(bucket_usage "$bucket")"
  done
  [ "${#lines[@]}" -gt 0 ] || info "(no buckets yet: run make aistor-install)"
}

# Description: Show one bucket's details.
# Input: $1 = bucket name (validated against the S3 naming rules first).
# Output: Owner tag, anonymous access, usage, versioning and `mc stat`.
# Use case: make aistor-bucket-inspect bucket=<name>.
# Author: Mr. Sachin Sharma
# Created: 2026-10-17
# Last modified: 2026-10-17
cmd_inspect() {
  local bucket=${1:-} owner
  local name_pattern='^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$'
  [ -n "$bucket" ] || die "no bucket given. Usage: make aistor-bucket-inspect bucket=<name>"
  [[ $bucket =~ $name_pattern ]] || die "'$bucket' is not a valid bucket name (3-63 characters: a-z, 0-9, dot, hyphen)."
  bucket_exists "$bucket" || die "bucket '$bucket' does not exist. List them with: make aistor-buckets"

  owner=$(bucket_owner "$bucket")
  printf '%-12s %s\n' "Bucket" "$bucket"
  printf '%-12s %s\n' "Owner tag" "${owner:-none (unmapped)}"
  printf '%-12s %s\n' "Anonymous" "$(bucket_anonymous "$bucket")"
  printf '%-12s %s\n' "Usage" "$(bucket_usage "$bucket")"
  printf '%-12s %s\n' "Versioning" "$(mc version info --no-color "aistor/$bucket" 2>&1 || true)"
  info ""
  mc stat --no-color "aistor/$bucket"
}

# Description: Upload/download/delete round trips with both service identities.
# Input: The container environment.
# Output: Check lines; probe objects are always removed; exits non-zero when a
#   check fails.
# Use case: make aistor-smoke, and the last part of validate.
# Author: Mr. Sachin Sharma
# Created: 2026-10-17
# Last modified: 2026-10-17
cmd_smoke() {
  local file
  file=$(mktemp)
  temp_files+=("$file")
  # 64 KiB of random bytes, so a wrong read-back cannot match by chance.
  head -c 65536 /dev/urandom > "$file"

  info "Smoke test (probe objects under ${SMOKE_PREFIX}/, removed afterwards):"
  round_trip platform "$PLATFORM_BUCKET" "$file"
  if mc rm --quiet "platform/$last_probe" >/dev/null 2>&1; then
    check ok "platform identity deletes its probe"
  else
    check fail "platform identity deletes its probe"
  fi

  round_trip backup "$BACKUP_BUCKET" "$file"
  # Backups are deleted only by the retention procedure, never by the writer.
  expect_denied "backup identity deleting from $BACKUP_BUCKET" mc rm --quiet "backup/$last_probe"

  [ "$failures" -eq 0 ] || die "$failures smoke check(s) failed."
  info "Smoke test passed."
}

# Description: Check the whole setup: buckets, tags, anonymous access, identity
#   policies, cross-bucket isolation, then the smoke test.
# Input: The container environment.
# Output: Check lines; exits non-zero when any check fails. Read-only apart
#   from the smoke test's own probe objects.
# Use case: make aistor-validate, and the end of install.
# Author: Mr. Sachin Sharma
# Created: 2026-10-17
# Last modified: 2026-10-17
cmd_validate() {
  local bucket owner expected_owner

  info "Buckets:"
  for bucket in "$PLATFORM_BUCKET" "$BACKUP_BUCKET"; do
    expected_owner=platform
    [ "$bucket" = "$BACKUP_BUCKET" ] && expected_owner=backups
    if ! bucket_exists "$bucket"; then
      check fail "bucket $bucket exists (run make aistor-install)"
      continue
    fi
    owner=$(bucket_owner "$bucket")
    check_that "bucket $bucket is tagged ${OWNER_TAG_KEY}=$expected_owner (found '${owner:-none}')" \
      [ "$owner" = "$expected_owner" ]
    check_that "bucket $bucket has no anonymous access policy" \
      [ "$(bucket_anonymous "$bucket")" = "private" ]
    expect_anonymous_denied "anonymous listing of $bucket" "/$bucket/"
  done

  info "Identities:"
  check_that "identity $AISTOR_PLATFORM_ACCESS_KEY is enabled" \
    [ "$(identity_status "$AISTOR_PLATFORM_ACCESS_KEY")" = "enabled" ]
  check_that "identity $AISTOR_PLATFORM_ACCESS_KEY holds only $PLATFORM_POLICY" \
    [ "$(identity_policy "$AISTOR_PLATFORM_ACCESS_KEY")" = "$PLATFORM_POLICY" ]
  check_that "identity $AISTOR_BACKUP_ACCESS_KEY is enabled" \
    [ "$(identity_status "$AISTOR_BACKUP_ACCESS_KEY")" = "enabled" ]
  check_that "identity $AISTOR_BACKUP_ACCESS_KEY holds only $BACKUP_POLICY" \
    [ "$(identity_policy "$AISTOR_BACKUP_ACCESS_KEY")" = "$BACKUP_POLICY" ]

  info "Isolation:"
  # Registered for cleanup first, in case a check unexpectedly succeeds.
  smoke_objects+=("$BACKUP_BUCKET/${SMOKE_PREFIX}/denied-probe" "$PLATFORM_BUCKET/${SMOKE_PREFIX}/denied-probe")
  probe_buckets+=("md-denied-probe")
  expect_denied "platform identity listing $BACKUP_BUCKET" mc ls "platform/$BACKUP_BUCKET"
  expect_denied "platform identity writing to $BACKUP_BUCKET" mc pipe "platform/$BACKUP_BUCKET/${SMOKE_PREFIX}/denied-probe" </dev/null
  expect_denied "backup identity listing $PLATFORM_BUCKET" mc ls "backup/$PLATFORM_BUCKET"
  expect_denied "backup identity writing to $PLATFORM_BUCKET" mc pipe "backup/$PLATFORM_BUCKET/${SMOKE_PREFIX}/denied-probe" </dev/null
  expect_denied "platform identity creating a bucket" mc mb "platform/md-denied-probe"
  expect_denied "backup identity managing identities" mc admin user list backup

  [ "$failures" -eq 0 ] || die "$failures check(s) failed. Fix them, then run make aistor-install again."
  info ""
  cmd_smoke
}

# Description: Report storage usage and server capacity.
# Input: The container environment.
# Output: `mc admin info` (drives, used/free) and the buckets table.
# Use case: make aistor-usage (the host script adds Docker resource figures).
# Author: Mr. Sachin Sharma
# Created: 2026-10-17
# Last modified: 2026-10-17
cmd_usage() {
  info "Server and drives:"
  mc admin info --no-color aistor
  info ""
  info "Buckets:"
  cmd_buckets
}

# Description: Open an interactive admin shell with the mc aliases defined.
# Input: The container environment (needs a terminal).
# Output: A bash session; nothing is printed about the credentials.
# Use case: make aistor-mc, for troubleshooting by an administrator.
# Author: Mr. Sachin Sharma
# Created: 2026-10-17
# Last modified: 2026-10-17
cmd_shell() {
  info "AIStor admin shell. mc aliases: aistor (root, full access), platform, backup."
  info "Examples: mc admin info aistor | mc ls aistor | mc du aistor/$PLATFORM_BUCKET"
  info "Changes made here bypass the application. Type exit to leave."
  export PS1='aistor-admin$ '
  exec bash --norc -i
}

# --- Entry point -------------------------------------------------------------

load_credentials
# Whatever happens, remove this run's probes and temporary files.
trap cleanup EXIT

case "${1:-}" in
  install) cmd_install ;;
  health) cmd_health ;;
  buckets) cmd_buckets ;;
  inspect) cmd_inspect "${2:-}" ;;
  smoke) cmd_smoke ;;
  validate) cmd_validate ;;
  usage) cmd_usage ;;
  shell) cmd_shell ;;
  *) die "unknown command '${1:-}' (expected install, health, buckets, inspect, smoke, validate, usage or shell)." ;;
esac
