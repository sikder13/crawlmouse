# SPEC 37 — security and abuse sweep (CC-37)

v2 opens to everyone with no beta. Agencies will put client sites, client contacts and their staff into it. This step
proves the whole access surface against one rule, closes the open findings of the v1 inventory
(`docs/ops/v1-inventory.json`) and of CC-31, and stops repeat Agency trials. It adds no feature.

**The access rule.** `is_member_for_site` decides who may see a client site; `seat_may(account, action)` decides what a
role (owner, account manager, developer) may do; anonymous reads go through capability URLs, never open row security
(OPERATING-RULES §5).

## Decisions

| #   | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Why                                                                                                                                      |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | **The access matrix, generated and enforced.** `apps/web/__tests__/security/access-matrix.test.ts` reads `apps/web/app`, `apps/web/lib`, `apps/web/components` and `inngest`, not `scripts/`: the route folders, the server entry files under `app/` that reach a data source, and the files that open a service-role client, counted by binding. It requires a row for each in `access-matrix.data.ts`: whom it acts for, the gate, a check call whose result is used (found by the AST), and one running test, by its whole title, whose file imports the row's file or its check. `docs/ops/access-matrix.md` is rendered from the rows. Each access hole found is fixed with a role-by-role test. | One rule, proven everywhere, before agencies put their clients' data in.                                                                 |
| D2  | **Login CSRF (A-8).** The v1 path was closed by 6e0b51cd. This step adds the attacker flow with the door on and off for a v2 Keep as well as v1 audits.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Signing a victim into an attacker's account must never move the victim's data.                                                           |
| D3  | **Trial abuse, in SQL.** Internal accounts (`accounts.internal`, CC-33) are neither recorded in nor refused by the ledger, and their rows count against no one; one Agency trial per person, read from `accounts.trial_used_at` through every owner seat the person has held. **Deferred:** the `hostname` and `card_fingerprint` kinds and the 13-month sweep. A host rule refuses agencies whose client was once trialled elsewhere, which is wrong for our best customers; a card rule needs a Stripe webhook change on the money path. Both wait for real abuse data.                                                                                                                             | Stop the obvious repeat-trial abuse and keep the owner's testing possible, without risking a legitimate agency's sign-up in launch week. |
| D4  | **SSRF guard: strengthen only** (owner sign-off, `rulings.md`). C-2's ranges were already in `packages/engine/src/address-ranges.ts`; this step pins them in every spelling. C-6: the Crawlee path refuses the header names `safeFetch` refuses, before any request.                                                                                                                                                                                                                                                                                                                                                                                                                                  | A wider guard, with no public site's crawl result changed (backtest: `notes/cc-37/d4-backtest.md`).                                      |
| D5  | **Data shown to the wrong seat.** Q25: the card's last four is readable by the account owner only, at the database too. Q16: `seat_may('mint_report')` (owner, account manager) gates a v2 mint. Q43: `erase_rules()` clears the refusal entry and contact name of an erased address.                                                                                                                                                                                                                                                                                                                                                                                                                 | Agencies give developers seats; developers must not see the card or publish the client.                                                  |
| D6  | **The small findings.** A-4 email length; A-5 takedown bucket after the lookup; A-10 admin throttle before the secret check; A-1 stream id and rate limit; the PostHog surveys script in the report-only CSP; C-7 a go-live row.                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Each is small, known, and cheaper to close now than to explain later.                                                                    |

## D1 — the access matrix

- Data: `apps/web/__tests__/security/access-matrix.data.ts`; disk reader: `access-surface.ts`; rendered:
  `docs/ops/access-matrix.md`, whose header lists what the test refuses.
- Roots read: `apps/web/app`, `apps/web/lib`, `apps/web/components`, `inngest` (`ADMIN_ROOTS` in
  `access-matrix.types.ts`). `scripts/` is not read; the files there that name the service-role factory or key:
  `grep -rlE "supabaseAdmin|SUPABASE_SERVICE_ROLE_KEY" scripts`.
- A service-role client is counted by binding (`adminCalls`): anything imported from `lib/supabase/admin`, under any
  name or through a namespace, and `createClient` given `SUPABASE_SERVICE_ROLE_KEY` directly, by element access or
  through a local variable. A module that opens its own client counts as a data source for the entry-file walk.
- A row's check is an AST call whose answer is read (`markerCalls`): a bare statement, `void`, a binding whose name is
  not read elsewhere in the file, or a result of which only the `error` is read (`{ data: allowed, error }` with
  `allowed` unread, `res.error`, `(await …).error`) does not count, and a string counts only as `.rpc('<name>')` or the
  filter the row names (`.eq('audit_id', …)`).
- A row's proof is one `it`/`test` that runs (not one inside a `describe`/`suite` marked `.skip`, `.todo`, `.only`,
  `.skipIf` or `.runIf`), matched by its whole title (`it.each` rendered from a literal table), in
  a file whose imports reach the row's file or its check's file. A `caller` row is proved by the matrix's caller
  check, which follows each chain of importers to a row with another gate and refuses a cycle; a `public` end counts
  only where the row states why (`publicCallers`).
