# SPEC 31 — The agency's workspace: clients, seats, reports, exports and share links (CC-31)

What Pro and Agency sell beyond the dashboard: the account a person acts in, seats with invitations
and per-client scope, reports and exports with a 30-day share link, and for Agency the client matrix
and client page. Prices and limits on a screen come from `apps/web/lib/billing/prices.ts` and `GATES`
(`apps/web/lib/entitlement-v2.ts`), not from an artboard.

Migration: `infra/supabase/migrations/20261114000002_v2_031_agency.sql`, revert beside it in
`infra/supabase/rollbacks/`.

## 1. Decisions

| #   | Decision                                                                                                                                                                                                                                                         |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | `V2_CHECKS_PUBLIC` gates the pages and routes of this step; unset, each answers 404. An Agency-only route answers 402 with the gate's name (`agencyBranding`) for a lower tier; an Agency-only page shows the gate (§12).                                        |
| D2  | `is_member_for_site` is the one rule for seeing a site. A service-role read is keyed by ids the caller's own session returned (§4). What a role may do is `seat_may` (§3), which the routes of this step and the site and alert routes ask. Out of scope is 404. |
| D2b | A person with several seats chooses the account they act in; the choice is a cookie that is followed only when it names one of their own active seats (§5). `users.default_account_id` is not written.                                                           |
| D3  | Seats and invitations: a single-use token, 7 days, stored as its hash; accepted only by the signed-in user whose email matches; the limit is checked in the statement that writes the seat.                                                                      |
| D4  | Seats and sites beyond the plan are bought through CC-03's catalog and Stripe client; limits follow the subscription the webhook confirms.                                                                                                                       |
| D5  | `/agency` is the client matrix; `/agency/clients/[siteId]` the client page.                                                                                                                                                                                      |
| D6  | `POST /api/reports` makes `audit_pdf`, `compare`, `raw_export` and `prospect_one_pager`, server-side from stored data, into the private `reports` bucket.                                                                                                        |
| D6b | A `compare` report is a before-and-after page (`format: html`), with a baseline version for a site with nothing wrong.                                                                                                                                           |
| D7  | Download is a 10-minute signed URL. A share link is a 22-character token stored as its sha256, good for 30 days, revocable, 410 once gone.                                                                                                                       |
| D8  | Client report schedules are stored and edited here; an external recipient confirms their address before any report is sent to it.                                                                                                                                |
| D9  | Invited addresses, report recipients, share links and report files join CC-27b's erasure.                                                                                                                                                                        |
| D10 | A gate message is written once from `GATES` and `prices.ts`; the events of §11 are sent server-side.                                                                                                                                                             |
| D11 | Not in this step: custom domains and the agency's sender (Branding), the read-only API, competitors, `/r/**` and minting, hiding a v2 public report, the mailer's own code beyond new kinds, switching flags.                                                    |

How the tree changed the form of a decision is in §12.

## 2. Pages and routes

| Path                               | Who                                                 | What                                                                                     |
| ---------------------------------- | --------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `/agency`                          | Agency                                              | the client matrix (`Final-Ag-Matrix`)                                                    |
| `/agency/clients/[siteId]`         | Agency, a seat that covers the site                 | the client page (`Final-Ag-Client`)                                                      |
| `/agency/reports`                  | Agency                                              | client report schedules and what was sent (`Final-Ag-Reports`)                           |
| `/reports`, `/reports/[id]`        | a signed-in member; making a report needs `exports` | `Final-Reports`; a proof page                                                            |
| `/seats`                           | a signed-in member; Free sees the gate              | `Final-Ag-Seats`                                                                         |
| `/invite/[token]`, `/invite`       | the invited address, signed in                      | the link lands its token in a cookie; the page shows the invitation; accepting is a POST |
| `/s/[token]`, `/s/view/[reportId]` | anyone holding the link                             | a shared report: 410 once gone, a file as a redirect, a proof page rendered              |

## 3. The Guard column

