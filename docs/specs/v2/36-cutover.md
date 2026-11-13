# CC-36 — the v1 → v2 cutover, keyed on the flags

v2 goes live by switching four flags on in order (`docs/ops/go-live.md`): step 2 `V2_PIPELINE`,
step 3 `V2_ACCOUNT_DOOR`, step 4 `V2_CHECKS_PUBLIC`, step 5 `V2_BILLING`. A step is undone by an
Instant Rollback to the deployment before it, which brings back that deployment's environment. So
what a visitor meets is keyed on a flag: with the flags off a v1 URL or page behaves as it did before
this step, and with them on a visitor does not land on a v1 dead end or v1's look. Two changes are
not keyed on a flag, and each says why: D4's cleanup fix and the account backfill (D5).

The inventory this step works from is `docs/ops/v1-inventory.json` (CC-V1AUDIT, measured at
`ee11796d`; verified again on `b82a8e1f`, differences in "Verified" below).

## D1 — one table of retired addresses

`apps/web/lib/v2/cutover.ts` `V1_CUTOVER`, read by `apps/web/middleware.ts` before anything else
reads a request. A row answers only while every flag it names is on; otherwise the middleware does
what it did before and v1 serves the address.

| address                             | flags                             | answer                                                   |
| ----------------------------------- | --------------------------------- | -------------------------------------------------------- |
| `/compare`                          | `V2_CHECKS_PUBLIC`                | 308 `/`                                                  |
| `/compare/:a/:b`                    | `V2_CHECKS_PUBLIC`                | 308 `/audit/:a`                                          |
| `/top/:platform`                    | `V2_CHECKS_PUBLIC`                | 410, a small page drawn with the v2 tokens, linking home |
| `/billing`                          | `V2_CHECKS_PUBLIC`, `V2_BILLING`  | 307 `/settings/plan`                                     |
| `/api/trpc/*`                       | `V2_CHECKS_PUBLIC`                | 404 JSON                                                 |
| `/api/audits/start`                 | `V2_CHECKS_PUBLIC`, `V2_PIPELINE` | 410 JSON naming `/api/checks`                            |
| `/api/audits/:id/cancel`, `/notify` | `V2_CHECKS_PUBLIC`, `V2_PIPELINE` | 410 JSON naming the `/api/checks/<checkId>/…` route      |
| `/api/audits/:id/reaudit`           | `V2_CHECKS_PUBLIC`, `V2_PIPELINE` | 410 JSON, no replacement                                 |

Verify: `pnpm --filter @crawlmouse/web exec vitest run lib/v2/cutover.test.ts middleware.test.ts`.
`cutover.test.ts` fails when a retired page or route of the inventory has no row and is not one of
the exemptions it lists; `middleware.test.ts` walks each row with its flags on (the answer) and with
each of its flags off in turn (passed on, as before this step).

- **Why `/billing` waits for `V2_BILLING`.** Until step 5 it is v1's way to the Stripe portal, which
  the owner's v1 Pro uses; its target is served from step 4. It is a 307, not a 308: after a rollback
  `/settings/plan` is a 404, and a browser keeps a 308. `/billing` is not an indexed address.
- **Why `/top/:platform` is a 410, and from the middleware.** No leaderboard is indexable: the page
  is indexed at 10 qualifying reports (`app/top/[platform]/page.tsx`, `LEADERBOARD_MIN_INDEX`), and
  production holds at most 1 per platform (measured 2026-11-13). Next 15.5 drops a status set on a
  middleware rewrite (`next/dist/server/lib/router-utils/resolve-routes.js`, the rewrite branch), so
  the middleware returns the whole document; `cutover.test.ts` pins its colours to
  `styles/v2/tokens.css`.
- **Caching.** Each row's answer carries `Cache-Control: no-store` (`middleware.test.ts` checks it
  per row), so a browser does not keep a redirect or
  a 410 past the rollback that undoes its row. Both `/compare` pages are `noindex` today.
- **Spellings.** A row matches the path as sent and percent-decoded, with one trailing slash, and
  without an `.rsc` suffix; a path that does not decode is read as sent. A redirect row's `:name`
  takes `[A-Za-z0-9_-]+` (its value goes into the target); any other row's takes any characters.
- **tRPC.** No page or component calls a tRPC hook (`grep -rn "trpc\." apps/web/app apps/web/components`
  prints nothing); `app/layout.tsx` mounts the provider.
- **Not rows:** `/`, `/dashboard` and `/r/:slug` are rewrites (`lib/v2/rewrites.ts`); `/audit/[id]`
  branches in its page (a v2 check goes to its own page, a v1 audit is served).

## D2 — the v1 API routes

None is forwarded to its `/api/checks` counterpart. v2's start takes a `requestId` that a v1 client
does not send and answers `{checkId}` where v1 reads `{auditId}`; the `[id]` routes take a
`checks.id`, and a v1 id is an `audits.id`, so a forwarded call would be a 404 from v2. A 410 names
the route to call instead. Because the middleware answers first, the v1 handler is not reached and
no rate-limit bucket is spent; Turnstile and the limits of `/api/checks` are unchanged.

