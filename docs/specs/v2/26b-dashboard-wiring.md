# CC-26b — the signed-in product on real data

The routes `docs/specs/v2/26-dashboard-site.md` lists as CC-26b's, and the dashboard and site page
served from the signed-in viewer's account. Everything here is behind `V2_CHECKS_PUBLIC`
(`checksPublicEnabled`, `apps/web/lib/auth/flags.ts`); with it unset, `/dashboard` is v1 and each
route below answers 404.

## Decisions

| #   | Decision                                                                                                                                                                                                    | Where it is in the code                                                 |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| D1  | One flag, `V2_CHECKS_PUBLIC`, gates every route and page here.                                                                                                                                              | each route's first statement; `app/dashboard/page.tsx`'s one branch     |
| D2  | The viewer: `loadViewer()` returns the caller's account, seat, tier and limits, read through the caller's own session.                                                                                      | `apps/web/lib/v2/account/viewer.ts`                                     |
| D3  | Every route checks the caller's membership of the row's account through the caller's session before any service-role call; another account's row is 404; entitlement refusals are 402 with the gate's name. | `apps/web/lib/v2/account/route.ts`; `lib/security/route-policy.ts` rows |
| D4  | Re-check: the per-site daily cap and the 2-minute debounce are enforced in one SQL function that records the request; capped is 429 with when the next is allowed; `CRAWL_PAUSED` is 503.                   | migration `20261112000001`, section A                                   |
| D5  | Mark done writes `site_fixes` and its `fix_events` row in one transaction and requests a `fix_recheck`; the persist RPC keeps a mark made after the persisted check started.                                | migration `20261112000001`, section B                                   |
| D6  | Sites: hosts canonicalised and private hosts refused; slots counted in SQL; weekly schedules, competitors and staging need a paid tier; remove sets `removed_at`.                                           | migration section A; `app/api/sites/**`                                 |
| D7  | Trial start: owner only, decided by the state machine's `next()`, applied by `start_trial_with_ledger` and CC-03's dispatcher.                                                                              | `app/api/billing/pro-trial/start/route.ts`                              |
| D8  | `/dashboard` and `/sites/[id]` on real data, with the no-site and first-check-running states designed.                                                                                                      | `app/dashboard/page.tsx`, `app/sites/[id]/page.tsx`                     |
| D9  | Fix packet (402 when not visible to the tier) and email-developer (validated, rate limited, an event; nothing sent here).                                                                                   | `app/api/fixes/**`                                                      |
| D10 | `PATCH /api/me {theme}` writes the caller's own seat rows only.                                                                                                                                             | `app/api/me/route.ts`                                                   |
| D11 | Server-side events: `site_added`, `check_started`, `fix_marked_done`, `fix_closed`, `trial_started`.                                                                                                        | `apps/web/lib/v2/account/events.ts`                                     |
| D12 | Out of this step: scheduled checks and alerts (CC-28), settings and deletion (CC-27b), reports and exports, seats (CC-31), pricing (CC-29).                                                                 |                                                                         |

## Owner rulings

Recorded here when given; the questions and their recommendations are in the step's notes.

## Known gaps
