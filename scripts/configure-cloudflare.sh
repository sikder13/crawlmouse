#!/usr/bin/env bash
#
# Configure Cloudflare for crawlmouse.com:
#   1. Look up zone_id and account_id for crawlmouse.com
#   2. Create Turnstile widget (idempotent) → write sitekey + secret to apps/web/.env.local
#   3. Enable Email Routing on the zone (idempotent)
#   4. Add nahlai.tech@gmail.com as destination address (idempotent — triggers Cloudflare verification email if new)
#   5. Create forwarding rules for magic@, hello@, support@, privacy@, abuse@ (idempotent)
#
# Prereq:
#   - Cloudflare account exists and crawlmouse.com is added as a site
#   - Namecheap nameservers have been changed to Cloudflare (or pending — DNS won't block API ops)
#   - CLOUDFLARE_API_TOKEN is set in scripts/.env.local with these permissions on crawlmouse.com:
#       Account → Turnstile : Edit
#       Account → Email Routing Addresses : Edit
#       Zone    → Email Routing Rules : Edit
#       Zone    → Zone : Read
#
# Idempotent: rerun anytime — won't duplicate widgets, addresses, or rules.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

DOMAIN="crawlmouse.com"
DESTINATION_EMAIL="nahlai.tech@gmail.com"
# magic@ = auth sender; hello@ = general; support@ = Terms/Status contact;
# privacy@ = GDPR/CCPA rights + sub-processor questions (Privacy/Subprocessors pages, draft banner);
# abuse@ = AUP abuse-reporting channel. All forward to the destination inbox.
FORWARDED_PREFIXES=("magic" "hello" "support" "privacy" "abuse")

ADMIN_ENV="$SCRIPT_DIR/.env.local"
APP_ENV="$PROJECT_ROOT/apps/web/.env.local"

# ----- 0. load token -----
if [[ ! -f "$ADMIN_ENV" ]]; then
  echo "ERROR: $ADMIN_ENV not found." >&2
  exit 1
fi
set -a; . "$ADMIN_ENV"; set +a

if [[ -z "${CLOUDFLARE_API_TOKEN:-}" ]]; then
  echo "ERROR: CLOUDFLARE_API_TOKEN missing from $ADMIN_ENV" >&2
  echo "Add a line:    CLOUDFLARE_API_TOKEN=<token from https://dash.cloudflare.com/profile/api-tokens>" >&2
  exit 1
fi

API="https://api.cloudflare.com/client/v4"
AUTH_HEADER="Authorization: Bearer ${CLOUDFLARE_API_TOKEN}"
JSON_HEADER="Content-Type: application/json"

# helper: extract a value from JSON using python3
jget() {
  python3 -c "import json, sys; print(json.loads(sys.stdin.read())$1)"
}

# helper: pretty-fail when the API returns success=false
api_call() {
  local method="$1" path="$2" data="${3:-}"
  local response
  if [[ -n "$data" ]]; then
    response="$(curl -sS -X "$method" "${API}${path}" -H "$AUTH_HEADER" -H "$JSON_HEADER" --data-binary "$data")"
  else
    response="$(curl -sS -X "$method" "${API}${path}" -H "$AUTH_HEADER" -H "$JSON_HEADER")"
  fi
  local success
  success="$(echo "$response" | python3 -c "import json, sys; print(json.load(sys.stdin).get('success'))" 2>/dev/null || echo 'parse-error')"
  if [[ "$success" != "True" ]]; then
    echo "❌ API call failed: $method $path" >&2
    echo "Response: $response" >&2
    return 1
  fi
  echo "$response"
}

# ----- 1. look up zone + account -----
echo "→ Looking up zone for $DOMAIN..."
ZONE_RESPONSE="$(api_call GET "/zones?name=${DOMAIN}")"
ZONE_COUNT="$(echo "$ZONE_RESPONSE" | jget "['result_info']['count']")"
if [[ "$ZONE_COUNT" == "0" ]]; then
  echo "❌ $DOMAIN is not in your Cloudflare account. Add it as a site first." >&2
  exit 1
