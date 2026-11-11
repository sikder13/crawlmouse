# CC-26b — the signed-in product on real data

The routes `docs/specs/v2/26-dashboard-site.md` lists as CC-26b's, and the dashboard and site page
served from the signed-in viewer's account. Everything here is behind `V2_CHECKS_PUBLIC`
(`checksPublicEnabled`, `apps/web/lib/auth/flags.ts`); with it unset, `/dashboard` is v1 and each
route below answers 404.

## Decisions

| #   | Decision                                                                                                                                                                                                    | Where it is in the code                                                 |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| D1  | One flag, `V2_CHECKS_PUBLIC`, gates the routes and pages here; `__tests__/v1-inventory.test.ts` lists them as flag-gated.                                                                                   | each route's first statement; `app/dashboard/page.tsx`'s one branch     |
| D2  | The viewer: `loadViewer()` returns the caller's account, seat, tier and limits, read through the caller's own session.                                                                                      | `apps/web/lib/v2/account/viewer.ts`                                     |
| D3  | Every route checks the caller's membership of the row's account through the caller's session before any service-role call; another account's row is 404; entitlement refusals are 402 with the gate's name. | `apps/web/lib/v2/account/route.ts`; `lib/security/route-policy.ts` rows |
| D4  | Re-check: the per-site daily cap and the 2-minute debounce are enforced in one SQL function that records the request; capped is 429 with when the next is allowed; `CRAWL_PAUSED` is 503.                   | migration `20261112000001`, section A                                   |
| D5  | Mark done writes `site_fixes` and its `fix_events` row in one transaction and requests a `fix_recheck`; the persist RPC keeps a mark made after the persisted check started.                                | migration `20261112000001`, section B                                   |
| D6  | Sites: hosts canonicalised and private hosts refused; slots counted in SQL; weekly schedules, competitors and staging need a paid tier; remove sets `removed_at`.                                           | migration section A; `app/api/sites/**`                                 |
| D7  | Trial start: the owner (`app/api/billing/pro-trial/start/route.test.ts`), decided by the state machine's `next()`, applied by `start_trial_with_ledger` and CC-03's dispatcher.                             | `app/api/billing/pro-trial/start/route.ts`                              |
| D8  | `/dashboard` and `/sites/[id]` on real data, with the no-site and first-check-running states designed.                                                                                                      | `app/dashboard/page.tsx`, `app/sites/[id]/page.tsx`                     |
| D9  | Fix packet (402 when not visible to the tier) and email-developer (validated, rate limited, an event; nothing sent here).                                                                                   | `app/api/fixes/**`                                                      |
| D10 | `PATCH /api/me {theme}` writes the caller's own active seat rows (`lib/v2/account/theme.test.ts`).                                                                                                          | `app/api/me/route.ts`                                                   |
| D11 | Server-side events: `site_added`, `check_started`, `fix_marked_done`, `fix_closed`, `trial_started`.                                                                                                        | `apps/web/lib/v2/account/events.ts`                                     |
| D12 | Out of this step: scheduled checks and alerts (CC-28), settings and deletion (CC-27b), reports and exports, seats (CC-31), pricing (CC-29).                                                                 |                                                                         |

## Owner rulings (2026-11-10)

| Question | Ruling                                                                                                                                                                                     | In the code                                                                |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------- |
| Q1       | Manual re-checks per site per day are their own gate, `manualChecksPerSiteDay` (Free 2, Pro 10, Agency 10, DECISION-LOG E6); `checksPerSiteDay` stays J9's per-eTLD+1 crawl cap.           | `lib/entitlement-v2.ts`                                                    |
| Q2       | D4 supersedes E6's "queued, never refused": a capped re-check is refused with 429 and `Retry-After`.                                                                                       | `app/api/sites/[id]/checks/route.ts`                                       |
| Q3       | `manual` and `fix_recheck` share the cap; a mark done over it stays recorded.                                                                                                              | `request_capped_check`                                                     |
| Q4       | Undoing a mark is deferred to a step that may change the engine; no page shows an undo control, and the marked-done note says the next check confirms or reopens the fix.                  | `view/site.ts`                                                             |
| Q7       | One `check_started {trigger, check_ref}` for the product.                                                                                                                                  | `lib/v2/account/events.ts`                                                 |
| Q8       | An email request is a `fix_email_requests` row; `fix.email_developer_requested` carries only `{requestId}`.                                                                                | migration section B                                                        |
| Q10      | Server events use CC-22b's sender and `serverCaptureAllowed`.                                                                                                                              | `lib/v2/account/events.ts` (through an interim module until CC-22b merges) |
| Q11      | The race tests run on real Postgres in CI's `db-cli-files` job.                                                                                                                            | `scripts/db/{sites,fixes}-race.test.ts`                                    |
| Q12      | Add, edit and remove a site: owner or account manager (add: an unscoped seat); re-check, mark done, packet, email-developer: any member whose scope covers the site; trial start: owner.   | each route                                                                 |
| Q13      | A mark while its bucket's check has started answers `check_running`; choosing the next bucket waits for the step that next edits `requestCheck`.                                           | `RecheckOutcome`                                                           |
| Q14      | First checks queued for an account's sites in 24 hours are bounded by its site limit.                                                                                                      | `add_site`                                                                 |
| Q15      | Trial start calls the door's `decideTrial`.                                                                                                                                                | `lib/auth/first-login.ts`                                                  |
| Q16      | The build hands persist the id of the last fix event it read per fix; persist withholds a fix whose latest event is another.                                                               | `lib/v2/pipeline/steps/finish.ts`, `persist_built_check`                   |
| R28      | A check that cannot start is 503 with `code` `paused` (`CRAWL_PAUSED`), `unavailable` (`V2_PIPELINE` off) or `capacity` (`global:audits:day`).                                             | `lib/v2/account/route.ts`                                                  |
| Ceiling  | A check start in these two functions takes a `global:audits:day` slot inside the SQL, after the function's own caps pass; a refusal rolls the slot back (`scripts/db/sites-race.test.ts`). | `request_capped_check`, `add_site`                                         |

The dashboard is served by a rewrite, not a branch in v1's page: a page's stylesheets are those of
the modules it imports, dynamic imports included (measured: `evidence-r14-css.md` in the step notes). With `V2_CHECKS_PUBLIC` on, `middleware.ts` rewrites
`/dashboard` to `app/dashboard/v2/page.tsx`; v1's `app/dashboard/page.tsx` is main's file, pinned by
its sha256 in `app/dashboard/v2/page.test.tsx`.

## Known gaps

- Undo of a mark (Q4) and the next-bucket re-check (Q13) wait for later steps.
- `next_check_at` is not set for a new site's schedule; CC-28's tick sets it.
- Competitor hosts are stored on the site; no competitor check runs in this step. A staging URL is a
  child site with no schedule, no first check and no deploy hook row.
- The account door's own slot count is still the TypeScript one, outside `add_site`.
- `fix_closed` is sent from the persist step, which has no request and so no consent cookie to read.
- The dataset loader reads the account's sites' checks with no per-site bound.
