#!/usr/bin/env bash
# Prints the state of every service plus the application's own readiness
# report. Exits non-zero if a required service is down or the app cannot reach
# its dependencies. The management GUIs are optional and never fail the check.
set -uo pipefail

# shellcheck source=docker/scripts/lib.sh
. "$(dirname "$0")/lib.sh"

required="app postgres redis aistor"
optional="pgadmin redisinsight"
failed=0
logs_command="make logs"
[ "${MODE:-dev}" = "prod" ] && logs_command="make prod-logs"

printf '%-14s %-10s %-10s %s\n' SERVICE STATE HEALTH NOTE
for service in $required $optional; do
  note=""
  case " $optional " in *" $service "*) note="optional" ;; esac

  id=$("${compose[@]}" --profile tools ps -a -q "$service" 2>/dev/null | head -n 1)
  if [ -z "$id" ]; then
    state="absent"
    health="-"
  else
    state=$("${docker[@]}" inspect --format '{{.State.Status}}' "$id")
    health=$("${docker[@]}" inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}-{{end}}' "$id")
  fi

  if [ -z "$note" ] && { [ "$state" != "running" ] || [ "$health" != "healthy" ]; }; then
    failed=1
    note="REQUIRED - see: $logs_command s=$service"
  fi
  printf '%-14s %-10s %-10s %s\n' "$service" "$state" "$health" "$note"
done

echo
echo "Application readiness (GET /api/health/ready, from inside the app container):"
if "${compose[@]}" exec -T app node -e '
  fetch("http://127.0.0.1:3000/api/health/ready")
    .then(async (response) => {
      console.log("  HTTP " + response.status + "  " + (await response.text()));
      process.exit(response.ok ? 0 : 1);
    })
    .catch((error) => {
      console.log("  request failed: " + error.message);
      process.exit(1);
    });
' 2>/dev/null; then
  :
else
  echo "  The app is not ready. See: $logs_command s=app"
  failed=1
fi

exit "$failed"
