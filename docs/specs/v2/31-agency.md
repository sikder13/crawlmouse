# SPEC 31 — The agency's workspace: clients, seats, reports, exports and share links (CC-31)

What Pro and Agency sell beyond the dashboard: the account a person acts in, seats with invitations
and per-client scope, reports and exports with a 30-day share link, and for Agency the client matrix
and client page. Prices and limits on a screen come from `apps/web/lib/billing/prices.ts` and `GATES`
(`apps/web/lib/entitlement-v2.ts`), not from an artboard.

Migration: `infra/supabase/migrations/20261114000002_v2_031_agency.sql`, revert beside it in
`infra/supabase/rollbacks/`.

## 1. Decisions

| # | Decision |
|---|---|
| D1 | `V2_CHECKS_PUBLIC` gates the pages and routes of this step; unset, each answers 404. An Agency-only route answers 402 with the gate's name (`agencyBranding`) for a lower tier; an Agency-only page shows the gate (§12). |
| D2 | `is_member_for_site` is the one rule for seeing a site. A service-role read is keyed by ids the caller's own session returned (§4). What a role may do is `seat_may` (§3); a route asks it and compares no role string. Out of scope is 404. |
| D2b | A person with several seats chooses the account they act in; the choice is a cookie that is followed only when it names one of their own active seats (§5). `users.default_account_id` is not written. |
| D3 | Seats and invitations: a single-use token, 7 days, stored as its hash; accepted only by the signed-in user whose email matches; the limit is checked in the statement that writes the seat. |
| D4 | Seats and sites beyond the plan are bought through CC-03's catalog and Stripe client; limits follow the subscription the webhook confirms. |
| D5 | `/agency` is the client matrix; `/agency/clients/[siteId]` the client page. |
| D6 | `POST /api/reports` makes `audit_pdf`, `compare`, `raw_export` and `prospect_one_pager`, server-side from stored data, into the private `reports` bucket. |
| D6b | A `compare` report is a before-and-after page (`format: html`), with a baseline version for a site with nothing wrong. |
| D7 | Download is a 10-minute signed URL. A share link is a 22-character token stored as its sha256, good for 30 days, revocable, 410 once gone. |
| D8 | Client report schedules are stored and edited here; an external recipient confirms their address before any report is sent to it. |
| D9 | Invited addresses, report recipients, share links and report files join CC-27b's erasure. |
| D10 | A gate message is written once from `GATES` and `prices.ts`; the events of §11 are sent server-side. |
| D11 | Not in this step: custom domains and the agency's sender (Branding), the read-only API, competitors, `/r/**` and minting, hiding a v2 public report, the mailer's own code beyond new kinds, switching flags. |

How the tree changed the form of a decision is in §12.

## 2. Pages and routes

| Path | Who | What |
|---|---|---|
| `/agency` | Agency | the client matrix (`Final-Ag-Matrix`) |
| `/agency/clients/[siteId]` | Agency, a seat that covers the site | the client page (`Final-Ag-Client`) |
| `/agency/reports` | Agency | client report schedules and what was sent (`Final-Ag-Reports`) |
| `/reports`, `/reports/[id]` | a signed-in member; making a report needs `exports` | `Final-Reports`; a proof page |
| `/seats` | a signed-in member; Free sees the gate | `Final-Ag-Seats` |
| `/invite/[token]`, `/invite` | the invited address, signed in | the link lands its token in a cookie; the page shows the invitation; accepting is a POST |
| `/s/[token]`, `/s/view/[reportId]` | anyone holding the link | a shared report: 410 once gone, a file as a redirect, a proof page rendered |

## 3. The Guard column

One table, in SQL: `seat_may(p_account, p_action)` (migration section S). It answers for the caller's
own active seat, runs as the caller, and raises on an action it does not list. The screens read the
same table from `SEAT_GUARD` (`apps/web/lib/v2/agency/guard.ts`) to decide which buttons to show.
`pnpm --filter @crawlmouse/web exec vitest run __tests__/v2-031-seam.test.ts` asks SQL each role and
action and compares the answers with `SEAT_GUARD` and with the table below written out in the test.

| Action | Owner | Account manager | Developer | Asked with |
|---|---|---|---|---|
| see audits and packets, mark a fix done, run a check | yes | yes | yes | `is_member_for_site` alone |
| `export_report` | yes | yes | yes | + `is_member_for_site` |
| `share_report`, `schedule_report`, `prospect_report` | yes | yes | no | + `is_member_for_site` |
| `add_site` (an unscoped seat), `edit_site`, `remove_site` | yes | yes | no | + `is_member_for_site` |
| `edit_account_alerts` (the account-wide rules and the Slack webhook) | yes | yes | no | the account |
| `invite_seat`, `change_seat`, `remove_seat` | yes | no | no | the account |
| `buy_seats` | yes | no | no | the account |

The rows are the locked Seats artboard's "What each role can do": see audits and packets; mark fixes
done, run checks; edit and send client reports; add or remove client sites; branding, seats, billing.
The artboard has no row for alerts: `edit_account_alerts` follows Settings, which the owner and
account managers edit.

`seat_may('add_site')` answers for the role. That the seat must also cover every client is asked by
the route (`app/api/sites/route.ts`), since a manager scoped to some clients could not then see the
site they added.

Actions of other steps this table does not hold: a site's own alert switch (a seat that covers the
site, CC-28) and minting a public report (CC-29's route asks `is_member_for_site` and no role;
questions.md Q16).

A seat that does not cover a site gets 404 for it. A seat that covers the site and whose role the
table refuses gets 403 `role_refused`.

## 4. Reads

Which client makes each read of a site, check, fix, packet, alert, change or report, and what bounds it.

