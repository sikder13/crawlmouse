# Edge firewall: applying `infra/vercel/firewall.json`

The Vercel WAF rules for project `crawlmouse-001` are reviewed in the repo as data and applied by the
owner's CTO through the Vercel API. This session does not apply them. What the file holds, and why each
limit sits where it does, is in `docs/specs/v2/sec-baseline.md` (D9). The file is checked by:

```bash
pnpm --filter @crawlmouse/web exec vitest run __tests__/security/firewall.test.ts
```

## Before you apply

Run every command from the repository root, in a shell that holds a Vercel token with access to team
`team_7JoIUGWqgJwobBinsyt2qRKH` (Vercel → Account Settings → Tokens). Read it without echoing it:

```bash
read -rs VERCEL_TOKEN && export VERCEL_TOKEN
```

```bash
export VERCEL_SCOPE='projectId=prj_ZOVjZgG2kU6BzcXyAFutzNpQQXx5&teamId=team_7JoIUGWqgJwobBinsyt2qRKH'
```

1. Read what is active now, and keep it. On 2026-11-08 the answer was "not found": no configuration.

   ```bash
   curl -sS -H "Authorization: Bearer $VERCEL_TOKEN" "https://api.vercel.com/v1/security/firewall/config/active?$VERCEL_SCOPE" | tee ~/firewall-before.json
   ```

2. If that returns rules (someone added them in the dashboard since), stop. `PUT` replaces the whole
   configuration, so their rules would be lost. Add them to `infra/vercel/firewall.json` in a pull
   request first, or apply ours one at a time with `PATCH` (`action: "rules.insert"`).

## Apply

```bash
curl -sS -X PUT -H "Authorization: Bearer $VERCEL_TOKEN" -H "Content-Type: application/json" --data @infra/vercel/firewall.json "https://api.vercel.com/v1/security/firewall/config?$VERCEL_SCOPE" | tee ~/firewall-put.json
```

## Read back

The active configuration must hold the file's four rules, by name, each `active`:

```bash
curl -sS -H "Authorization: Bearer $VERCEL_TOKEN" "https://api.vercel.com/v1/security/firewall/config/active?$VERCEL_SCOPE" | jq -r '.rules[] | "\(.active) \(.name)"'
```

Compare with what the file names:

```bash
jq -r '.rules[] | "\(.active) \(.name)"' infra/vercel/firewall.json
```

The two lists must be equal. Then check a limit from one IP. This sends 31 sign-in requests with an
invalid address, so no email goes out. The app answers each with 400, and the edge should deny the
31st with 403. Your IP is then refused on that route for the rest of the minute.

```bash
for i in $(seq 1 31); do curl -s -o /dev/null -w '%{http_code}\n' -X POST https://crawlmouse.com/api/auth/magic-link/ -H 'content-type: application/json' -d '{"email":"x"}'; done | sort | uniq -c
```

The check-claim rule must count every case of its path, because Vercel serves a dynamic route in any
case. The same loop on an upper-case spelling must also end in the edge's denial. Vercel's own 403
page, not the app's JSON, answers the 31st:

```bash
for i in $(seq 1 31); do curl -s -o /dev/null -w '%{http_code} %{content_type}\n' -X POST https://crawlmouse.com/API/CHECKS/00000000-0000-4000-8000-000000000000/CLAIM; done | sort | uniq -c
```

## Roll back

Put back what was active before:

```bash
curl -sS -X PUT -H "Authorization: Bearer $VERCEL_TOKEN" -H "Content-Type: application/json" --data '{"firewallEnabled":true,"rules":[]}' "https://api.vercel.com/v1/security/firewall/config?$VERCEL_SCOPE"
```

When `~/firewall-before.json` held a configuration rather than "not found", send its `rules` back instead
of the empty list.

## What to watch

- These rules apply to every deployment of the project, previews included. Seed scripts or a load
  test run against a deployment from one IP would trip the audit-start limit (60 per 10 minutes).
- The edge answers a denied request with its own 403, not the app's 429 and its copy. That is the point:
  only a flood reaches the limit.
- Rate limiting is billed by usage on the Pro plan, priced per region; Vercel's WAF usage and pricing
  page has the current rates.
- Retune after four weeks of traffic (D12).
