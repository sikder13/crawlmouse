# Inngest execution budget

<!-- Rendered by scripts/golive/budget-doc.ts from scripts/golive/budget.ts. Do not edit by hand:
     change the model and run `pnpm --filter @crawlmouse/scripts exec tsx golive/budget-doc.ts --write`. -->

Inngest's Hobby plan allows 50,000 executions a month. Each function run is one
execution and each step (`step.run`, `step.sleep*`, `step.waitForEvent`, `step.sendEvent`,
`step.invoke`) is one more. When the quota is used, every function pauses until the next month or an
upgrade: v1's audits, the checks, the mail and the crons alike (inngest.com/pricing, read 2026-11-13).

How the numbers are made: a check is counted by running the real `runCheck` (`inngest/check.ts`)
against a scripted worker with a counting `step` (`checkExecutions`). Every other function's steps
are a row of `FUNCTIONS`. `scripts/golive/budget.test.ts` fails when a file's step call sites differ
from the sum of its rows' call sites, when a cron row's schedule differs from the cron literal in
its file (its runs a day are read from that schedule), when a line an event row cites holds no step
call, and when this file differs from its render. An event row's steps a run are written by hand
from the step calls it cites; no test derives that number from the code.

## The fixed floor: crons with nothing due, all four flags on, 31 days

| Function                            | File                        | Registered with              | Schedule            | Steps when idle                                                                      | Executions a day |
| ----------------------------------- | --------------------------- | ---------------------------- | ------------------- | ------------------------------------------------------------------------------------ | ---------------- |
| `crawlmouse.stripe-reconcile`       | `inngest/billing.ts`        | v1                           | cron `0 3 * * *`    | 2 (reconcile-dry-run; reconcile-accounts in v2 mode (V2_BILLING=1), counted here)    | 3                |
| `crawlmouse.audits-ttl-cleanup`     | `inngest/billing.ts`        | v1                           | cron `0 4 * * *`    | 2 (delete-expired, prune-rate-limits)                                                | 3                |
| `crawlmouse.check.reaper`           | `inngest/check-reaper.ts`   | V2_PIPELINE                  | cron `*/10 * * * *` | 1 (reap)                                                                             | 288              |
| `crawlmouse.check.expiry`           | `inngest/check-expiry.ts`   | V2_PIPELINE                  | cron `17 5 * * *`   | 2 (expire-unkept, settle-kept)                                                       | 3                |
| `crawlmouse.billing.past-due-sweep` | `inngest/past-due-sweep.ts` | V2_BILLING                   | cron `0 * * * *`    | 2 (now, candidates; then two per due account, none when nothing is due)              | 72               |
| `crawlmouse.account.purge-deleted`  | `inngest/deletion.ts`       | V2_CHECKS_PUBLIC             | cron `30 3 * * *`   | 2 (now, due; then one per person due)                                                | 3                |
| `crawlmouse.mail.contact-purge`     | `inngest/mail.ts`           | V2_CHECKS_PUBLIC             | cron `43 5 * * *`   | 1 (purge)                                                                            | 2                |
| `crawlmouse.schedule.tick`          | `inngest/schedule.ts`       | V2_PIPELINE+V2_CHECKS_PUBLIC | cron `0 * * * *`    | 2 (pause-gate, claim-0; then request:{site} per site claimed (counted per re-check)) | 72               |
| `crawlmouse.summary.tick`           | `inngest/summary.ts`        | V2_PIPELINE+V2_CHECKS_PUBLIC | cron `11 * * * *`   | 2 (clock, due-0; then request-{page} when a page has summaries due)                  | 72               |

