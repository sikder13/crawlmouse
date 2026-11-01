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

LOG="${GUARD_LOG:-/tmp/vercel-guard-next.log}"
NEXT="$(pwd)/node_modules/.bin/next"
PID=''

# Start `next start` in the background, in its own process group with its output in $LOG, so it
# never holds this script's output open and the whole group can be stopped. Wait for its health
# route, at most 120 s.
serve() {
  setsid env "$@" V2_PREVIEW_ON_NEXT_START=1 "$NEXT" start -p "$PORT" >>"$LOG" 2>&1 </dev/null &
  PID=$!
  for _ in $(seq 1 240); do
    if [ "$(curl -s -m 2 -o /dev/null -w '%{http_code}' "http://localhost:$PORT/api/health")" = 200 ]; then
      return 0
    fi
    sleep 0.5
  done
  echo "the server did not answer within 120 s ($*); its log is $LOG"
  return 1
}

# Whether anything listens on the port (bash's own /dev/tcp, so no ss or netstat is needed).
listening() { (exec 3<>"/dev/tcp/127.0.0.1/$PORT") 2>/dev/null; }

# Stop the server's whole process group, and confirm the port is free again, at most 30 s.
stop() {
  [ -n "$PID" ] || return 0
  kill -TERM -- "-$PID" 2>/dev/null || true
  for _ in $(seq 1 60); do
    if ! kill -0 -- "-$PID" 2>/dev/null && ! listening; then
      PID=''
      return 0
    fi
    sleep 0.5
  done
  kill -KILL -- "-$PID" 2>/dev/null || true
  sleep 1
  if listening; then
    echo "port $PORT is still in use after stopping the server"
    exit 1
  fi
  PID=''
}
trap stop EXIT

expect_all() {
  local want="$1" label="$2" bad=0
  for path in "${PATHS[@]}"; do
    got="$(curl -s -m 30 -o /dev/null -w '%{http_code}' "http://localhost:$PORT$path")"
    if [ "$got" != "$want" ]; then
      echo "  $label: $path answered $got, not $want"
      bad=$((bad + 1))
    fi
  done
  if [ "$bad" -eq 0 ]; then
    echo "$label: ${#PATHS[@]} preview paths, each $want"
  else
    echo "$label: $bad of ${#PATHS[@]} preview paths did not answer $want"
  fi
  [ "$bad" -eq 0 ]
}

status=0
: >"$LOG"
if listening; then
  echo "port $PORT is already in use"
  exit 1
fi
serve || exit 1
expect_all 200 'no Vercel marker (control)' || status=1
stop
for marker in VERCEL_ENV=production VERCEL_ENV=preview VERCEL_ENV=development VERCEL_ENV= VERCEL=1 VERCEL=; do
  serve "$marker" || exit 1
  expect_all 404 "$marker" || status=1
  stop
done
exit "$status"
