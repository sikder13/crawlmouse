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
| D1  | **The access matrix, generated and enforced.** `apps/web/__tests__/security/access-matrix.test.ts` reads the disk — every route folder, every server entry file under `app/` whose imports reach `lib/supabase/admin` or `lib/supabase/server`, and every file that opens a service-role client (`supabaseAdmin()`, or `createClient` given `SUPABASE_SERVICE_ROLE_KEY`) with its count — and requires one row each in `access-matrix.data.ts`: whom it acts for, the gate, the call that makes the check (found by the AST in the file or a file it imports), and the test that proves it. `docs/ops/access-matrix.md` is rendered from the rows. Each hole found is fixed with a role-by-role test. | One rule, proven everywhere, before agencies put their clients' data in.                                                                 |
| D2  | **Login CSRF (A-8).** The v1 path was closed by 6e0b51cd. This step adds the attacker flow with the door on and off for a v2 Keep as well as v1 audits.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Signing a victim into an attacker's account must never move the victim's data.                                                           |
| D3  | **Trial abuse, in SQL.** Internal accounts (`accounts.internal`, CC-33) are neither recorded in nor refused by the ledger, and their rows count against no one; one Agency trial per person, read from `accounts.trial_used_at` through every owner seat the person has held. **Deferred:** the `hostname` and `card_fingerprint` kinds and the 13-month sweep. A host rule refuses agencies whose client was once trialled elsewhere, which is wrong for our best customers; a card rule needs a Stripe webhook change on the money path. Both wait for real abuse data.                                                                                                                             | Stop the obvious repeat-trial abuse and keep the owner's testing possible, without risking a legitimate agency's sign-up in launch week. |
| D4  | **SSRF guard: strengthen only** (owner sign-off, `rulings.md`). C-2's ranges were already in `packages/engine/src/address-ranges.ts`; this step pins them in every spelling. C-6: the Crawlee path refuses the header names `safeFetch` refuses, before any request.                                                                                                                                                                                                                                                                                                                                                                                                                                  | A wider guard, with no public site's crawl result changed (backtest: `notes/cc-37/d4-backtest.md`).                                      |
| D5  | **Data shown to the wrong seat.** Q25: the card's last four is readable by the account owner only, at the database too. Q16: `seat_may('mint_report')` (owner, account manager) gates a v2 mint. Q43: `erase_rules()` clears the refusal entry and contact name of an erased address.                                                                                                                                                                                                                                                                                                                                                                                                                 | Agencies give developers seats; developers must not see the card or publish the client.                                                  |
| D6  | **The small findings.** A-4 email length; A-5 takedown bucket after the lookup; A-10 admin throttle before the secret check; A-1 stream id and rate limit; the PostHog surveys script in the report-only CSP; C-7 a go-live row.                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Each is small, known, and cheaper to close now than to explain later.                                                                    |

## D1 — the access matrix

- Data: `apps/web/__tests__/security/access-matrix.data.ts`; disk reader: `access-surface.ts`; rendered:
  `docs/ops/access-matrix.md`. A row's check is an AST call (`callsMarker`): a comment, import or type naming it does
  not count. A module that trusts its callers names them, and the test holds the list to its importers.
- Holes found: Q16 and Q25 (CC-31's), both closed below. `KNOWN_OPEN` is empty and `no hole is open` asserts it.
- Gates the enumeration found without a proving test got one: `access-proof-v1.test.ts`, `access-proof-pages.test.ts`.
- Verify: `pnpm --filter @crawlmouse/web exec vitest run __tests__/security/access-matrix.test.ts`.

## D2 — login CSRF

`app/login/verify/route.csrf.test.ts`: the attacker's link opened in the victim's browser, door on and off, for v1
audits and a v2 Keep. Nothing moves to the attacker's account; with no binding the attacker's first login still records
the browser's device (CC-06c D9, pinned).

## D3 — trial abuse (migration `20261117000001` §A, §B)

- An account with `accounts.internal = true` takes no ledger lock, is refused by no row and writes none;
  `trial_ledger_refusals` does not count rows of an internal account (rows of a deleted account still count).
- `start_agency_trial_account` answers `trial_used` for a person who has held an owner seat, of any status, on an agency
  account whose trial was used and that is not internal.
- Tests: `apps/web/__tests__/v2-037-security.test.ts`; race: `scripts/db/agency-trial-repeat-race.test.ts`.

## D4 — SSRF guard

`packages/engine/src/crawler.ts` refuses `extraHeaders` naming any of `FORBIDDEN_HEADERS` (`safe-fetch.ts`), in any
case, before a request. Tests: `crawler-headers.test.ts`, `ssrf-guard.c2.test.ts`, the worker's `fetcher.test.ts`.

## D5 — the wrong seat

- Q16: `seat_may` holds `mint_report` for owner and account manager; `lib/v2/reports/mint.ts` asks it through the
  caller's session (`__tests__/security/mint-by-role.test.ts`).
- Q25: `card_last4` is revoked from `authenticated`; `lib/v2/account/card.ts` reads it with the service role after
  `member_role`, digits for the owner, `card_on_file` for every role.
- Q43: `erase_rules()` rules 18 (`sites.report_refusals pruned`) and 19 (`sites.client_contact_name nulled`).

## D6 — the small findings

A-4 `app/api/auth/magic-link/route.ts`; A-5 `app/api/takedown/route.ts`; A-10 `app/api/admin/takedown/process/route.ts`;
A-1 `app/api/audits/[id]/stream/route.ts`; CSP `lib/security/headers.mjs` (report-only `script-src`); C-7 the go-live
row `stripe-reconcile-livemode-true`. C-5 was already the auto row `vercel-env-step-1`.

## Deploy order

The app change that stops reading `card_last4` through the session ships before the owner applies `20261117000001`;
applied first, the account and Settings reads fail. `20261115000001` (CC-33) is applied before it.