**Floor: 16,058 executions a month.** v1's own crons are 186 of it, counted as
they run with V2_BILLING on (the reconcile's second step); with every flag off they are one step fewer a day.

### The floor after each switch-on step

| After setting                                              | Floor a month |
| ---------------------------------------------------------- | ------------- |
| V2_PIPELINE                                                | 9,207         |
| V2_PIPELINE, V2_ACCOUNT_DOOR                               | 9,207         |
| V2_PIPELINE, V2_ACCOUNT_DOOR, V2_CHECKS_PUBLIC             | 13,826        |
| V2_PIPELINE, V2_ACCOUNT_DOOR, V2_CHECKS_PUBLIC, V2_BILLING | 16,058        |

A cron registered under two flags (`V2_PIPELINE+V2_CHECKS_PUBLIC`) starts with the second of them.

## Event functions, per event

| Function                             | File                         | Registered with              | Trigger                                              | Steps a run                                                                         | Step calls                                                                                                                                                                                              |
| ------------------------------------ | ---------------------------- | ---------------------------- | ---------------------------------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `crawlmouse.audit`                   | `inngest/audit.ts`           | v1                           | audit.requested                                      | 5 (pause-gate, mark-crawling, crawl-and-persist, emit-completed, send-notify-email) | `inngest/audit.ts:357`, `inngest/audit.ts:361`, `inngest/audit.ts:376`, `inngest/audit.ts:378`, `inngest/audit.ts:386`                                                                                  |
| `crawlmouse.stripe-reconcile-manual` | `inngest/billing.ts`         | v1                           | billing.reconcile.requested                          | 1 (reconcile)                                                                       | `inngest/billing.ts:95`                                                                                                                                                                                 |
| `crawlmouse.check.run`               | `inngest/check.ts`           | V2_PIPELINE                  | check.requested                                      | see the check shapes                                                                | measured                                                                                                                                                                                                |
| `crawlmouse.check.cancelled`         | `inngest/check.ts`           | V2_PIPELINE                  | inngest/function.cancelled (checkFn)                 | 2 (fail, emit-failed)                                                               | `inngest/check.ts:445`, `inngest/check.ts:447`                                                                                                                                                          |
| `crawlmouse.trial.lifecycle`         | `inngest/trial-lifecycle.ts` | V2_BILLING                   | trial.started                                        | 6 (reminder-due, remind, remind-effects, trial-ends, expire, expire-effects)        | `inngest/trial-lifecycle.ts:87`, `inngest/trial-lifecycle.ts:89`, `inngest/trial-lifecycle.ts:99`, `inngest/trial-lifecycle.ts:102`, `inngest/trial-lifecycle.ts:103`, `inngest/trial-lifecycle.ts:113` |
| `crawlmouse.account.deletion-cancel` | `inngest/deletion.ts`        | V2_CHECKS_PUBLIC             | account.deletion_confirmed                           | 1 (cancel)                                                                          | `inngest/deletion.ts:73`                                                                                                                                                                                |
| `crawlmouse.account.deletion-resume` | `inngest/deletion.ts`        | V2_CHECKS_PUBLIC             | account.restored                                     | 1 (resume-{id}, one per subscription)                                               | `inngest/deletion.ts:85`                                                                                                                                                                                |
| `crawlmouse.mail.account`            | `inngest/mail.ts`            | V2_CHECKS_PUBLIC             | email.requested                                      | 1 (send)                                                                            | `inngest/mail.ts:88`                                                                                                                                                                                    |
| `crawlmouse.mail.check-notify`       | `inngest/mail.ts`            | V2_CHECKS_PUBLIC             | check.notify_requested, check.finished, check.failed | 1 (send)                                                                            | `inngest/mail.ts:99`                                                                                                                                                                                    |
| `crawlmouse.mail.fix-to-developer`   | `inngest/mail.ts`            | V2_CHECKS_PUBLIC             | fix.email_developer_requested                        | 1 (send)                                                                            | `inngest/mail.ts:110`                                                                                                                                                                                   |
| `crawlmouse.events.check-finished`   | `inngest/mail.ts`            | V2_CHECKS_PUBLIC             | check.finished                                       | 1 (capture)                                                                         | `inngest/mail.ts:126`                                                                                                                                                                                   |
| `crawlmouse.alert.dispatch`          | `inngest/alerts.ts`          | V2_PIPELINE+V2_CHECKS_PUBLIC | check.finished                                       | 1 (plan; then one per channel ('email', 'slack') when an alert fires)               | `inngest/alerts.ts:51`, `inngest/alerts.ts:57`                                                                                                                                                          |
| `crawlmouse.summary.send`            | `inngest/summary.ts`         | V2_PIPELINE+V2_CHECKS_PUBLIC | summary.requested                                    | 1 (send)                                                                            | `inngest/summary.ts:88`                                                                                                                                                                                 |

A finished check starts three of them (the alert planner, the notify mail, the capture): 6 executions.
One alert that fires on both channels: 4. One mail: 2.

## One check, by shape

The shapes come from production's v1 audits completed in the 30 days to 2026-11-13 (72 audits; median
27 pages in 14 s, 90th percentile 195 pages in 247 s), read with:

