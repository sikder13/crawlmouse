# Inngest execution budget

<!-- Rendered by scripts/golive/budget-doc.ts from scripts/golive/budget.ts. Do not edit by hand:
     change the model and run `pnpm --filter @crawlmouse/scripts exec tsx golive/budget-doc.ts --write`. -->

Inngest's Hobby plan allows 50,000 executions a month. Each function run is one
execution and each step (`step.run`, `step.sleep*`, `step.waitForEvent`, `step.sendEvent`,
`step.invoke`) is one more. When the quota is used, every function pauses until the next month or an
upgrade: v1's audits, the checks, the mail and the crons alike (inngest.com/pricing, read 2026-11-13).

How the numbers are made: a check is counted by running the real `runCheck` (`inngest/check.ts`)
against a scripted worker with a counting `step` (`checkExecutions`). Every other function's steps
are a row of `FUNCTIONS`; `scripts/golive/budget.test.ts` recounts each file's step calls and fails
when a row disagrees, and fails when this file differs from its render.

## The fixed floor: crons with nothing due, all four flags on, 31 days

| Function                            | File                        | Registered with              | Schedule               | Steps when idle                                                                      | Executions a day |
| ----------------------------------- | --------------------------- | ---------------------------- | ---------------------- | ------------------------------------------------------------------------------------ | ---------------- |
| `crawlmouse.stripe-reconcile`       | `inngest/billing.ts`        | v1                           | cron '0 3 \* \* \*'    | 2 (reconcile-dry-run; reconcile-accounts in v2 mode (V2_BILLING=1), counted here)    | 3                |
| `crawlmouse.audits-ttl-cleanup`     | `inngest/billing.ts`        | v1                           | cron '0 4 \* \* \*'    | 2 (delete-expired, prune-rate-limits)                                                | 3                |
| `crawlmouse.check.reaper`           | `inngest/check-reaper.ts`   | V2_PIPELINE                  | cron '_/10 _ \* \* \*' | 1 (reap)                                                                             | 288              |
| `crawlmouse.check.expiry`           | `inngest/check-expiry.ts`   | V2_PIPELINE                  | cron '17 5 \* \* \*'   | 2 (expire-unkept, settle-kept)                                                       | 3                |
| `crawlmouse.billing.past-due-sweep` | `inngest/past-due-sweep.ts` | V2_BILLING                   | cron '0 \* \* \* \*'   | 2 (now, candidates; then two per due account, none when nothing is due)              | 72               |
| `crawlmouse.account.purge-deleted`  | `inngest/deletion.ts`       | V2_CHECKS_PUBLIC             | cron '30 3 \* \* \*'   | 2 (now, due; then one per person due)                                                | 3                |
| `crawlmouse.mail.contact-purge`     | `inngest/mail.ts`           | V2_CHECKS_PUBLIC             | cron '43 5 \* \* \*'   | 1 (purge)                                                                            | 2                |
| `crawlmouse.schedule.tick`          | `inngest/schedule.ts`       | V2_PIPELINE+V2_CHECKS_PUBLIC | cron '0 \* \* \* \*'   | 2 (pause-gate, claim-0; then request:{site} per site claimed (counted per re-check)) | 72               |
| `crawlmouse.summary.tick`           | `inngest/summary.ts`        | V2_PIPELINE+V2_CHECKS_PUBLIC | cron '11 \* \* \* \*'  | 2 (clock, due-0; then request-{page} when a page has summaries due)                  | 72               |

**Floor: 16,058 executions a month.** v1's own crons are 186 of it, counted as
they run with V2_BILLING on (the reconcile's second step); with every flag off they are one step fewer a day.

## Event functions, per event

| Function                             | File                         | Registered with              | Trigger                                              | Steps a run                                                                         |
| ------------------------------------ | ---------------------------- | ---------------------------- | ---------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `crawlmouse.audit`                   | `inngest/audit.ts`           | v1                           | audit.requested                                      | 5 (pause-gate, mark-crawling, crawl-and-persist, emit-completed, send-notify-email) |
| `crawlmouse.stripe-reconcile-manual` | `inngest/billing.ts`         | v1                           | billing.reconcile.requested                          | 1 (reconcile)                                                                       |
| `crawlmouse.check.run`               | `inngest/check.ts`           | V2_PIPELINE                  | check.requested                                      | see the check shapes                                                                |
| `crawlmouse.check.cancelled`         | `inngest/check.ts`           | V2_PIPELINE                  | inngest/function.cancelled (checkFn)                 | 2 (fail, emit-failed)                                                               |
| `crawlmouse.trial.lifecycle`         | `inngest/trial-lifecycle.ts` | V2_BILLING                   | trial.started                                        | 6 (reminder-due, remind, remind-effects, trial-ends, expire, expire-effects)        |
| `crawlmouse.account.deletion-cancel` | `inngest/deletion.ts`        | V2_CHECKS_PUBLIC             | account.deletion_confirmed                           | 1 (cancel)                                                                          |
| `crawlmouse.account.deletion-resume` | `inngest/deletion.ts`        | V2_CHECKS_PUBLIC             | account.restored                                     | 1 (resume-{id}, one per subscription)                                               |
| `crawlmouse.mail.account`            | `inngest/mail.ts`            | V2_CHECKS_PUBLIC             | email.requested                                      | 1 (send)                                                                            |
| `crawlmouse.mail.check-notify`       | `inngest/mail.ts`            | V2_CHECKS_PUBLIC             | check.notify_requested, check.finished, check.failed | 1 (send)                                                                            |
| `crawlmouse.mail.fix-to-developer`   | `inngest/mail.ts`            | V2_CHECKS_PUBLIC             | fix.email_developer_requested                        | 1 (send)                                                                            |
| `crawlmouse.events.check-finished`   | `inngest/mail.ts`            | V2_CHECKS_PUBLIC             | check.finished                                       | 1 (capture)                                                                         |
| `crawlmouse.alert.dispatch`          | `inngest/alerts.ts`          | V2_PIPELINE+V2_CHECKS_PUBLIC | check.finished                                       | 1 (plan; then one per channel ('email', 'slack') when an alert fires)               |
| `crawlmouse.summary.send`            | `inngest/summary.ts`         | V2_PIPELINE+V2_CHECKS_PUBLIC | summary.requested                                    | 1 (send)                                                                            |

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

| Shape   | Why                                                                                                                     | checkFn run | First check | Scheduled re-check |
| ------- | ----------------------------------------------------------------------------------------------------------------------- | ----------- | ----------- | ------------------ |
| typical | v1's median audit: 27 pages, one crawl batch, 14 s; access stage 1 only                                                 | 22          | 28          | 29                 |
| large   | v1's 90th percentile: 195 pages, four crawl batches, 247 s in all; both access stages                                   | 69          | 75          | 76                 |
| worst   | the constants' bound: every claim wait (5), all 40 crawl batches, both access stages, each batch done at its first poll | 186         | 192         | 193                |

## A month, against the quota

| Checks a month | typical | large   | worst   |
| -------------- | ------- | ------- | ------- |
| 100            | 18,858  | 23,558  | 35,258  |
| 1,000          | 44,058  | 91,058  | 208,058 |
| 5,000          | 156,058 | 391,058 | 976,058 |

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