- What the matrix does not measure: whether the named test is the one that fails when the refusal is removed. A
  scripted sweep removed the refusal branch of each `member_for_site` and `seat_may` row whose check is in its route
  or page (`notes/cc-37/sweep-A.md`). Four refused nothing on their own, because a session read under row security
  refuses the same seats; those rows name that read as their check.
- Holes found: Q16 and Q25 (CC-31's), both closed below. `KNOWN_OPEN` is empty and `no hole is open` asserts it.
- Gates the enumeration found without a proving test got one: `access-proof-v1.test.ts`, `access-proof-pages.test.ts`,
  `access-proof-public.test.ts`, `audit-read-by-role.test.ts`.
- Verify: `pnpm --filter @crawlmouse/web exec vitest run __tests__/security/access-matrix.test.ts`.

## D2 — login CSRF

`app/login/verify/route.csrf.test.ts`: the attacker's link opened in the victim's browser, door on and off, for v1
audits and a v2 Keep. Nothing moves to the attacker's account; with no binding the attacker's first login still records
the browser's device (CC-06c D9, pinned).

## D3 — trial abuse (migration `20261117000001` §A, §B)

- An account with `accounts.internal = true` takes no ledger lock, is refused by no row and writes none;
  `trial_ledger_refusals` does not count rows of an internal account (rows of a deleted account still count).
- `start_agency_trial_account` answers `trial_used` for a person who has held an owner seat, of any status, on an agency
  account whose trial was used and that is not internal. A used internal account is not returned as `existing` either,
  so each start by its owner creates another agency account (one per test run, by design, Q9).
- `20261117000001` adds `accounts.internal` with CC-33's own statement while `20261115000001` is not applied. Its revert
  drops the column unless the migration history records `20261115000001`, so the rollbacks give back the fingerprint
  they found; reverted that way, any mark set by hand is lost. Production's history table needs the one-time repair in
  `docs/ops/db-migrations.md` §5 before that check means anything there.
- Tests: `apps/web/__tests__/v2-037-security.test.ts`; race: `scripts/db/agency-trial-repeat-race.test.ts`.

## D4 — SSRF guard

`packages/engine/src/crawler.ts` refuses `extraHeaders` naming any of `FORBIDDEN_HEADERS` (`safe-fetch.ts`), in any
case, before a request. Tests: `crawler-headers.test.ts`, `ssrf-guard.c2.test.ts`, the worker's `fetcher.test.ts`.

## D5 — the wrong seat

- Q16: `seat_may` holds `mint_report` for owner and account manager; `lib/v2/reports/mint.ts` asks it through the
  caller's session (`__tests__/security/mint-by-role.test.ts`).
- Q25: `20261118000001` revokes `card_last4` from `authenticated`; `lib/v2/account/card.ts` reads it with the service
  role after `member_role`: the digits for the owner, `onFile` for every role, carried beside the account dataset as
  `cardsOnFile` and to the views as `AccountView.cardOnFile` (`__tests__/v2-037-card-grant.test.ts`).
- Q43: `erase_rules()` rules 18 (`sites.report_refusals pruned`) and 19 (`sites.client_contact_name nulled`).

## D6 — the small findings

A-4 `app/api/auth/magic-link/route.ts`; A-5 `app/api/takedown/route.ts`; A-10 `app/api/admin/takedown/process/route.ts`;
A-1 `app/api/audits/[id]/stream/route.ts`; CSP `lib/security/headers.mjs` (report-only `script-src`); C-7 the go-live
row `stripe-reconcile-livemode-true`. C-5 was already the auto row `vercel-env-step-1`.

A-5's order holds for a request with a known client IP. With no client IP, the per-domain bucket is spent once, before
the lookup, so such posts are bounded per domain but not across domains; on Vercel every request carries the client
IP, so that case is not reached in production (review r2 n2).

## Deploy order

As the repo's pipeline runs it (`docs/ops/db-migrations.md`): merging deploys the app, and `db-apply-prod.yml` then
applies every pending file in one push, in name order, after the owner approves it
(`scripts/db/production.ts` `manifestProblems`). So:

1. Merge. Vercel deploys the app.
2. One apply of every pending file: `20261115000001` (CC-33, once it is on `main`), `20261117000001`, `20261118000001`.

Between 1 and 2 the new app runs on the old schema. The two reads that need `20261117000001` sit behind flags that are
off until later go-live steps: the v2 mint asks `seat_may(…, 'mint_report')`, which raises before that file
(`V2_CHECKS_PUBLIC`, step 4), and Pricing and the Agency trial page read `accounts.internal`, which that file adds
(`V2_BILLING`, step 5; both pages are a 404 with it off). The go-live row `migrations-applied` gates step 2, so both
flags stay off until every file is applied. The account and Settings pages read `card_last4` with the service role,
so `20261118000001` cannot break them, and inside the apply it runs after `20261117000001`.
`__tests__/v2-037-card-grant.test.ts` walks the schema through these stages.
