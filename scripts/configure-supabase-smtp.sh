#!/usr/bin/env bash
#
# Configure Supabase Auth → custom SMTP (Resend) for the Crawlmouse project.
#
# Reads:
#   - scripts/.env.local            → SUPABASE_ACCESS_TOKEN (PAT from supabase.com/dashboard/account/tokens)
#   - apps/web/.env.local           → RESEND_API_KEY        (Resend API key)
#
# Writes:
#   - Updates auth config for project ref ezspnfeyzwsisymytssm via Supabase Management API.
#   - Sets: smtp_host=smtp.resend.com, smtp_port=587, smtp_user=resend, smtp_pass=$RESEND_API_KEY,
#           smtp_admin_email=magic@crawlmouse.com, smtp_sender_name=Crawlmouse, smtp_max_frequency=60.
#
# Idempotent: rerun to update settings if any change.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
PROJECT_REF="ezspnfeyzwsisymytssm"

ADMIN_ENV="$SCRIPT_DIR/.env.local"
APP_ENV="$PROJECT_ROOT/apps/web/.env.local"

if [[ ! -f "$ADMIN_ENV" ]]; then
  echo "ERROR: $ADMIN_ENV not found." >&2
  echo "Create it with one line:    SUPABASE_ACCESS_TOKEN=sbp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" >&2
  exit 1
fi

set -a
. "$ADMIN_ENV"
set +a

if [[ -z "${SUPABASE_ACCESS_TOKEN:-}" ]]; then
  echo "ERROR: SUPABASE_ACCESS_TOKEN is empty in $ADMIN_ENV" >&2
  exit 1
fi

if [[ ! -f "$APP_ENV" ]]; then
  echo "ERROR: $APP_ENV not found." >&2
  exit 1
fi

RESEND_API_KEY="$(grep -E '^RESEND_API_KEY=' "$APP_ENV" | head -1 | cut -d= -f2- || true)"
if [[ -z "$RESEND_API_KEY" ]]; then
  echo "ERROR: RESEND_API_KEY missing from $APP_ENV" >&2
  exit 1
fi

PAYLOAD="$(SMTP_PASS="$RESEND_API_KEY" python3 -c "
import json, os
print(json.dumps({
    'smtp_admin_email': 'magic@crawlmouse.com',
    'smtp_host': 'smtp.resend.com',
    'smtp_port': '587',
    'smtp_user': 'resend',
    'smtp_pass': os.environ['SMTP_PASS'],
    'smtp_sender_name': 'Crawlmouse',
    'smtp_max_frequency': 60,
    'external_email_enabled': True,
}))
")"

RESPONSE_FILE="$(mktemp)"
trap 'rm -f "$RESPONSE_FILE"' EXIT

echo "→ PATCH https://api.supabase.com/v1/projects/${PROJECT_REF}/config/auth"

HTTP_CODE="$(curl -sS -o "$RESPONSE_FILE" -w '%{http_code}' \
  -X PATCH "https://api.supabase.com/v1/projects/${PROJECT_REF}/config/auth" \
  -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  --data-binary "$PAYLOAD" || echo "000")"

if [[ "$HTTP_CODE" != "200" ]]; then
  echo "❌ HTTP $HTTP_CODE — request failed. Response:" >&2
  cat "$RESPONSE_FILE" >&2
  echo >&2
  exit 1
fi

echo "✅ HTTP 200 — Supabase auth config updated."
echo
echo "Verifying applied SMTP settings (password masked):"
python3 - "$RESPONSE_FILE" <<'PY'
import json, sys
d = json.load(open(sys.argv[1]))
fields = [
    'smtp_admin_email',
    'smtp_host',
    'smtp_port',
    'smtp_user',
    'smtp_sender_name',
    'smtp_max_frequency',
    'external_email_enabled',
]
for k in fields:
    print(f'  {k:<28} = {d.get(k)}')
pw = d.get('smtp_pass') or ''
print(f'  {"smtp_pass":<28} = {pw[:5]}... ({len(pw)} chars)')
PY

echo
echo "Next: send a magic link from the Supabase dashboard to verify end-to-end:"
echo "  https://supabase.com/dashboard/project/${PROJECT_REF}/auth/users"
