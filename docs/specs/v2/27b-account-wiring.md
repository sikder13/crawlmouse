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

Recorded here when given; the questions and their recommendations are in the step's notes.

## Known gaps