One table, in SQL: `seat_may(p_account, p_action)` (migration section S). It answers for the caller's
own active seat, runs as the caller, and raises on an action it does not list. The screens read the
same table from `SEAT_GUARD` (`apps/web/lib/v2/agency/guard.ts`) to decide which buttons to show.
`pnpm --filter @crawlmouse/web exec vitest run __tests__/v2-031-seam.test.ts` asks SQL each role and
action and compares the answers with `SEAT_GUARD` and with the table below written out in the test.

| Action                                                               | Owner | Account manager | Developer | Asked with                 |
| -------------------------------------------------------------------- | ----- | --------------- | --------- | -------------------------- |
| see audits and packets, mark a fix done, run a check                 | yes   | yes             | yes       | `is_member_for_site` alone |
| `export_report`                                                      | yes   | yes             | yes       | + `is_member_for_site`     |
| `share_report`, `schedule_report`, `prospect_report`                 | yes   | yes             | no        | + `is_member_for_site`     |
| `add_site` (an unscoped seat), `edit_site`, `remove_site`            | yes   | yes             | no        | + `is_member_for_site`     |
| `edit_account_alerts` (the account-wide rules and the Slack webhook) | yes   | yes             | no        | the account                |
| `invite_seat`, `change_seat`, `remove_seat`                          | yes   | no              | no        | the account                |
| `buy_seats`                                                          | yes   | no              | no        | the account                |

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

| Read                                                                        | Where                                                      | Client                               | Bound by                                      |
| --------------------------------------------------------------------------- | ---------------------------------------------------------- | ------------------------------------ | --------------------------------------------- |
| The account, its seats, subscription, keys, brand, account-wide alert rules | `lib/v2/account/dataset.ts`, `settings-dataset.ts`         | caller                               | row security, `is_member`                     |
| The ids of the account's live sites                                         | `sitesInScope` (`lib/v2/agency/guard.ts`)                  | caller                               | `sites`' policy, `is_member_for_site`         |
| `seat_sites`                                                                | both datasets                                              | caller                               | a row is visible when its site is (section S) |
| Site rows, schedules, checks, fixes, fix events, changes                    | both datasets                                              | service role                         | the ids `sitesInScope` returned               |
| Site alert rules, reports                                                   | both datasets                                              | caller                               | row security, `is_member_for_site`            |
| A site page's site                                                          | `siteOfCaller` (`lib/v2/account/pages.ts`)                 | caller                               | `is_member_for_site`                          |
| Edit, remove a site                                                         | `app/api/sites/[id]/route.ts`                              | caller, then service role by site id | `is_member_for_site`, `seat_may`              |
| Add a site                                                                  | `app/api/sites/route.ts`                                   | caller, then service role            | `seat_may`, an unscoped seat                  |
| Re-check                                                                    | `app/api/sites/[id]/checks/route.ts`                       | caller, then service role by site id | `is_member_for_site`                          |
| Mark done, packet, email a developer                                        | `app/api/fixes/[id]/*/route.ts`, `lib/v2/account/fixes.ts` | caller, then service role by fix id  | `is_member_for_fix`                           |
| A check's pages, stream, cancel, notify                                     | `readableCheck` (`lib/v2/pipeline/public.ts`)              | service role, then caller            | the caller's `sites` read for a kept site     |

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

| Resolver                                                        | Used by                                                                                                                    | Account                                                                        |
| --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `loadViewer`                                                    | the dashboard, the client matrix (`/agency`), add a site, the account's alert rules, `PATCH /api/account` (name, timezone) | the chosen one                                                                 |
| `readSettingsPage`                                              | Settings, Settings › Plan, Settings › Delete, Trial ending                                                                 | the chosen one                                                                 |
| `requestedAccountId` (`lib/billing/owner.ts`)                   | billing checkout, portal and cancel, when the request names no account                                                     | the chosen one when the caller owns it, else their one owned account, else 409 |
| `ownPersonalAccountId`                                          | `POST /api/account/email`                                                                                                  | the caller's own personal account                                              |
| `PATCH /api/account` (a changed address), `DELETE /api/account` | Settings                                                                                                                   | refused with 409 `personal_account_only` outside the caller's personal account |
| `siteOfCaller`                                                  | the site page, the client page (`/agency/clients/[siteId]`)                                                                | the site's own account                                                         |
| the door's keep (`lib/auth/stores.ts`), `prepare_email_undo`    | keep this audit; undo an email change                                                                                      | `users.default_account_id`                                                     |