| Read | Where | Client | Bound by |
|---|---|---|---|
| The account, its seats, subscription, keys, brand, account-wide alert rules | `lib/v2/account/dataset.ts`, `settings-dataset.ts` | caller | row security, `is_member` |
| The ids of the account's live sites | `sitesInScope` (`lib/v2/agency/guard.ts`) | caller | `sites`' policy, `is_member_for_site` |
| `seat_sites` | both datasets | caller | a row is visible when its site is (section S) |
| Site rows, schedules, checks, fixes, fix events, changes | both datasets | service role | the ids `sitesInScope` returned |
| Site alert rules, reports | both datasets | caller | row security, `is_member_for_site` |
| A site page's site | `siteOfCaller` (`lib/v2/account/pages.ts`) | caller | `is_member_for_site` |
| Edit, remove a site | `app/api/sites/[id]/route.ts` | caller, then service role by site id | `is_member_for_site`, `seat_may` |
| Add a site | `app/api/sites/route.ts` | caller, then service role | `seat_may`, an unscoped seat |
| Re-check | `app/api/sites/[id]/checks/route.ts` | caller, then service role by site id | `is_member_for_site` |
| Mark done, packet, email a developer | `app/api/fixes/[id]/*/route.ts`, `lib/v2/account/fixes.ts` | caller, then service role by fix id | `is_member_for_fix` |
| A check's pages, stream, cancel, notify | `readableCheck` (`lib/v2/pipeline/public.ts`) | service role, then caller | the caller's `sites` read for a kept site |

Each row is run as owner, account manager, developer in scope, developer out of scope, removed seat
and stranger: `pnpm --filter @crawlmouse/web exec vitest run __tests__/v2-031-scope.test.ts __tests__/v2-031-scope-routes.test.ts`.

**Found open and closed here.**

- `seat_sites` was readable by every member of the account, so a seat scoped to one client could list
  the site ids of the others. Its policy now also asks `is_member_for_site`.
- `seats` was readable by every member of the account, with each seat's invited address. A member now
  reads their own seat and the owner's, and the account's other seats only when their own seat covers
  every client (`member_covers_all`).
- `PUT /api/alert-rules` wrote the account-wide alert rules and the Slack webhook for a caller of any
  role. It now asks `seat_may('edit_account_alerts')`.

**Left as it is.** `subscriptions` and `agency_brands` are readable by every member of the account,
whatever their scope. The owner checks of the billing and account routes (`member_role` compared with
`'owner'` in `app/api/billing/**` and `app/api/account/**`) are not moved to `seat_may`.

## 5. The account switcher

The choice is the cookie `cm_account` (`lib/v2/account/viewer-cookie.ts`): httpOnly, SameSite=Lax, the
account's id. `readViewer` follows it when it is the account of one of the caller's active seats, read
with the caller's own client; otherwise the caller acts in their default account. The viewer carries
`accounts`, the accounts of those seats, which is what the switcher lists. Settings reads the same
choice (`chosenFromRequest`).

The switcher's control is built from the design system's existing pieces and is outside the locked
artboards, none of which draws one.

The switch is `POST /api/seats/switch`. No GET sets the cookie.

Which account each resolver uses for a person with several seats:

| Resolver | Used by | Account |
|---|---|---|
| `loadViewer` | the dashboard, add a site, the account's alert rules, `PATCH /api/account` (name, timezone) | the chosen one |
| `readSettingsPage` | Settings, Settings › Plan, Trial ending | the chosen one |
| `requestedAccountId` (`lib/billing/owner.ts`) | billing checkout, portal and cancel, when the request names no account | the chosen one when the caller owns it, else their one owned account, else 409 |
| `ownPersonalAccountId` | `POST /api/account/email` | the caller's own personal account |
| `PATCH /api/account` (a changed address), `DELETE /api/account` | Settings | refused with 409 `personal_account_only` outside the caller's personal account |
| `siteOfCaller` | the site page | the site's own account |
| the door's keep (`lib/auth/stores.ts`), `prepare_email_undo` | keep this audit; undo an email change | `users.default_account_id` |

## 6. Seats and invitations

An account has one owner seat, and it cannot be removed or demoted. No transfer of ownership is built.
CC-29's rule of one Agency trial a person is kept by the owner's seat staying active, so a future
transfer of ownership must move that rule from the seat to the person.

## 7. Buying seats and sites

## 8. The client matrix and the client page

## 9. Reports, exports and the proof page

A report's content is a `ReportDoc` (`lib/v2/reports/generate.ts`). The PDF, the proof page and the
share page draw one and add no sentence of their own.

## 10. Download, share and schedules

## 11. Erasure, gate messages and events

## 12. Where the tree changed a decision's form

- **Pages for Pro.** Seats and reports are sold on Pro, so `/seats` and `/reports` are not under
  `/agency` (questions.md Q1).
- **A pending report.** `reports.status` has no `pending`, and the contract is not changed: a
  database-only `reports.file_state` holds it (Q2).
- **Recipients.** A client report goes to the client's contact, `sites.client_contact_email`; its
  confirmation is recorded on `report_schedules` (Q3).
- **Seats are the owner's.** The locked Seats artboard gives seats to the owner alone (Q5).
- **402 on a page.** An App Router page cannot answer 402: an Agency-only page on a lower tier renders
  the gate, and each Agency-only route answers 402 (Q12).
- **Tokens.** An invitation's and a share link's token is moved from the link's address into a cookie
  by a route handler, as CC-27b's emailed links are (Q15).
- **Proration.** A raised quantity is invoiced at once (`always_invoice`); a lowered one is not
  credited (`none`) and bills from the next invoice (owner ruling, Q4).

## 13. Known gaps
