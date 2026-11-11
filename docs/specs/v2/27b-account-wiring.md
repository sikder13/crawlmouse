# CC-27b — account settings, email change, deletion with restore, trial ending

The routes `docs/specs/v2/27-account-screens.md` ("The CC-27b wiring") lists as CC-27b's, built on the
signed-in viewer's account. Everything here is behind `V2_CHECKS_PUBLIC` (`checksPublicEnabled`,
`apps/web/lib/auth/flags.ts`); with it unset, each route and page below answers 404 and nothing v1 changes.

## Decisions

| #   | Decision                                                                                                                                                                                                                                                                                                                 | Where it is in the code                                                              |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| D1  | One flag, `V2_CHECKS_PUBLIC`, gates every route and page here, and the purge function's registration.                                                                                                                                                                                                                    | each route's and page's first statement; `lib/v2/pipeline/functions.ts`              |
| D2  | Every state-changing route checks the session's role (`member_role`) before any service-role call, carries `origin: 'strict'`, is a `ROUTE_POLICIES` row, and answers 404 for another account's row.                                                                                                                     | `lib/security/route-policy.ts` rows; each route                                      |
| D3  | Email change: owner only; a single-use, expiring, hashed confirmation token for the new address and a hashed undo token for the old one; confirm and undo are POSTs from rendered pages; applied through Supabase Auth's admin update; other sessions ended; rate limited per user and per IP.                           | `lib/v2/account/email-change.ts`; `app/api/account/email/**`; `app/account/email/**` |
| D4  | Deletion in two stages with a seven-day restore: request (hostname re-typed) → confirm (POST: account marked, Stripe cancel through CC-03's path, sign-in banned, sessions ended) → restore (POST, within the window) → `purgeDeletedAccountsFn` erases at the window's end. The Auth user is deleted only by the purge. | `lib/v2/account/deletion.ts`; `inngest/purge-deleted-accounts.ts`                    |
| D5  | One erasure implementation, shared by `scripts/ops/erase-account.ts` and the purge.                                                                                                                                                                                                                                      | `lib/v2/account/erase.ts`; migration `20261112000002` section B                      |
| D6  | `/settings`, `/settings/plan`, `/settings/delete` on real data; each field validated server-side by the schema its route uses.                                                                                                                                                                                           | `app/settings/**`                                                                    |
| D7  | `PUT /api/alert-rules`: the account's rules; a Slack webhook URL kept in Supabase Vault, never returned after saving (the page shows that one is set and its last four characters).                                                                                                                                      | `app/api/alert-rules/route.ts`; migration section C                                  |
| D8  | `/trial-ended`: one page for both states, from the account's real state and dates.                                                                                                                                                                                                                                       | `app/trial-ended/page.tsx`                                                           |
| D9  | Server-side events through `captureServerEvent`, gated by `serverCaptureAllowed`; the three emails emitted as `email.requested` (CC-28 sends).                                                                                                                                                                           | `lib/v2/account/account-events.ts`                                                   |
| D10 | Out of this step: reports, exports, report download and share (wave 2, with the agency workspace), seats and roles (CC-31), alert sending and unsubscribe headers (CC-28), cancel and portal (CC-03, built).                                                                                                             |                                                                                      |

## Routes

Filled in as each is built.

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
- **Q10.** The undo deletes an Auth user holding the old address only when all of these hold: it was created after the change was applied; it has no seat; it has no rows in `audits`, `sessions` or `accounts`; it is not banned. Otherwise the undo refuses, reports to Sentry, and the page sends the person to support.

No page here shares a path with a v1 page, so `V2_REWRITES` gains no row.

## Known gaps