fi
ZONE_ID="$(echo "$ZONE_RESPONSE" | jget "['result'][0]['id']")"
ACCOUNT_ID="$(echo "$ZONE_RESPONSE" | jget "['result'][0]['account']['id']")"
echo "   zone_id    = $ZONE_ID"
echo "   account_id = $ACCOUNT_ID"

# ----- 2. Turnstile widget -----
echo
echo "→ Checking for existing Turnstile widget named 'Crawlmouse'..."
WIDGETS_RESPONSE="$(api_call GET "/accounts/${ACCOUNT_ID}/challenges/widgets")"
EXISTING_SITEKEY="$(echo "$WIDGETS_RESPONSE" | python3 -c "
import json, sys
d = json.load(sys.stdin)
for w in d.get('result', []):
    if w.get('name') == 'Crawlmouse':
        print(w.get('sitekey', ''))
        break
")"

if [[ -n "$EXISTING_SITEKEY" ]]; then
  echo "   Found existing widget — sitekey: $EXISTING_SITEKEY"
  echo "   (Cannot retrieve secret from list endpoint; if you need a fresh secret, delete the widget in dashboard and rerun.)"
  SITEKEY="$EXISTING_SITEKEY"
  SECRET=""
else
  echo "   No existing widget — creating one (mode=managed)..."
  CREATE_BODY="$(python3 -c "
import json
print(json.dumps({
    'name': 'Crawlmouse',
    'mode': 'managed',
    'domains': ['crawlmouse.com', 'localhost'],
}))")"
  CREATE_RESPONSE="$(api_call POST "/accounts/${ACCOUNT_ID}/challenges/widgets" "$CREATE_BODY")"
  SITEKEY="$(echo "$CREATE_RESPONSE" | jget "['result']['sitekey']")"
  SECRET="$(echo "$CREATE_RESPONSE" | jget "['result']['secret']")"
  echo "   Created — sitekey: $SITEKEY"
fi

# ----- 2b. write Turnstile keys to apps/web/.env.local -----
if [[ -n "$SITEKEY" ]]; then
  sed -i.bak -E "s|^NEXT_PUBLIC_TURNSTILE_SITE_KEY=.*|NEXT_PUBLIC_TURNSTILE_SITE_KEY=${SITEKEY}|" "$APP_ENV"
  echo "   Wrote NEXT_PUBLIC_TURNSTILE_SITE_KEY to $APP_ENV"
fi
if [[ -n "$SECRET" ]]; then
  sed -i.bak -E "s|^TURNSTILE_SECRET_KEY=.*|TURNSTILE_SECRET_KEY=${SECRET}|" "$APP_ENV"
  echo "   Wrote TURNSTILE_SECRET_KEY to $APP_ENV"
fi
rm -f "${APP_ENV}.bak"

# ----- 3. Email Routing — enable on zone (idempotent) -----
echo
echo "→ Email Routing: checking zone status..."
ROUTING_STATUS_RESPONSE="$(curl -sS "${API}/zones/${ZONE_ID}/email/routing" -H "$AUTH_HEADER" -H "$JSON_HEADER")"
ROUTING_STATUS="$(echo "$ROUTING_STATUS_RESPONSE" | python3 -c "
import json, sys
d = json.load(sys.stdin)
print((d.get('result') or {}).get('status', 'unknown'))" 2>/dev/null || echo 'unknown')"
echo "   Current status: $ROUTING_STATUS"

