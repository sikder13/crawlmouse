# Uptime monitors and the sign-in canary

What tells us that crawlmouse.com has stopped serving, and what tells us that sign-in mail has
stopped arriving (CC-33 D6). The monitors are Sentry uptime monitors the owner creates; the canary
is an Inngest function in this repository. Spec: `docs/specs/v2/33-operations.md`.

## The monitors

A failing monitor raises a Sentry uptime alert in org `nahl-technologies-inc`, project `crawlmouse`;
who receives it is that project's alert setting, as for the other rules (`docs/ops/security-baseline.md`
"Alert rules"). The monitors below are created with `GET` over HTTPS, a 60-second interval and a
10-second timeout. Sentry's uptime check counts an answer that is not 2xx as a failure.

| Monitor   | URL                                 | Passes when                           | A failure means                                                                                                                                                                |
| --------- | ----------------------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Home page | `https://crawlmouse.com/`           | 2xx                                   | Visitors are not getting the home page: DNS, Cloudflare, Vercel or the page's render is failing.                                                                               |
| Health    | `https://crawlmouse.com/api/health` | 2xx, and the body starts `{"ok":true` | The deployment is not serving its functions, or a deploy broke the app's server code. It reads no database, so a database outage does not fail it.                             |
| Worker    | `<CRAWL_WORKER_URL>/healthz`        | 2xx, body `{"ok":true}`               | The crawl worker on Fly is down or not routed: checks that reach a crawl batch fail (`worker_unavailable`), and the reaper (`inngest/check-reaper.ts`) fails the stalled ones. |

The Health monitor's body match is a keyword check; if Sentry's monitor offers no body assertion,
the 2xx check alone stands and the body is what `apps/web/app/api/health/route.ts` returns.

**The worker's URL is not in the repository.** The app reads it from `CRAWL_WORKER_URL` in Vercel's
production environment (`apps/web/lib/worker-client/client.ts`). The repository names the staging
Fly app, `crawlmouse-worker-staging` (`packages/worker/fly.toml`), whose Fly address would be
`https://crawlmouse-worker-staging.fly.dev`. The owner supplies the production value: the
`CRAWL_WORKER_URL` set in Vercel, with `/healthz` appended. `/healthz` needs no signature
(`grep -c "auth: 'none'" packages/worker/src/routes.ts` answers 1, its row) and reads no state.

Create each with Sentry's "Create an Uptime Monitor" endpoint (check its current reference first),
with a token holding `project:write`, read without echoing it:

```bash
read -rs SENTRY_TOKEN && curl -sS -X POST -H "Authorization: Bearer $SENTRY_TOKEN" \
  -H 'Content-Type: application/json' \
  https://us.sentry.io/api/0/projects/nahl-technologies-inc/crawlmouse/uptime/ \
  -d '{"name":"Health","url":"https://crawlmouse.com/api/health","method":"GET","intervalSeconds":60,"timeoutMs":10000,"environment":"production"}'
unset SENTRY_TOKEN
```

Change `name` and `url` for the other two. On 2026-11-08 the home page monitor existed and the other
two did not (`docs/ops/security-baseline.md`); list what exists before creating anything.

## What the monitors do not see

- **The magic-link route.** It needs a POST, a Turnstile token in production, and spends the
  per-address rate-limit bucket on each call, and it answers 400 without a token. A monitor that
  counts non-2xx as down would report it down on each check. The canary below watches sign-in mail without it.
- **Audits, email and billing.** No monitor runs a check, sends a mail or reads Stripe. `/status`
  says so on the page.

## The sign-in canary

`crawlmouse.ops.signin-canary` (`inngest/signin-canary.ts`), on the cron `*/10 * * * *`, registered when
`SIGNIN_CANARY_TO` is one plain address and `V2_BILLING` or `V2_CHECKS_PUBLIC` is `1`:

1. asks Supabase Auth for a sign-in link to that address (`requestSignInLink`, with
   `shouldCreateUser: false`, so the address must be an existing user);
2. waits 5 minutes;
3. looks for an `email_events` row of type `delivered` for that address (compared lower-cased)
   recorded since the request. None: Sentry `captureMessage('signin-canary')` at level `error`,
   tagged `signal: signin-canary`, with no address in it. A request Supabase refused raises the same
   message, tagged `stage: request`.

A failure means sign-in mail did not reach the inbox within 5 minutes: Supabase Auth, its SMTP
settings, Resend, or Resend's webhook into `/api/webhooks/resend`.

Before setting `SIGNIN_CANARY_TO` (questions Q4):

- **Supabase's email rate limit.** With custom SMTP, Auth caps sign-in mail per hour for the whole
  project. The canary sends 6 an hour: read the current value (Auth → Rate Limits) and raise it by at
  least 6.
- **The address** is a real mailbox and an existing user. Mark its account internal
  (`pnpm ops:internal <account-id>`) so the digests leave it out.
- **Resend's webhook** stays subscribed to `email.delivered`. If it is not, the canary raises its
  signal on its runs: it fails loud.

Then add a Sentry issue alert on the `signin-canary` message, as for the other signals.
