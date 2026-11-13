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
`SIGNIN_CANARY_TO` is one plain address, whatever the v2 flags (`apps/web/lib/v2/ops/functions.ts`;
`pnpm --filter @crawlmouse/web exec vitest run lib/v2/ops/functions.test.ts`):

1. asks Supabase Auth for a sign-in link to that address (`requestSignInLink`, with
   `shouldCreateUser: false`, so the address must be an existing user);
2. waits 5 minutes;
3. looks for an `email_events` row of type `delivered` (`signin_delivery_seen`, migration
   `20261115000001_v2_033_operations.sql` §C) that is:
   - to that address, compared lower-cased;
   - from `SIGNIN_SENDER` (`apps/web/lib/auth/constants.ts`): the address inside a trailing `<…>`
     of the event's `data.from`, or the whole value, trimmed and compared lower-cased;
   - of a mail created at or after the request time less a minute, by the event's own
     `data.created_at` (when Resend created the mail), not the row's `created_at` (when the webhook
     arrived). The minute allows for a difference between our clock and Resend's.

   An event whose `data.created_at` is missing, or is not shaped as an ISO 8601 time, is not
   counted. None found: Sentry `captureMessage('signin-canary')` at level `error`, tagged
   `signal: signin-canary` and `stage: delivery`, with no address in it.

The same message is raised, under another `stage`, when a request Supabase refused (`request`), or
when asking for the link (`request_error`) or looking for the delivery (`look_error`) throws after
Inngest's retries, for example while the migration that adds `signin_delivery_seen` is not applied;
the run then ends failed.

A signal is sent in an Inngest step of its own (`report-<stage>`), after the step that found its
reason, and that step throws when Sentry does not flush the message in time (`reportCanary`,
`apps/web/lib/v2/ops/canary.ts`). While Sentry is failing, Inngest retries the report step alone:
the link is not asked for again and the delivery is not looked for again. When its retries are
used, the run ends failed with the flush error and raises no `look_error`, so a failed run with no
signal points at Sentry. Verify: `pnpm --filter @crawlmouse/inngest exec vitest run signin-canary.test.ts`.

`delivered` is Resend's `email.delivered`: Resend handed the mail to the receiving mail server and it
was accepted. A `delivery` signal means no such acceptance was recorded within 5 minutes: Supabase
Auth, its SMTP settings, Resend, or Resend's webhook into `/api/webhooks/resend` failed.

### What the canary does not see

- **Where the mail landed.** A link filed as spam or held in a quarantine counts as delivered.
- **A delivery whose event has no `data.created_at`.** It is not counted, so if Resend's events stop
  carrying it, each run raises `delivery` while mail is arriving.
- **The link working.** Nothing opens it, so `/login/verify` and its `token_hash` exchange are not
  exercised.
- **The magic-link route and its Turnstile.** The canary asks Supabase Auth directly; a route that
  answers 5xx, or a Turnstile that refuses everyone, does not fail it (questions Q4). The monitors
  above do not see the route either.

Before setting `SIGNIN_CANARY_TO` (questions Q4):

- **Supabase's email rate limit.** With custom SMTP, Auth caps sign-in mail per hour for the whole
  project. The canary sends 6 an hour: read the current value (Auth → Rate Limits) and raise it by at
  least 6.
- **The address** is a real mailbox and an existing user. Mark its account internal
  (`pnpm ops:internal <account-id>`) so the digests leave it out.
- **Resend's webhook** stays subscribed to `email.delivered`. If it is not, the canary raises its
  signal on its runs: it fails loud.
- **The stored events carry the mail's time.** Step 3 counts a delivery only by its
  `data.created_at`. Count, read-only, the delivered rows from the sign-in sender and those of them
  carrying a time-shaped `data.created_at` (set `sender` to `SIGNIN_SENDER`'s value):

  ```sql
  with sender as (select 'magic@crawlmouse.com'::text as address)
  select count(*) as delivered_from_sender,
         count(*) filter (
           where e.payload -> 'data' ->> 'created_at'
                 ~ '^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}(:?\d{2})?)$'
         ) as with_mail_time
    from public.email_events e, sender
   where e.event_type = 'delivered'
     and lower(btrim(coalesce(substring(e.payload -> 'data' ->> 'from', '<([^<>]*)>\s*$'),
                              e.payload -> 'data' ->> 'from'))) = lower(sender.address);
  ```

  Equal counts mean the stored deliveries of sign-in mail carry the time. If
  `with_mail_time` is lower, do not set `SIGNIN_CANARY_TO`: those runs would raise `delivery`. A
  `delivered_from_sender` of 0 proves nothing; sign in once and run it again.

Then add a Sentry issue alert on the `signin-canary` message, as for the other signals.
