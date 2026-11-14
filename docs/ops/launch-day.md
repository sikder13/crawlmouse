# Launch day — the first 24 hours

v2 goes live for everyone at once, with no beta (owner decision, 2026-11-13). This page is what is
watched after the switch, and the lines that end it. The abort lines are written here, before the
launch, so that no one decides them during it.

Before the first step, the go/no-go list holds (`docs/ops/go-no-go.md`,
`pnpm golive:check -- --go-no-go --step 5`).

## The switch order

`docs/ops/go-live.md` is the order and the only source of it: step 1 (the production worker), then
`V2_PIPELINE`, `V2_ACCOUNT_DOOR`, `V2_CHECKS_PUBLIC` and `V2_BILLING`, one flag per step, each with
its check (`pnpm golive:check -- --step <N>`), its smoke table, its 30-minute watch and its rollback.
The titles come from `scripts/golive/steps.ts` (`STEP_TITLE`). This page does not repeat them: the
24 hours below start when step 5's 30-minute watch has passed.

Who: the **owner** (UD) switches each step and makes each abort decision. The **CTO** watches beside
the owner and calls an abort line when one is crossed; on a wrong-account view (below) either one rolls
back first and tells the other after.

## The 24-hour watch

Look at each row at the times in the last column. A row that crosses an abort line goes to
[Abort lines](#abort-lines) at once, whatever the time.

| What                  | Where                                                                                                                                    | Who   | When                                               |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ----- | -------------------------------------------------- |
| Sentry issues         | Sentry → `crawlmouse` → Issues, first seen in the last hour, then the tagged signals listed below                                        | CTO   | each hour for the first 6, then at hours 12 and 24 |
| The `signal:*` alerts | Sentry → Alerts: each rule for a signal below; its mail                                                                                  | owner | as each alert arrives                              |
| Inngest failures      | Inngest → Runs, status Failed, production app                                                                                            | CTO   | each hour for the first 6, then at hours 12 and 24 |
| The Inngest budget    | Inngest → Usage (executions this month) against the line in `docs/ops/inngest-budget.md`                                                 | CTO   | at hours 1, 6, 12 and 24                           |
| Stripe events         | Stripe → Developers → Webhooks → the live endpoint for `/api/webhooks/stripe-account`: failed deliveries; Stripe → Events                | owner | each hour for the first 6, then at hours 12 and 24 |
| Founder notices       | the `FOUNDER_NOTIFY_TO` mailbox: sign-ups, agency accounts, cancellations (CC-33; notices about internal accounts are prefixed `[TEST]`) | owner | as they arrive                                     |
| `/status`             | `https://crawlmouse.com/status`                                                                                                          | CTO   | each hour for the first 6, then at hours 12 and 24 |
| 5xx answers           | Vercel → `crawlmouse-001` → Observability, status 5xx, against the hour before step 2                                                    | CTO   | each hour for the first 6, then at hours 12 and 24 |
| Check failure rate    | the query under [Check failure rate](#check-failure-rate)                                                                                | CTO   | each hour for the first 6, then at hours 12 and 24 |

### The Sentry signals

A signal is the `signal` tag on a Sentry event; an alert rule matches it. The tags set in this tree
(each `signal` property of a `tags` object literal in the non-test source of `apps/web`, `inngest`
and `packages`, read with the TypeScript parser, so a tag written over several lines counts), listed
by:

```bash
pnpm --filter @crawlmouse/scripts exec tsx golive/signals.ts
```

<!-- launch-day:signals:start -->

Set as a literal:

- `audit-failed`
- `crawl-degraded`
- `landing-failed`
- `reconcile-drift`
- `schedule-claim`
- `stripe-account-webhook`
- `stripe-account-webhook-sig-fail`
- `stripe-webhook-sig-fail`
- `verify-threw`

Set from a value, so the name is read from the file:

- `apps/web/app/api/agency-trial/route.ts` (the message passed to its `report`)
- `apps/web/app/api/billing/checkout/route.ts` (the message passed to its `report`)
- `apps/web/lib/auth/stores.ts` (the signal passed to `sentryReport`'s report)
- `apps/web/lib/billing/effect-sinks.ts` (`billing-` and the alert's reason)
- `apps/web/lib/v2/account/email-change-ports.ts` (the signal passed to its `report`)

<!-- launch-day:signals:end -->

The list between the markers is pinned to that reading by
`pnpm --filter @crawlmouse/scripts exec vitest run golive/launch-day.test.ts`. CC-33 adds
`signin-canary` and `founder-notice-failed` (`docs/ops/uptime.md` on its branch); the test fails
until they are listed here, once CC-33 is on `origin/main`.

### Check failure rate

Supabase → SQL editor, production, read-only:

```sql
select count(*) filter (where status = 'failed') as failed,
       count(*) as ended,
       round(100.0 * count(*) filter (where status = 'failed') / nullif(count(*), 0), 1) as failed_pct
from public.checks
where finished_at > now() - interval '1 hour';
```

A check's `finished_at` is set when its status is `finished`, `partial` or `failed`, and only then
(the table's constraint: `sed -n 187,188p infra/supabase/migrations/20261102000001_v2_003_sites_checks.sql`),
so the count is of the checks that ended in the hour. Once CC-33 is on `origin/main`, leave the internal accounts'
checks out by adding `left join public.sites s on s.id = checks.site_id left join public.accounts a
on a.id = s.account_id` and `and coalesce(a.internal, false) = false`.

## Abort lines

The lines are the owner's (CC-38 brief, D6). Crossing one is an abort. The rollback is the one
`docs/ops/go-live.md` gives (_Off, in a minute_): Vercel → Deployments → the production deployment
from the step before → ⋯ → _Instant Rollback_, then resync Inngest, then unset that step's variable.
During the 24 hours the five steps are on, so the step before is step 4's deployment (before
`V2_BILLING`). If the line is still crossed after the resync, the next step back is a new decision,
made the same way.

| Line                                   | How it is seen                                                                                                                                                                                                                                                         | Rollback                                                                                                                                                                    | Who decides                                                                       |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Sign-in canary red for 10 minutes      | `signal:signin-canary` in Sentry. The canary is CC-33's, on cron `*/10 * * * *` (`grep -n cron inngest/signin-canary.ts` once CC-33 is on `origin/main`), so 10 minutes is one failed run. With `SIGNIN_CANARY_TO` unset there is no canary: sign in by hand each hour | the step before                                                                                                                                                             | owner                                                                             |
| Check failure rate over 20% in an hour | `failed_pct` above 20 in the [query](#check-failure-rate)                                                                                                                                                                                                              | the step before                                                                                                                                                             | owner                                                                             |
| Any 5xx spike                          | Vercel Observability, 5xx against the hour before step 2; a Sentry issue whose events climb                                                                                                                                                                            | the step before                                                                                                                                                             | owner                                                                             |
| Any wrong-account data view            | a user's report or a support mail, an operator's own sight, or a Sentry event naming two accounts                                                                                                                                                                      | at once, to the step-3 deployment (before `V2_CHECKS_PUBLIC`, which serves the v2 dashboard and reports), then resync Inngest and unset `V2_CHECKS_PUBLIC` and `V2_BILLING` | whoever sees it rolls back first and tells the other; the owner decides what next |

The wrong-account line skips the step-by-step rule: a step back that leaves the v2 screens served
leaves the view open while the next decision is made (`notes/cc-38/questions.md`, Q9).

After an abort: go-live.md's _After a rollback_ says what a v2 user sees; `docs/ops/incident-plan.md`
is the incident path. A step goes on again from a fixed deployment, through its check.