- **Kept as v1:** `/api/audits/:id/stream`, `/export`, `/llms-txt`. The v1 audit page, still served
  for a v1 audit, reads all three (`app/audit/[id]/AuditView.tsx`, `AuditSurfaceView.tsx`,
  `components/ai/LlmsTxtGenerator.tsx`; `cutover.test.ts` checks each caller). So inventory finding
  A-1 (the stream's unvalidated id and missing limit) is not closed by this step and goes to CC-37;
  A-11 (notify) is, from step 4.
- **The end date.** `API_ALIAS_LAST_DAY = '2027-02-15'`, 90 days after the earliest planned switch-on
  (2026-11-17). `cutover.test.ts` checks the predicate at injected dates, and one test reads the real
  clock and fails after that day. Then the `gone-api` rows, the v1 handlers they shadow and their
  inventory items are removed together: removing the rows alone fails the inventory-coverage test.

## D4 — v1 jobs and v1 data: kept, not migrated, not dropped

- `auditFn` and `cleanupExpiredAuditsFn` stay registered, with their ids and crons. `auditFn` gets no
  work once step 4 is on: `audit.requested` is sent by `/api/audits/start` and `/reaudit`
  (`git grep -n "name: 'audit.requested'" -- apps/web ':!*.test.ts'`), and
  both answer 410. A rollback finds both as it left them. The cleanup keeps calling
  `prune_rate_limits` (B-F1).
- **C-4.** `deleteExpiredAudits` (`inngest/billing-helpers.ts`) no longer deletes an expired audit
  that a published report names (one neither taken down nor hidden). It pages by id after the last id
  read, so kept audits do not block the batches after them (`billing.test.ts`, "kept audits that fill whole
  batches…"), and reads each batch's ids twice (the report
  read, the delete), 150 a batch. Tests: `inngest/billing.test.ts` and, on the migrated schema in
  PGlite, `inngest/billing-ttl.db.test.ts`. Not keyed on a flag: it holds with v2 off too, and a
  rollback to a deployment from before this step brings back the old cleanup.
- **The race.** A report minted between a batch's report read and its delete loses its link to the
  audit (the FK is `on delete set null`; the report keeps its snapshot). v1's mint reads an audit's
  status and grade, not its expiry (`app/api/reports/mint/route.ts`), so an expired audit not yet
  deleted can be minted. The window is one batch's two requests, once a day.
- **/privacy.** An audit behind a published report now outlives the 30 days /privacy states; the
  sentence needs an exception, which is the owner's legal text (questions.md Q13).
- **No v1 table is dropped or altered here.** `audits`, `pages`, `links`, `findings`, `fixes`,
  `sessions` and `benchmark_cohorts` are dropped by a later migration, no earlier than 30 days after
  step 4 is switched on (with step 4 on 2026-11-17, not before 2026-12-17), together with the
  `gone-api` rows, `auditFn` and `cleanupExpiredAuditsFn`.
- **v1 audits are not converted into v2 checks**: a v1 grade is not a v2 grade, and a converted
  record would claim evidence v2 never collected.

## D5 — a v1 user's first v2 sign-in

- **What the first sign-in does** (traced in questions.md Q12): it writes nothing to `audits`,
  `public_reports` or `users.pro_until`. Without a v2 account, `runFirstLogin` answers `no_account`
  and the dashboard shows its no-account state; the backfill below gives every existing user one.
- **The line.** For a viewer whose own user id has completed, unexpired v1 audits, the v2 dashboard's
  Sites card carries one closed disclosure, "Your earlier audits are still at their links", in its
  empty and its sites state: up to 20, newest first, each with its host, date, the v1 grade labelled
  as the earlier grade, and a link to `/audit/<id>`. Read through the service role keyed on the
  signed-in viewer's own id (`app/dashboard/v2/earlier-audits.ts`), the rows the viewer's own session
  could read: a v1 audit id is a capability URL, so another member of the account does not see it.
- **The backfill** (ruling 1): filled in when it lands.

## D3 — kept public pages in the v2 shell

Filled in when it lands.

## D6 — what each other cutover item is, and whose

`notes/cc-35/for-cc-36.md` rows and the inventory findings this step owns, answered in PR.md and
questions.md Q6–Q10: `cc36-v1-redirects` and `cc36-v1-pages` are built here (D1, D2, D3);
`cc36-v1-crons` is answered by D4 (both functions stay; the row's two reasons hold); `cc36-v1-billing`
is CC-38's and the owner's; `cc36-v1-accounts` is the backfill (D5). Findings: A-11 closes from step 4
(D2), C-4 is fixed (D4), A-1 goes to CC-37, A-2 stays with the v1 export and llms-txt routes until the
v1 drop.