**The switch route.** `POST /api/seats/switch` `{accountId}` (`app/api/seats/switch/route.ts`, class
`member`, strict origin). It asks `is_member` as the caller, which is false for a removed seat, an
invitation not accepted and an account marked for deletion; refused, it answers 404, sets no cookie
and reads nothing more. It reads the account's kind with the caller's client and sets the cookie
(`Secure` when the request is HTTPS). A form is answered with a 303 to `/agency` for an agency account
and to `/dashboard` for a personal one; JSON with `{accountId}`. The route file exports `POST` and no
other method. `pnpm --filter @crawlmouse/web exec vitest run app/api/seats/switch/route.test.ts`

**The control.** `AccountSwitcher` (`components/v2/AccountSwitcher.tsx`) sits in the rail under the
brand, in `AccountShell`'s `account` slot. `switcherView` (`lib/v2/view/account-shell.ts`) builds it
from the viewer's `accounts` and is null for a person with one seat, whose rail then has no switcher.
It is a disclosure, as `NavMenu` is: a button that names the account acted in and says whether the
list is shown (`aria-expanded`), and a list of the person's other accounts, each a form that posts
its id to the switch. The list opens under the button, in the rail's own column. Escape, a press
outside it and focus moving outside it close it. A `<noscript>` copy of the list, not hidden, is what
a browser that runs no script shows. No element of it is orange. An account with no name reads
"Personal account" or "Agency account", by its kind.
`pnpm --filter @crawlmouse/web exec vitest run __tests__/v2/account-switcher.test.tsx lib/v2/view/account-shell.agency.test.ts`

The pages that pass the viewer's accounts to the frame: the dashboard, the site page, Settings and
Settings › Plan, `/agency` and `/agency/clients/[siteId]`. A page that does not has no switcher in its
rail (`ShellView.switcher` is null unless `accounts` is given):
`grep -rlE "withSwitcher|accounts \}|accounts:" apps/web/app --include=page.tsx`.

**A page of an account that is not the one acted in.** The site page and the client page show the
site's own account, whatever the cookie says. When that is not the account the caller acts in, the
frame's switcher is not a list: it names the page's account and the one acted in, and offers one
switch, to the page's account. The frame then leaves out Keep and the links to billing
(`withSwitcher`), whose routes act on the account acted in.

**Settings on an account that is not the person's own.** Settings shows the account acted in. Where
that is not the caller's own personal account (`readSettingsPage`'s `ownPersonalId`), the sign-in
address is read-only and Delete… is replaced by "Switch to your own account"; each says the control
belongs to their own account (`OWN_ACCOUNT_COPY`, `lib/v2/copy/settings-notices.ts`). Settings › Delete
redirects such a caller to Settings.
`pnpm --filter @crawlmouse/web exec vitest run "app/(account)/settings/pages.test.tsx"`