```sql
select count(*), percentile_disc(0.5) within group (order by page_count),
  percentile_disc(0.9) within group (order by page_count),
  percentile_disc(0.5) within group (order by extract(epoch from (completed_at - started_at))),
  percentile_disc(0.9) within group (order by extract(epoch from (completed_at - started_at)))
from audits where status = 'completed' and started_at > now() - interval '30 days';
```

A v1 audit's time is not a v2 batch's time; the worker's own batch times are not yet measured on
production, so the shapes stand in for them until they are.

| Shape             | Why                                                                                                                                                                                                                                                                                                                                                                                                          | checkFn run | First check | Scheduled re-check |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------- | ----------- | ------------------ |
| typical           | v1's median audit: 27 pages, one crawl batch, 14 s; access stage 1 only                                                                                                                                                                                                                                                                                                                                      | 22          | 28          | 29                 |
| large             | v1's 90th percentile: 195 pages, four crawl batches, 247 s in all; both access stages                                                                                                                                                                                                                                                                                                                        | 69          | 75          | 76                 |
| heaviest searched | the most executions of 48 shapes tried (claim waits 0 or 5; 0, 1, 20 busy answers a post; batches done at 5, 15, 35, 299 s; a first read that finds the batch gone, or not), all 40 crawl batches and both access stages, cut at the 20-minute finish timeout. This one: 0 claim waits, 0 busy a post, batches of 15 s, each re-posted once. Not a bound: batches that differ from one another are not tried | 485         | 491         | 492                |

A run that passes its finish timeout is counted to the sleep that passes it, and Inngest cancels
it there; the table still adds the fan-out of a finished check to it, where the real run would
start `crawlmouse.check.cancelled` and the failed-check mail instead.

## A month, against the quota

| Checks a month | typical | large   | heaviest searched |
| -------------- | ------- | ------- | ----------------- |
| 100            | 18,858  | 23,558  | 65,158            |
| 1,000          | 44,058  | 91,058  | 507,058           |
| 5,000          | 156,058 | 391,058 | 2,471,058         |

Every figure is a clean run: a step that fails and is retried is one more execution, and an
`onFailure` handler's run and steps are more again. The totals are a floor under real traffic.

v1's audits are left out of the table: each is one run and five steps (`crawlmouse.audit`), and
the brief measured 85 audits in production in the 30 days to 2026-11-13 (F2).

## The rule (CC-35 D2)

The floor plus 1,000 typical checks is **44,058** against the line of 40,000.
**It is over the line: `golive:check` reports the Hobby plan as a failing precondition of `V2_PIPELINE`, and the owner decides the plan (Pro starts at $99 a month for 1M executions) before step 2.**

The largest part of the floor is `crawlmouse.check.reaper` every ten minutes (8,928 a month).

## Not confirmed on a running app

No figure here was read from an Inngest run's step list: CC-35 holds no Inngest credential, for
staging or production. The count is confirmed against the code (the simulation runs the real
orchestration) and not yet against Inngest's own run history. The first
check after step 2 is the place to confirm it: Inngest → Runs → the check's run → its step list.
