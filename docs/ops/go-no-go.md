# Go / no-go

<!-- Rendered by scripts/golive/go-no-go.ts from its GATES. Do not edit by hand:
     change the data and run `pnpm --filter @crawlmouse/scripts exec tsx golive/go-no-go.ts --write`. -->

v2 goes live for everyone, with no beta. It goes live when the gates below hold. The launch-day
watch and the abort lines are `docs/ops/launch-day.md`; the switch-on order is `docs/ops/go-live.md`.

Print the list with each gate's state:

```bash
pnpm golive:check -- --go-no-go --step 5 --ticked <id>,<id>
```

The go/no-go section is printed after the precondition rows and before the last line. The exit
code is the one `--step` gives without the flag: the walk, CI and owner gates do not change it.
The lines are pinned by `pnpm --filter @crawlmouse/scripts exec vitest run golive/go-no-go.test.ts`.

## The end-to-end walk

State: the spec's tests in `tests/e2e/results.json` (the Playwright JSON reporter's output), counted by Playwright's statuses (expected, unexpected, flaky, skipped): `failed` with an unexpected one, else `flaky` with a flaky one, else `skipped` with skipped tests only, else `passed`; `not run` without the file. The walk runs on a production build against the local stand-in with the four flags on, locally, not in CI.

| Id                 | Gate                                                                                                                                         | Where                           | Detail                                                                                    |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- | ----------------------------------------------------------------------------------------- |
| `walk-1-anonymous` | journey 1: anonymous check → result → fix → sign-up → first login                                                                            | `tests/e2e/1-anonymous.spec.ts` |                                                                                           |
| `walk-2-free`      | journey 2: Free: add a site, check, fix packet, mark done, re-check, before/after, the upgrade gate at the second site                       | `tests/e2e/2-free.spec.ts`      |                                                                                           |
| `walk-3-pro-trial` | journey 3: Pro trial → upgrade (the Checkout redirect, then the signed webhook) → Pro; cancel; restore                                       | `tests/e2e/3-pro-trial.spec.ts` |                                                                                           |
| `walk-4-agency`    | journey 4: Agency trial → six clients → a developer scoped to one, who sees only that one → client report → share link → proof page → revoke | `tests/e2e/4-agency.spec.ts`    | the developer's card and report-mint assertions are todo until CC-37 D5 is on origin/main |
| `walk-5-settings`  | journey 5: settings: email change, delete and restore                                                                                        | `tests/e2e/5-settings.spec.ts`  |                                                                                           |
| `walk-6-v1-urls`   | journey 6: the retired v1 URLs of CC-36's table answer as designed                                                                           | `tests/e2e/6-v1-urls.spec.ts`   | todo until CC-36 is on origin/main                                                        |
| `walk-7-support`   | journey 7: /help, /status, the error screen and the support link                                                                             | `tests/e2e/7-support.spec.ts`   |                                                                                           |

## The go-live check, by step

State: `pass` when the rows gating that step and the steps before it pass in the same run, as `--step N` decides it.

| Id              | Gate                                                                                                       | Where                     | Detail                                                                       |
| --------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------- | ---------------------------------------------------------------------------- |
| `golive-step-1` | golive:check passes for step 1 (deploy the production worker, record its egress, set the worker variables) | `scripts/golive/steps.ts` | `pnpm golive:check -- --step 1 --ticked <the manual rows once true>` exits 0 |
| `golive-step-2` | golive:check passes for step 2 (V2_PIPELINE=1)                                                             | `scripts/golive/steps.ts` | `pnpm golive:check -- --step 2 --ticked <the manual rows once true>` exits 0 |
| `golive-step-3` | golive:check passes for step 3 (V2_ACCOUNT_DOOR=1)                                                         | `scripts/golive/steps.ts` | `pnpm golive:check -- --step 3 --ticked <the manual rows once true>` exits 0 |
| `golive-step-4` | golive:check passes for step 4 (V2_CHECKS_PUBLIC=1)                                                        | `scripts/golive/steps.ts` | `pnpm golive:check -- --step 4 --ticked <the manual rows once true>` exits 0 |
| `golive-step-5` | golive:check passes for step 5 (V2_BILLING=1)                                                              | `scripts/golive/steps.ts` | `pnpm golive:check -- --step 5 --ticked <the manual rows once true>` exits 0 |

## CI

State: "check the release SHA's run": the check does not read GitHub.

| Id               | Gate                              | Where                      | Detail                                                                                      |
| ---------------- | --------------------------------- | -------------------------- | ------------------------------------------------------------------------------------------- |
| `ci-release-sha` | CI is green on the release commit | `.github/workflows/ci.yml` | the run of the commit production will serve: `gh run list --workflow ci.yml --commit <sha>` |

## Owner-ticked

State: "owner-ticked": the check cannot see it; the owner records each, with its date, in the launch notes.

| Id                       | Gate                                                                                              | Where                           | Detail                                                                                                 |
| ------------------------ | ------------------------------------------------------------------------------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `restore-drill`          | restore drill: last night's backup restored into a Supabase branch, and 3 known rows read from it | `docs/specs/v2/38-launch-qa.md` | the three rows chosen before the restore, read by id, their values compared                            |
| `load-staging`           | the k6 load run against staging at 20 concurrent checks                                           | `tests/load/README.md`          | staging only; `ls tests/load` lists no script that requests checks, so the run needs one written first |
| `self-audit`             | a self-audit of crawlmouse.com and nahltech.com on the staging worker, the result looked at       | `docs/ops/worker-runbook.md`    | each result read finding by finding; a wrong finding is a no-go                                        |
| `live-purchase`          | a real-card live purchase of Pro and of Agency, each refunded                                     | `docs/ops/go-live.md`           | after step 5; the plan reaches the account through the live webhook, then the refund                   |
| `cloudflare-ai-crawlers` | Cloudflare AI crawler controls set to Allow (Search, Agent and Training)                          | `docs/OPERATING-RULES.md`       | OPERATING-RULES §12; Managed robots.txt stays off                                                      |
| `provider-2fa`           | 2FA on the provider accounts named in Detail                                                      | `docs/specs/v2/38-launch-qa.md` | GitHub, Vercel, Supabase, Stripe, Cloudflare, Sentry, Namecheap, Google                                |
