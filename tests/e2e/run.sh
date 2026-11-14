#!/usr/bin/env bash
# The launch walk (CC-38 D4), end to end on this machine: a production build of apps/web pointed at
# the stand-in, the stand-in seeded with the QA set (harness/serve.ts), `next start`, the journeys,
# then both servers stopped by process group and the ports checked. Not part of CI.
#
#   bash tests/e2e/run.sh                 # build, then walk
#   SKIP_BUILD=1 bash tests/e2e/run.sh    # walk the build already in apps/web/.next (one this made)
#   bash tests/e2e/run.sh 2-free          # walk the journeys whose file names match
#
# Screenshots go to $WALK_SHOTS when it is set (none are taken otherwise). Results:
# tests/e2e/results.json (gitignored), read by `pnpm golive:check --go-no-go`.
set -u
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
W=$ROOT/apps/web
WEB_PORT=${WALK_PORT:-3238}
STANDIN_PORT=${STANDIN_PORT:-54438}
LOGS=${WALK_LOGS:-$ROOT/apps/web/test-results/e2e-logs}
mkdir -p "$LOGS"
source ~/.nvm/nvm.sh >/dev/null && nvm use 22 >/dev/null
cd "$W" || exit 1

listener() { ss -ltnpH "sport = :$1" 2>/dev/null | grep -o 'pid=[0-9]*' | head -1 | cut -d= -f2; }
for port in $WEB_PORT $STANDIN_PORT; do
  pid=$(listener "$port")
  if [ -n "${pid:-}" ]; then
    echo "port $port is in use by pid $pid: $(ps -o cmd= -p "$pid" | cut -c1-160); stop it and run again"
    exit 1
  fi
done

GROUPS_STARTED=()
stop() {
  for g in "${GROUPS_STARTED[@]}"; do kill -- "-$g" 2>/dev/null; done
  sleep 2
  for port in $WEB_PORT $STANDIN_PORT; do
    pid=$(listener "$port"); [ -n "${pid:-}" ] && kill "$pid" 2>/dev/null
  done
  sleep 1
  echo "ports after: $WEB_PORT $(ss -ltnH "sport = :$WEB_PORT" | wc -l) listening, $STANDIN_PORT $(ss -ltnH "sport = :$STANDIN_PORT" | wc -l) listening"
}

# The build's and the server's environment: CI's placeholders, then the stand-in and the four flags.
set -a; . ./.env.ci; set +a
part() { printf '%s' "$@"; }
export NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:$STANDIN_PORT NEXT_PUBLIC_SUPABASE_ANON_KEY=standin-anon-key
export SUPABASE_SERVICE_ROLE_KEY=standin-service-role-key NEXT_PUBLIC_BASE_URL=http://localhost:$WEB_PORT
export V2_ACCOUNT_DOOR=1 V2_PIPELINE=1 V2_CHECKS_PUBLIC=1 V2_BILLING=1
# A Vercel preview: Turnstile's permissive path and a test-mode Stripe key are allowed there.
export VERCEL_ENV=preview
# Sample secrets, built from parts. The webhook secret is the repo's StripeFake's (lib/billing/stripe.fake.ts).
export STRIPE_ACCOUNT_SECRET_KEY="$(part sk _test_ walk 000000000000000000)" STRIPE_ACCOUNT_LIVEMODE=0
export STRIPE_ACCOUNT_WEBHOOK_SECRET="$(part cc03 -webhook -test -secret)"
export TRIAL_LEDGER_PEPPER="$(part walk - ledger - pepper - 0000000000000000000000)"
export EMAIL_LINK_SECRET="$(printf 'w%.0s' $(seq 1 40))"
export INNGEST_EVENT_KEY=walk INNGEST_BASE_URL=http://127.0.0.1:$STANDIN_PORT
export WALK_STRIPE_PORT=$STANDIN_PORT STANDIN_PORT WALK_BASE=http://localhost:$WEB_PORT
export STANDIN_URL=http://127.0.0.1:$STANDIN_PORT

if [ "${SKIP_BUILD:-}" != 1 ]; then
  rm -rf .next
  echo "building $(git rev-parse --short HEAD) at $(date '+%H:%M:%S')"
  pnpm exec next build > "$LOGS/build.log" 2>&1 || { echo "BUILD FAILED"; tail -30 "$LOGS/build.log"; exit 1; }
fi

: > "$LOGS/serve.out"
setsid pnpm exec tsx "$ROOT/tests/e2e/harness/serve.ts" > "$LOGS/serve.out" 2> "$LOGS/serve.err" < /dev/null &
GROUPS_STARTED+=($!)
for i in $(seq 1 120); do [ -s "$LOGS/serve.out" ] && break; sleep 2; done
[ -s "$LOGS/serve.out" ] || { echo "STAND-IN NOT READY"; tail -20 "$LOGS/serve.err"; stop; exit 1; }
cat "$LOGS/serve.out"
export WALK_SEEDED=$(grep -o '"seeded":[a-z]*' "$LOGS/serve.out" | cut -d: -f2)

NODE_OPTIONS="--import $ROOT/tests/e2e/harness/preload.mjs" \
  setsid pnpm exec next start -p "$WEB_PORT" > "$LOGS/start.log" 2>&1 < /dev/null &
GROUPS_STARTED+=($!)
for i in $(seq 1 45); do ss -ltnH "sport = :$WEB_PORT" | grep -q . && break; sleep 2; done
ss -ltnH "sport = :$WEB_PORT" | grep -q . || { echo "NEXT START NOT LISTENING"; tail -20 "$LOGS/start.log"; stop; exit 1; }

cd "$ROOT/tests/e2e" || { stop; exit 1; }
timeout 1800 "$W/node_modules/.bin/playwright" test -c playwright.config.ts "$@"
code=$?
stop
echo "walk exit $code on $(git -C "$ROOT" rev-parse --short HEAD)"
exit $code
