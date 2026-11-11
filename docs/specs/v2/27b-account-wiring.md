# CC-27b — account settings, email change, deletion with restore, trial ending

The routes `docs/specs/v2/27-account-screens.md` ("The CC-27b wiring") lists as CC-27b's, built on the
signed-in viewer's account. Everything here is behind `V2_CHECKS_PUBLIC` (`checksPublicEnabled`,
`apps/web/lib/auth/flags.ts`); with it unset, each route and page below answers 404 and nothing v1 changes.

## Decisions

| #   | Decision                                                                                                                                                                                                                                                                                                                 | Where it is in the code                                                                         |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| D1  | One flag, `V2_CHECKS_PUBLIC`, gates every route and page here, and the purge function's registration.                                                                                                                                                                                                                    | each route's and page's first statement; `lib/v2/pipeline/functions.ts`                         |
| D2  | Every state-changing route checks the session's role (`member_role`) before any service-role call, carries `origin: 'strict'`, is a `ROUTE_POLICIES` row, and answers 404 for another account's row.                                                                                                                     | `lib/security/route-policy.ts` rows; each route                                                 |
| D3  | Email change: owner only; a single-use, expiring, hashed confirmation token for the new address and a hashed undo token for the old one; confirm and undo are POSTs from rendered pages; applied through Supabase Auth's admin update; other sessions ended; rate limited per user and per IP.                           | `lib/v2/account/email-change.ts`; `app/api/account/email/**`; `app/(account)/account/email*/**` |
| D4  | Deletion in two stages with a seven-day restore: request (hostname re-typed) → confirm (POST: account marked, Stripe cancel through CC-03's path, sign-in banned, sessions ended) → restore (POST, within the window) → `purgeDeletedAccountsFn` erases at the window's end. The Auth user is deleted only by the purge. | `lib/v2/account/deletion.ts`; `inngest/deletion.ts`                                             |
| D5  | One erasure implementation, shared by `scripts/ops/erase-account.ts` and the purge.                                                                                                                                                                                                                                      | `lib/v2/account/erase.ts`; migration `20261112000002` section B                                 |
| D6  | `/settings`, `/settings/plan`, `/settings/delete` on real data; each field validated server-side by the schema its route uses.                                                                                                                                                                                           | `app/(account)/settings/**`                                                                     |
| D7  | `PUT /api/alert-rules`: the account's rules; a Slack webhook URL kept in Supabase Vault, never returned after saving (the page shows that one is set and its last four characters).                                                                                                                                      | `app/api/alert-rules/route.ts`; migration section C                                             |
| D8  | `/trial-ended`: one page for both states, from the account's real state and dates.                                                                                                                                                                                                                                       | `app/(account)/trial-ended/page.tsx`                                                            |
| D9  | Server-side events through `captureServerEvent`, gated by `serverCaptureAllowed`; the three emails emitted as `email.requested` (CC-28 sends).                                                                                                                                                                           | `lib/v2/account/account-events.ts`                                                              |
| D10 | Out of this step: reports, exports, report download and share (wave 2, with the agency workspace), seats and roles (CC-31), alert sending and unsubscribe headers (CC-28), cancel and portal (CC-03, built).                                                                                                             |                                                                                                 |

## Routes

Pages are in the `(account)` group, whose layout sets `noindex` and per-request rendering for each of them;
`__tests__/v2/preview-guard.test.ts` lists the group's files. Each API row is in `ROUTE_POLICIES`
(`lib/security/route-policy.ts`), which `__tests__/security/route-policy.test.ts` holds to the files on disk.

| Path                                                                                                           | Verb                          | Who                                       | What                                                                                                                   |
| -------------------------------------------------------------------------------------------------------------- | ----------------------------- | ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `/api/account`                                                                                                 | PATCH (form: POST `_method`)  | owner or account manager                  | `{name, timezone, email_prefs}`; a changed `newEmail` from the owner starts the email change, from anyone else 403     |
| `/api/account`                                                                                                 | DELETE (form: POST `_method`) | owner                                     | `hostname` re-typed; creates the deletion's links and asks the mailer to send them; deletes nothing                    |
| `/api/account/email`                                                                                           | POST                          | owner                                     | `newEmail`; creates the confirmation link (new address) and the undo link (old address)                                |
| `/account/email/[token]`, `/account/email-undo/[token]`, `/account/delete/[token]`, `/account/restore/[token]` | GET                           | the link's holder                         | moves the token into its cookie (`link-cookie.ts`) and redirects to the page with no token in its URL; changes nothing |
| `/account/email`, `/account/email-undo`, `/account/delete`, `/account/restore`                                 | GET                           | the link's holder                         | says what the button does; the form posts to the flow's API route                                                      |
| `/api/account/email/confirm`, `/api/account/email/undo`, `/api/account/delete/confirm`, `/api/account/restore` | POST                          | the link's holder (token from the cookie) | apply the change, stop or revert it, confirm the deletion, restore the account                                         |
| `/api/alert-rules`                                                                                             | PUT (form: POST `_method`)    | any member                                | one account-level rule's switch; set, replace or clear the Slack webhook (paid tier); answers `{slack: {set, last4}}`  |
| `/settings`                                                                                                    | GET                           | owner or account manager                  | profile, email kinds, plan card, danger zone                                                                           |
| `/settings/plan`                                                                                               | GET                           | owner                                     | the plan, with an account that holds no site, and a cancelled plan until its period ends                               |
| `/settings/delete`                                                                                             | GET                           | owner                                     | the hostname step and the accounts the deletion removes                                                                |
| `/trial-ended`                                                                                                 | GET                           | member                                    | the trial before its end, or back on Free after it                                                                     |

Moved out of this step (D10): `reports`, `reportDownload` and `reportShare` go to wave 2 with the agency
workspace; seats and roles to CC-31; alert sending and unsubscribe headers to CC-28.

Inngest, registered only with `V2_CHECKS_PUBLIC=1` (`lib/v2/pipeline/functions.ts`): `deletionCancelFn` and the
resume on `account.deletion_confirmed` and on a restore, and `purgeDeletedAccountsFn` (daily, concurrency 1).
With the flag unset during a window, the purge is not registered and the link routes answer 404: nothing is erased
and nothing can be restored until the flag is back.

## Owner rulings

2026-11-10. Approved as recommended:

- **Q1.** Each emailed link is a route that moves its token into a cookie and redirects to a page with no token in its URL; the page's form posts to an API route.
- **Q2.** The erasure's rules are SQL functions, with one TypeScript sequence that the script and the purge both call.
- **Q3.** `end_user_sessions`, and the Auth audit-log rule moved from the script, are the two pieces of SQL that touch `auth`.
- **Q4.** `account_events` is a minimal table with no addresses.
- **Q6.** The five event names.
- **Q8.** The undo link works after the change is applied.
- **Q9.** A v1 subscription, or another seated member, refuses the deletion request.
- **Q11.** `lib/auth/stores.ts` gets the deletion-mark filter in the next step that edits it.
- **Q12.** `trialLifecycleFn` is cancelled by `account.deletion_confirmed`.

Approved with a change:

- **Q5.** No raw token at rest. A link's row has no hash until the mailer calls `issue_account_link`, which mints the token, stores its sha256 and returns it with the recipient. A retried send re-mints, and the earlier token stops working. `email.requested` is `{accountId, template, tokenId}`; the deletion email's restore link is the row paired with its confirm link.
- **Q7.** At confirm the plan ends at its period end through CC-03's path; at purge it is cancelled at once with no proration. The copy follows the published refund policy and promises nothing beyond it.
- **Q10.** The undo deletes an Auth user holding the old address only when all of these hold: it was created after the change was applied; it has no seat; it has no rows in `audits`, `sessions` or `accounts`; it is not banned. Otherwise the undo refuses, reports to Sentry, and the page sends the person to support. Round 2, Q13: since sign-up gives every user an owner seat and a personal account, "no seat" and "no rows in `accounts`" are read as nothing beyond what sign-up gave it (one personal Free account, no Stripe customer, no other seat, no site).

Round 2 (2026-11-11), approved as built or recommended: **Q13** (the reading of Q10 above); **Q14** (the money copy
quotes the Terms' refund sentence, pinned to the Terms by a test; the 14-day annual refund is an owner change to
the Terms at switch-on, and the copy follows it in that commit); **Q15** (`changeLog` and the per-site `alertRules`
are CC-28's, `integrations` a later page; `ACCOUNT_ACTIONS` says so).

Round 3 (2026-11-11): **Q16** (Settings' deletion copy names the restore link and what the erasure keeps) and **Q17**
(Trial ending's reminder line says when it is due, and nothing once its day has passed) approved as built.

**Production prechecks** (`docs/ops/erasure.md` §8), run read-only on production by the owner on 2026-11-11 at about
08:00: `postgres` may delete `auth.sessions` and `auth.refresh_tokens`; `supabase_vault` is installed; `anon` and
`authenticated` hold no table privilege in schema `vault`; `auth.refresh_tokens` → `auth.sessions` is `on delete
cascade`. The owner re-checks them on the dry-run branch.

No page here shares a path with a v1 page, so `V2_REWRITES` gains no row.

## Known gaps

- The rail's trial card offers Billing and Keep to the owner only when its page passes the reader's
  role (`accountShellView(…, { role })`). This step's pages do: `/settings`, `/settings/plan`,
  `/settings/delete`, `/trial-ended`. The callers that pass none read every member as the owner:
  `dashboard.ts` and `site.ts` and the page `app/sites/[id]/page.tsx` (CC-26b), `alerts.ts`,
  `changes-log.ts` and `reports.ts` (CC-28 and the agency-workspace step), and the preview, which
  renders fixtures. Each can pass `readerRole(v)` (`lib/v2/view/account.ts`), which CC-26b added.
  Callers: `grep -rn "accountShellView(" apps/web/lib apps/web/app --include=*.ts --include=*.tsx | grep -v test`.
- Nothing is emailed until CC-28's mailer handles `email.requested` for the three account templates and calls
  `issue_account_link`. Until then a request creates its link rows and they expire unused.
- The scheduler of v2 checks does not exist yet (CC-28): it must skip accounts with `deletion_confirmed_at` set.
- The past-due sweep (`lib/billing/clock.ts`) and `lib/auth/stores.ts` `loadMember` do not read the deletion mark;
  both are for the next step that edits those files (Q11, and the ledger in the step's notes).
- An access token issued before a deletion's confirm stays valid to its expiry (at most an hour) against v1 tables,
  whose policies read `auth.uid()` alone; v2 tables refuse it through the membership functions.
- Before the first apply, on the dry-run branch, the owner re-checks the prechecks recorded under Owner rulings
  (`docs/ops/erasure.md` §8); production passed them on 2026-11-11.
- If Inngest refuses `account.deletion_confirmed` three times in the confirm's request, the deletion still stands
  and Sentry is told (user id only), but no `deletionCancelFn` runs: an `active` plan is not set to end during the
  window, and can renew in it. The purge cancels it at once, with no proration, before it erases.
- A `past_due`, `unpaid` or `paused` subscription is not ended at confirm (a restore could not bring it back), so
  Stripe's payment retries can still charge it during the window; the purge cancels it at once, with no proration.
- No seat can be added in this tree, so an account marked for deletion gains no member during its window. CC-31's
  invitations must refuse a marked account; the purge's check that it erases only marked accounts (`accounts_changed`)
  assumes so.
- `PUT /api/alert-rules` sends a refused form back to `/alerts?error=<code>`; there is no live Alerts page yet, and
  CC-28's must read the code as Settings does (`lib/v2/copy/settings-notices.ts`).
- `PATCH /api/account`: when the owner's email change is accepted and the profile write after it then fails, the
  answer is a 500 while the change's links are already created.
- The erasure's `v1_subscription` refusal reads `users.pro_until` in SQL (`erase_person_refusals`); migration 009,
  which drops the column, must delete that refusal. Spec 01's scan of v1 entitlement readers covers TypeScript only, so
  it no longer lists the erasure.