**The agency rail.** An account on the Agency tier gets `AGENCY_NAV`
(`lib/v2/view/account-actions.ts`): Clients (`/agency`, with the number of client sites in the
reader's records), Changes, Alerts, Reports, Seats, Settings. The locked rail's Branding is left out
(D11). An account on another tier keeps `ACCOUNT_NAV`. On the agency rail the brand carries the word
"Agency", and outside a trial the rail's card gives the plan's list price for the account's billing
period (`AGENCY_MONTHLY` or `AGENCY_YEARLY`, `prices.ts`) and the sites and seats of the account's
limits; to the owner of an account that is not past due and holds both, it also gives the renewal
date and the card's last four digits. A page under Sites (the dashboard, a site page) marks Clients
on the agency rail.

## 6. Seats and invitations

An account has one owner seat, and it cannot be removed or demoted. No transfer of ownership is built.
CC-29's rule of one Agency trial a person is kept by the owner's seat staying active, so a future
transfer of ownership must move that rule from the seat to the person.

**The rules are SQL's** (migration section A): `invite_seat`, `issue_seat_invite`,
`resend_seat_invite`, `read_seat_invite`, `accept_seat_invite`, `change_seat` and `remove_seat`, each
granted to `service_role` alone. A route asks `seat_may` through the caller's own session first.
`pnpm --filter @crawlmouse/web exec vitest run __tests__/v2-031-a-seats.test.ts` runs each outcome
below, the grants, and the migration applied twice and reverted.

| Rule                                                                                                                                                                                                                                                                                                                                          | Where it holds                                      |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| An invitation is a `seats` row of status `invited`. Its link's token is minted when the mail is sent, lives 7 days, and is stored as its sha256 (`seats.invite_token_hash`, `invite_expires_at`); the row holds no raw token.                                                                                                                 | `issue_seat_invite`; the CHECK `seats_invite_token` |
| A role is `account_manager` or `developer`. A scope is every client, or at least one live client site of the account that is not a staging copy.                                                                                                                                                                                              | `invite_seat`, `change_seat`, `seat_scope_valid`    |
| An address that holds an invited seat, or is the current address of an active member, is not invited again (`exists`). Addresses are compared in lower case and otherwise as written, so a plus-address is another address.                                                                                                                   | `invite_seat`                                       |
| The seat limit is the lower of `accounts.seat_limit` and the viewer's limit at that moment (the trial and past-due clocks read). Active seats and invited seats count toward it, an invited seat whose link has expired included, until it is removed. The count is made in the statement that writes the seat, under the account's row lock. | `invite_seat`                                       |
| A removed seat of the same address is written back to `invited` (its next invitation) rather than a second row added.                                                                                                                                                                                                                         | `invite_seat`                                       |
| An invitation is accepted by the signed-in user whose current address is the invited one, once. Another address is refused and the invitation stays usable.                                                                                                                                                                                   | `accept_seat_invite`                                |
| An acceptance is refused while the account's active seats are not below `accounts.seat_limit`.                                                                                                                                                                                                                                                | `accept_seat_invite`                                |
| An account marked for deletion neither invites nor gains a member (spec 27b).                                                                                                                                                                                                                                                                 | each function answers `marked`                      |
| A resend is the row's next invitation (`invite_seq + 1`): the link sent before stops working at once.                                                                                                                                                                                                                                         | `resend_seat_invite`                                |
| Removing a seat sets `removed`, deletes its `seat_sites` rows and gives the sites it owned to the owner's seat. `is_member`, `is_member_for_site` and `seat_may` read `status = 'active'`, so the person's next request is refused.                                                                                                           | `remove_seat`                                       |
| A seat id is looked up with the account the caller acts in, so another account's seat is `not_found`.                                                                                                                                                                                                                                         | `change_seat`, `remove_seat`, `resend_seat_invite`  |

Two invitations, or two acceptances, for the last seat: one passes and the other is `full`. That is
run on a real Postgres with two connections, and again on a database built without the function's
account lock, where both pass:
`cd scripts && TRIAL_RACE_DB_URL=… TRIAL_RACE_REQUIRED=1 pnpm exec vitest run db/seats-race.test.ts`.

**What `apply_entitlement_transition` does to seats** (migration `20261102000001`). On a transition
it removes the active seats that are not the owner's beyond the new seat limit, keeping those accepted
earliest. It does not count invited seats and does not change them: an invitation written before the
limit fell stays, with its link, and is refused at acceptance (`full`) while the active seats fill
the limit. It leaves the `seat_sites` rows and `sites.owner_seat_id` of a seat it removes, which
`remove_seat` clears and moves. The test file above runs a transition to a lower limit over an
account with members and an invitation.

**Routes** (each a 404 with `V2_CHECKS_PUBLIC` unset):

| Route                                      | Who                                                                  | Answers                                                                                                                                                        |
| ------------------------------------------ | -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/seats` `{email, role, scope}`   | `seat_may('invite_seat')`, in the account the caller acts in         | 201; 402 `upgrade_required` with gate `seats` and `canBuySeats` (Free, or no seat free); 409 `seat_exists`; 400 `invalid_scope`; 429 `rate_limited`            |
| `PATCH /api/seats/id/[id]` `{role, scope}` | `seat_may('change_seat')`                                            | 200; 404; 409 `seat_owner`                                                                                                                                     |
| `DELETE /api/seats/id/[id]`                | `seat_may('remove_seat')`                                            | 200; 404; 409 `seat_owner`                                                                                                                                     |
| `POST /api/seats/id/[id]/resend`           | `seat_may('invite_seat')`                                            | 200; 404; 409 `not_invited`; 429                                                                                                                               |
| `POST /api/seats/accept`                   | a signed-in user; the token is read from the `cm_link_invite` cookie | 200 or a 303 to `/dashboard`, with the switcher cookie set to the joined account; 410 `invite_gone`; 403 `email_mismatch`; 409 `invite_full`, `already_member` |
| `GET /invite/[token]`                      | anyone holding the link                                              | moves the token into the cookie and answers 303 to `/invite`; changes nothing                                                                                  |

A seat's own routes are under `/api/seats/id/`: a seat id directly under `/api/seats` would also match
`/api/seats/accept` and `/api/seats/switch`, and the route registry holds each path to one row
(`__tests__/security/route-policy.test.ts`, "no two rows overlap").

Invitation mail is bounded at 20 a day for an account and 10 an hour for a client address, an invite
and a resend counted together (`app/api/seats/route.ts`).

**The invitation's mail.** An invitation written or re-sent asks for its mail with the Inngest event
`seat.invite.requested {seat_id, seq}`, whose id is `seat_invite:<seat>:<seq>`
(`inviteMailEvent`, `lib/v2/agency/seats.ts`): the same invitation asked for twice is one event, and
a resend is another. The event holds no address and no token.
`pnpm --filter @crawlmouse/web exec vitest run lib/v2/agency/seats.test.ts app/api/seats/route.test.ts`.

## 7. Buying seats and sites

`POST /api/billing/seats` `{seats, sites}` sets the Agency plan's extra seats and extra sites to the
quantities given (absolute, not a difference). It answers 404 unless `V2_CHECKS_PUBLIC` and
`V2_BILLING` are both on, asks `seat_may('buy_seats')`, and answers 402 with gate `agencyBranding`
below Agency.

It makes one `subscriptions.update` on the account's subscription (`changeExtras`,
`lib/v2/agency/extras.ts`), through CC-03's Stripe client and catalog: an item the subscription holds
is changed by its id (deleted at quantity 0), and a new one is added at
`catalog.priceFor('agency', <the base item's interval>, kind)`. The route writes no limit:
`accounts.seat_limit` and `site_limit` change when the webhook applies the subscription Stripe
confirms.

| Case                                                                                                                               | Answer                                              |
| ---------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| Quantities the plan does not sell (`limitsFor`), or more than 100 extra seats in one request                                       | 400 `invalid`, before any Stripe call               |
| A seat limit below the seats in use (active, and invited with a link not yet expired), or a site limit below the live client sites | 409 `in_use`, before any Stripe call                |
| No subscription; one set to end; one not `active` or `trialing`; one whose items are not the catalog's Agency plan                 | 409                                                 |
| The card is declined on a raise                                                                                                    | 402 `payment_failed`; the subscription is as it was |
| The quantities the subscription already holds                                                                                      | 200 `changed: false`; no Stripe write               |

**Proration** (owner ruling, questions.md Q4). When either quantity rises the update is sent with
`proration_behavior: 'always_invoice'` and `payment_behavior: 'error_if_incomplete'` (`RAISE`): the
rest of the period is charged at once, and a charge that fails leaves the subscription unchanged.
When quantities only fall it is sent with `proration_behavior: 'none'` (`LOWER`): no credit, and the
lower quantity bills from the next invoice. A request that raises one quantity and lowers the other
is refused (400 `mixed_change`), since one update has one proration rule.

The idempotency key names the subscription, its latest invoice, the last event the mirror applied,
and the quantities the change starts from and ends at, so a retry of one request repeats it and the
same quantities bought, lowered and bought again do not.

`pnpm --filter @crawlmouse/web exec vitest run lib/v2/agency/extras.test.ts app/api/billing/seats/route.test.ts`
runs these against a Stripe subscription in memory and CC-03's fake catalog, and reads each
subscription the update leaves through `mirrorOf`, the webhook's reading.

## 8. The client matrix and the client page

### `/agency`

`app/agency/page.tsx` renders `agencyHomeView` (`lib/v2/view/agency-matrix.ts`) for the account the
caller acts in, in `MatrixScreen`:

| The account acted in                                                            | The page                                                           |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| on the Agency tier                                                              | the client matrix                                                  |
| below Agency, not an agency's, and the caller holds a seat on an agency account | "Open" and the agency's name: a form that posts to the switch (§5) |
| below Agency otherwise, an agency account with no plan among them               | the gate: `agencyGateMessage()` and a link to `/pricing`           |

**The matrix** (`Final-Ag-Matrix`). One row per client site in the records read for the caller's seat
(`readAccount`, whose site ids are the caller's own read: §4), so a seat that covers some clients
lists those. A staging copy has no row. A row's grades, pills, last check and schedule are the
dashboard's own site row (`dashboardView`), so a withheld grade reads "withheld" as it does there.
Rows with a problem opened since the site's previous check come first, then by host. The columns are
Site, Client, Technical SEO, AI readability, Since last check, Next check, Last check, and Schedule ·
report; Next check is an addition to the artboard.

The header counts the clients against the account's site limit; for a seat that covers some clients
it says how many are in the seat. The strip is absent until a client has two results. It then gives
"Clients needing a call" (clients with a problem opened since their previous check, of those with
two results), and Opened and Resolved when their count is not zero.

Adding a client is the dashboard's add-site form, posted to `POST /api/sites` for the account acted
in, offered to a seat that may add a site while the account has a site unused. Posted from `/agency`,
the route answers a form with a 303 back to `/agency`: with the new client as a row, or with a
refusal's notice. The pages a form may be sent back to are `BACK`'s four shapes
(`lib/v2/account/route.ts`): `/dashboard`, `/sites/<id>`, `/agency`, `/agency/clients/<id>`.

**First run.** `next` is setup's next step: the first of these that is not done and that the caller's
role may do. Its action is the page's orange element; with no step, "Add a client site" is.

| State                                                | The step                                    | Who                           |
| ---------------------------------------------------- | ------------------------------------------- | ----------------------------- |
| no client                                            | the header's form: add one                  | a seat that may add a site    |
| a client with no check, and none under way           | "Run it now": `POST /api/sites/[id]/checks` | a seat that covers the client |
| a client has a result, and the records hold one seat | "Open Seats" (`/seats`)                     | the owner                     |
| more than one seat, and no client report sent        | "Open client reports" (`/agency/reports`)   | the owner, an account manager |

A client with no result yet says in its row what its site page's first-check line says ("Not checked
yet", "First check queued"), with one button: start the check, or watch it. The first check of such a
client goes through the re-check route as it stands. That route queues it with the trigger `manual`
(`__tests__/v2-031-c-first-check.test.ts`), so it counts toward the site's `manualChecksPerSiteDay`.

Left out, each a `ruling` row in `lib/v2/copy/agency.ts`: "Audit a prospect", "Filter", "Export
matrix", and "Reports going out Mon · Preview".

### `/agency/clients/[siteId]`

`app/agency/clients/[siteId]/page.tsx` renders `agencyClientView` (`lib/v2/view/agency-client.ts`) in
`ClientScreen` (`Final-Ag-Client`), from the site page's view (`siteView`): the client's name over the
host and the site page's own line and actions; the two grades with their moves, without the parts
under each; the fixes still to do (open, open again, or not verified) as the site page's rows, with
their effects and packet links; and "This client": the contact, the report schedule and the owning
seat. Each of those rows links to where it is changed, `/agency/reports` for the owner and an account
manager and `/seats` for the owner.

It is a 404 for a malformed id, a site that does not exist, a removed one, a staging copy, and a site
the caller's seat does not cover. A client with no result yet is shown as the site page's first-check
screen, on the agency rail. On an account below Agency the page is the gate.

Left out, each a `ruling` row: the "What to tell … this week" paragraph (no view renders its
sentences from the data) with its two buttons, "Client portal", the line under the fixes about whose
name a packet carries, the report row's sender, and the seat row's alert channels.

### Both pages

`noindex`, `force-dynamic`, a 404 while `V2_CHECKS_PUBLIC` is off, and the sign-in page for a caller
who is not signed in. Neither has a `loading.tsx`: `find apps/web/app -name loading.tsx` prints no
file in this tree.

Previews, in `app/(v2-preview)/v2-preview/_preview/agency.ts`: the matrix; no client; a client not
checked; a first check queued; one seat; no report sent; a seat that covers one client; the gate;
the switch to an agency; the client page with a fix to raise, and with none.

`pnpm --filter @crawlmouse/web exec vitest run lib/v2/view/agency-matrix.test.ts lib/v2/view/agency-client.test.ts __tests__/v2/agency.test.tsx app/agency`

## 9. Reports, exports and the proof page

A report's content is a `ReportDoc` (`lib/v2/reports/generate.ts`): titles, tables and
before-and-after pairs, as strings.

## 10. Download, share and schedules

## 11. Erasure, gate messages and events

### Erasure

Workstream C adds no SQL. `erase_rules()` (migration 20261112000002, section B) is not restated.
`apps/web/__tests__/v2-031-c-erasure.test.ts` runs CC-27b's plan and apply on PGlite, through
`erasePerson` (`lib/v2/account/erase.ts`), for four people; for each, the plan's counts name the rows,
the erasure removes or blanks them, and a plan read again by address counts none.

| The person                                                                                            | What goes, and by which rule                                                                                                                                                                                           |
| ----------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| invited to another account's agency, not yet accepted                                                 | the invitation, by rule 28 (`seats deleted (invitations in other accounts)`); its `seat_sites` rows by their foreign key                                                                                               |
| holding an active seat on another account's agency                                                    | the seat, with the Auth user (rule 7); `sites.owner_seat_id` and `reports.owner_seat_id` are set null by their foreign keys; `share_links.created_by` is set null (rule 9). The agency's sites, reports and links stay |
| owning an agency with invited seats, stored reports, share links and a client contact                 | both of the person's accounts (rule 32) with their seats, sites, reports, schedules and share links; each stored report's file is in the plan's storage list and is removed before `apply`                             |
| the client contact and report recipient of another account, with an account of their own or with none | `sites.client_contact_email` (rule 30) and `reports.recipient_email` (rule 29) are set null; the rows stay                                                                                                             |

**Known gap, reported and not fixed here.** `sites.client_contact_name` is left beside the blanked
address: rule 30 sets `client_contact_email` and no rule names the name. The test
`known gap, reported: the contact’s name stays beside the blanked address` pins this, so a rule that
covers the name turns it red. The fix is one more column in rule 30's action, which restates
`erase_rules()`.

The storage list (`erase_person_counts`) names a report's file as bucket `reports` and object name
`reports.storage_path`. A file stored under another name or bucket is not listed.

`pnpm --filter @crawlmouse/web exec vitest run __tests__/v2-031-c-erasure.test.ts`

### Gate messages

`lib/v2/agency/gates.ts` writes what a reader is told at a limit, from `GATES` and `prices.ts`:
`gateMessage(gate, tier)`, `agencyGateMessage()` and `sitesFullMessage(tier)`. Its code holds no
digit (`gates.test.ts`, "has no digit in its code").

| Where                                                                                                                  | The sentence                                                                                                            |
| ---------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `/agency` and `/agency/clients/[siteId]` on an account below Agency                                                    | `agencyGateMessage()`                                                                                                   |
| the dashboard and `/agency`, after an add was refused because the plan's sites are in use (`?notice=upgrade_required`) | `sitesFullMessage(tier)`: the sites gate below Agency, and on Agency what a site beyond the plan's costs (`EXTRA_SITE`) |

`gates.test.ts` also reads three copy files for a price or a limit written as a digit: the matrix and
client copy (`lib/v2/copy/agency.ts`), `NOTICE_LINES` (`lib/v2/copy/notices.ts`) and
`OWN_ACCOUNT_COPY` (`lib/v2/copy/settings-notices.ts`).

Not moved to `gateMessage` by workstream C, each outside its paths: the dashboard's "Need more?" line
and its add-site label (`lib/v2/view/dashboard.ts`, which take their numbers from `GATES` and
`prices.ts`), the fix list's "on Pro" counts (`lib/v2/view/segment/fixes.ts`, `result.ts`) and the
fix page's Pro wall (`lib/v2/view/fix.ts`), which are locked copy on the public audit screens.

`pnpm --filter @crawlmouse/web exec vitest run lib/v2/agency/gates.test.ts lib/v2/copy/notices.test.ts`

### Events

The events of `AGENCY_EVENTS` (`lib/v2/agency/events.ts`), the workstream that sends each, and where.
On workstream C's branch one of them has a caller, `first_client_added`; the others are sent by the
workstreams named, on their branches.

| Event                      | Workstream | Sent by                                                                                                |
| -------------------------- | ---------- | ------------------------------------------------------------------------------------------------------ |
| `first_client_added`       | C          | `POST /api/sites`, when `add_site` reports the account's first site and the account's kind is `agency` |
| `seat_invited`             | A          | the invite route (`POST /api/seats`)                                                                   |
| `seat_accepted`            | A          | the accept route (`POST /api/seats/accept`)                                                            |
| `seats_bought`             | A          | `POST /api/billing/seats`                                                                              |
| `report_generated`         | B          | `POST /api/reports`                                                                                    |
| `report_downloaded`        | B          | `GET /api/report-files/[id]/download`                                                                  |
| `report_shared`            | B2         | `POST /api/report-files/[id]/share`                                                                    |
| `share_link_opened`        | B2         | the share link's handler (`/s/[token]`)                                                                |
| `proof_viewed`             | B2         | the proof page, opened through a share link or signed in                                               |
| `first_client_report_sent` | B2         | the function that sends a client report                                                                |

The callers on a tree: `grep -rnE "'(seat_invited|seat_accepted|report_generated|report_downloaded|report_shared|share_link_opened|proof_viewed|first_client_added|first_client_report_sent|seats_bought)'" apps/web/app apps/web/lib inngest --include=*.ts --include=*.tsx | grep -v "\.test\.\|agency/events.ts\|analytics-events.ts"`.

## 12. Where the tree changed a decision's form

- **Pages for Pro.** Seats and reports are sold on Pro, so `/seats` and `/reports` are not under
  `/agency` (questions.md Q1).
- **A pending report.** `reports.status` has no `pending`, and the contract is not changed: a
  database-only `reports.file_state` holds it (Q2).
- **Recipients.** A client report goes to the client's contact, `sites.client_contact_email`; its
  confirmation is recorded on `report_schedules` (Q3).
- **Seats are the owner's.** The locked Seats artboard gives seats to the owner alone (Q5).
- **402 on a page.** A page here answers 200, 404 or a redirect. An Agency-only page opened on a
  lower tier renders the gate; an Agency-only route answers 402 (Q12).
- **Tokens.** An invitation's and a share link's token is moved from the link's address into a cookie
  by a route handler, as CC-27b's emailed links are (Q15).
- **Proration.** A raised quantity is invoiced at once (`always_invoice`); a lowered one is not
  credited (`none`) and bills from the next invoice (owner ruling, Q4).

## 13. Known gaps