if [[ "$ROUTING_STATUS" != "ready" && "$ROUTING_STATUS" != "enabled" ]]; then
  echo "   Enabling Email Routing..."
  api_call POST "/zones/${ZONE_ID}/email/routing/enable" '{}' > /dev/null || {
    echo "   ⚠️  Enable failed — likely because DNS isn't fully propagated to Cloudflare yet."
    echo "       Re-run this script in 10-15 minutes after Cloudflare confirms 'Active' status."
    exit 1
  }
  echo "   ✅ Email Routing enabled"
else
  echo "   ✅ Email Routing already active"
fi

# ----- 4. add destination address (idempotent) -----
echo
echo "→ Checking destination addresses..."
ADDRESSES_RESPONSE="$(api_call GET "/accounts/${ACCOUNT_ID}/email/routing/addresses")"
DEST_VERIFIED="$(echo "$ADDRESSES_RESPONSE" | python3 -c "
import json, sys
d = json.load(sys.stdin)
for a in d.get('result', []):
    if a.get('email') == '$DESTINATION_EMAIL':
        print('verified' if a.get('verified') else 'pending')
        break
else:
    print('not-found')
")"

case "$DEST_VERIFIED" in
  verified)  echo "   ✅ $DESTINATION_EMAIL already verified" ;;
  pending)   echo "   ⏳ $DESTINATION_EMAIL added but not yet verified — check Gmail for verification link" ;;
  not-found)
    echo "   Adding $DESTINATION_EMAIL as destination..."
    ADD_BODY="$(python3 -c "import json; print(json.dumps({'email': '$DESTINATION_EMAIL'}))")"
    api_call POST "/accounts/${ACCOUNT_ID}/email/routing/addresses" "$ADD_BODY" > /dev/null
    echo "   ⏳ Verification email sent to $DESTINATION_EMAIL — click the link in that email to activate."
    ;;
esac

# ----- 5. create forwarding rules (idempotent) -----
echo
echo "→ Configuring forwarding rules..."
RULES_RESPONSE="$(api_call GET "/zones/${ZONE_ID}/email/routing/rules")"

for prefix in "${FORWARDED_PREFIXES[@]}"; do
  from_addr="${prefix}@${DOMAIN}"
  rule_exists="$(echo "$RULES_RESPONSE" | python3 -c "
import json, sys
d = json.load(sys.stdin)
for r in d.get('result', []):
    for m in r.get('matchers', []):
        if m.get('field') == 'to' and m.get('value') == '$from_addr':
            print('yes')
            sys.exit()
print('no')
")"

  if [[ "$rule_exists" == "yes" ]]; then
    echo "   ✅ rule exists: $from_addr → $DESTINATION_EMAIL"
  else
    rule_body="$(python3 -c "
import json
print(json.dumps({
    'name': f'Forward {\"$from_addr\"} to $DESTINATION_EMAIL',
    'enabled': True,
    'priority': 0,
    'matchers': [{'type': 'literal', 'field': 'to', 'value': '$from_addr'}],
    'actions': [{'type': 'forward', 'value': ['$DESTINATION_EMAIL']}],
}))")"
    api_call POST "/zones/${ZONE_ID}/email/routing/rules" "$rule_body" > /dev/null
    echo "   ✅ created rule: $from_addr → $DESTINATION_EMAIL"
  fi
done

# ----- 6. summary -----
echo
echo "============================================================"
echo "✅ Cloudflare configuration complete for $DOMAIN"
echo "============================================================"
echo "Turnstile sitekey  → $SITEKEY"
echo "Turnstile secret   → written to apps/web/.env.local (masked)"
echo
echo "Email Routing rules (forward to $DESTINATION_EMAIL):"
for prefix in "${FORWARDED_PREFIXES[@]}"; do
  echo "   • ${prefix}@${DOMAIN}"
done
echo
if [[ "$DEST_VERIFIED" != "verified" ]]; then
  echo "⏳ ACTION REQUIRED: Check $DESTINATION_EMAIL for a Cloudflare verification email."
  echo "    Click the link inside to activate forwarding. Rules above stay 'unverified' until you do."
fi
