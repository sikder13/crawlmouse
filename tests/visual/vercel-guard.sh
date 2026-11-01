#!/usr/bin/env bash
# On the production build (`next build` first), with the previews' flag set as CI sets it: every
# preview is a 404 under each Vercel marker, whatever its value, and a 200 with none (the control,
# so a 404 cannot come from a path that does not exist). /api/health answering 200 shows the
# server under test is up. Run from apps/web with its environment loaded (.env.ci in CI).
set -euo pipefail

PORT="${GUARD_PORT:-3140}"
REGISTRY='app/(v2-preview)/v2-preview/_preview/registry.ts'
mapfile -t PATHS < <(grep -oE "path: '/v2-preview[^']*'" "$REGISTRY" | sed -E "s/path: '([^']*)'/\1/")
PATHS+=('/v2-preview')
[ "${#PATHS[@]}" -gt 1 ] || { echo "no preview paths read from $REGISTRY"; exit 1; }

serve() {
  env "$@" V2_PREVIEW_ON_NEXT_START=1 pnpm exec next start -p "$PORT" >/dev/null 2>&1 &
  PID=$!
  for _ in $(seq 1 120); do
    if [ "$(curl -s -o /dev/null -w '%{http_code}' "http://localhost:$PORT/api/health")" = 200 ]; then
      return 0
    fi
    sleep 0.5
  done
  echo "the server did not start ($*)"
  return 1
}

stop() {
  kill "$PID" 2>/dev/null || true
  wait "$PID" 2>/dev/null || true
}
trap stop EXIT

expect_all() {
  local want="$1" label="$2" bad=0
  for path in "${PATHS[@]}"; do
    got="$(curl -s -o /dev/null -w '%{http_code}' "http://localhost:$PORT$path")"
    if [ "$got" != "$want" ]; then
      echo "  $label: $path answered $got, not $want"
      bad=1
    fi
  done
  echo "$label: ${#PATHS[@]} preview paths, each $want"
  return "$bad"
}

status=0
serve
expect_all 200 'no Vercel marker (control)' || status=1
stop
for marker in VERCEL_ENV=production VERCEL_ENV=preview VERCEL_ENV=development VERCEL_ENV= VERCEL=1 VERCEL=; do
  serve "$marker"
  expect_all 404 "$marker" || status=1
  stop
done
exit "$status"
