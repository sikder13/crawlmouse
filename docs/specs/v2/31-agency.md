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
| D6  | `POST /api/reports` makes `audit_pdf`, `compare` and `raw_export` (the prospect's one-pager is not built, §9), server-side from stored data, into the private `reports` bucket.                                                                                  |
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
| `share_report`, `schedule_report`                                    | yes   | yes             | no        | + `is_member_for_site`     |
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

| Read                                                                        | Where                                                                     | Client                                     | Bound by                                               |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------ | ------------------------------------------------------ |
| The account, its seats, subscription, keys, brand, account-wide alert rules | `lib/v2/account/dataset.ts`, `settings-dataset.ts`                        | caller                                     | row security, `is_member`                              |
| The ids of the account's live sites                                         | `sitesInScope` (`lib/v2/agency/guard.ts`)                                 | caller                                     | `sites`' policy, `is_member_for_site`                  |
| `seat_sites`                                                                | both datasets                                                             | caller                                     | a row is visible when its site is (section S)          |
| Site rows, schedules, checks, fixes, fix events, changes                    | both datasets                                                             | service role                               | the ids `sitesInScope` returned                        |
| Site alert rules, reports                                                   | both datasets                                                             | caller                                     | row security, `is_member_for_site`                     |
| A site page's site                                                          | `siteOfCaller` (`lib/v2/account/pages.ts`)                                | caller                                     | `is_member_for_site`                                   |
| Edit, remove a site                                                         | `app/api/sites/[id]/route.ts`                                             | caller, then service role by site id       | `is_member_for_site`, `seat_may`                       |
| Add a site                                                                  | `app/api/sites/route.ts`                                                  | caller, then service role                  | `seat_may`, an unscoped seat                           |
| Re-check                                                                    | `app/api/sites/[id]/checks/route.ts`                                      | caller, then service role by site id       | `is_member_for_site`                                   |
| Mark done, packet, email a developer                                        | `app/api/fixes/[id]/*/route.ts`, `lib/v2/account/fixes.ts`                | caller, then service role by fix id        | `is_member_for_fix`                                    |
| A check's pages, stream, cancel, notify                                     | `readableCheck` (`lib/v2/pipeline/public.ts`)                             | service role, then caller                  | the caller's `sites` read for a kept site              |
| The Alerts page, the Changes log                                            | `app/alerts/page.tsx`, `app/changes/page.tsx`                             | as the dashboard's dataset                 | the ids `sitesInScope` returned                        |
| A site's alert switch                                                       | `app/api/sites/[id]/alert-rules/route.ts`                                 | caller, then service role by site id       | `is_member_for_site`                                   |
| A site's next check                                                         | `readNextChecks` (`lib/v2/account/sites-store.ts`)                        | service role                               | ids the dataset or `siteOfCaller` returned             |
| Making and downloading a report                                             | `app/api/reports/route.ts`, `app/api/report-files/[id]/download/route.ts` | caller, then service role by the row's ids | `is_member_for_site`, `seat_may`, the `reports` policy |

Each row is run as owner, account manager, developer in scope, developer out of scope, removed seat
and stranger: `pnpm --filter @crawlmouse/web exec vitest run __tests__/v2-031-scope.test.ts __tests__/v2-031-scope-routes.test.ts __tests__/v2-031-scope-monitoring.test.ts`; the report routes in their own tests (`app/api/reports/route.test.ts`, `app/api/report-files/[id]/download/route.test.ts`).

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

**Sending it.** The function `crawlmouse.mail.seat-invite` (`createSeatInviteFn`, `inngest/mail.ts`)
is one of the mail functions `mailFunctions` lists (`lib/v2/mail/functions.ts`), registered with
`V2_CHECKS_PUBLIC=1`. It runs `seatInvite(seat, seq)` (`lib/v2/mail/handlers.ts`) in one step, through
CC-28's `send()` (spec 28, the send ledger):

| Step  | What happens                                                                                                                                                                                                                                                                                                         |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Read  | `seatInvitation` (`lib/v2/mail/store.ts`): the invited address and the account of a seat whose status is `invited` and whose `invite_seq` is `seq`. No such seat (accepted, removed, or re-sent since) answers `not_invited`; an account marked for deletion, `marked`. Neither claims a ledger row or mints a link. |
| Claim | The ledger key is `seat_invite:<seat>:<seq>`, the kind `seat_invite`, with the address's hash and the account. The same event a second time is answered `done`.                                                                                                                                                      |
| Mint  | `issue_seat_invite(seat, seq, now)`, inside `render`, after the claim answered `go`. No row is `nothing_to_send`. The link is mailed when the address it was issued for is the address claimed.                                                                                                                      |
| Send  | The template `seat-invite`: which account invites the reader and as what, in the invitation page's words (`INVITE_COPY`); the link `/invite/<token>`; that it works for 7 days (`INVITE_LINK_DAYS`, which the template's test holds to `issue_seat_invite`'s interval); and that ignoring it changes nothing.        |

The account's name is escaped, bounded and left out when the account has none; the address is in no
part of the message. A resend is the next number, so another key and another mail, and
`issue_seat_invite` for it replaces the stored hash.

A suppression does not stop an invitation: `seat_invite` is account mail (`ACCOUNT_KINDS`,
`lib/v2/mail/types.ts`; `email_kind_suppressible` in SQL), with no unsubscribe header. The link is
in the mail and nowhere else, so an address that could not be mailed could not take its seat, while
the seat stayed held; and the invite routes bound how many are sent (above). The page's notice for a
written invitation says it will be emailed from `alerts@crawlmouse.com` (`seat_invited`,
`lib/v2/copy/notices.ts`).

Known gap, the one spec 28 states for an account link (its Known gaps, first item): after Resend
has accepted an invitation, a failure before the ledger records it as sent makes the retry mint a new
link, which replaces the delivered one, and Resend refuses the second send; that mail's link then
does not work and the owner sends the invitation again.

The mail over the migrated schema, with the real `issue_seat_invite`, `read_seat_invite` and
`claim_email_send`, and the handler and template alone:
`pnpm --filter @crawlmouse/web exec vitest run __tests__/v2-031-m-invite-mail.test.ts lib/v2/mail/handlers.test.ts lib/v2/mail/store.test.ts lib/v2/mail/recipient-not-in-copy.test.ts lib/v2/mail/templates/seat-invite.test.ts`.

**The mail kinds in SQL** (migration section C). `seat_invite`, `report_confirm` and
`client_report` join 028's two lists of kinds: the CHECK on `email_sends.kind` and
`email_kind_suppressible`. Section C rebuilds both from what they hold when it runs, with the three
added, so a kind that a migration sorting before this one added stays, with its answer under a
suppression. It raises and changes nothing unless the `kind` column has one CHECK and that CHECK is a
plain list. The revert takes the three out the same way, after deleting the ledger rows of those
kinds. `pnpm --filter @crawlmouse/web exec vitest run __tests__/v2-031-m-mail-kinds.test.ts` reads
the lists before the migration from the catalog, claims a row of each kind after it, and stands in
for an earlier migration's kind under two constraint names.

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

### What `POST /api/reports` makes

| Request                          | Row (`kind`, `format`)              | File in the `reports` bucket                                                             |
| -------------------------------- | ----------------------------------- | ---------------------------------------------------------------------------------------- |
| `audit_pdf` of one check         | `audit_pdf`, `pdf`                  | the audit document as a PDF                                                              |
| `compare` of one check           | `compare`, `html`                   | the baseline document, as JSON                                                           |
| `compare` with `previousCheckId` | `compare`, `html`                   | the before-and-after document of the two checks, as JSON                                 |
| `compare` with `fixId`           | `compare`, `html`, `subject_fix_id` | the document of a fix the check verified, beside the check it was compared with, as JSON |
| `raw_export` as `csv`            | `raw_export`, `csv`                 | one record per page response                                                             |
| `raw_export` as `edge_list`      | `raw_export`, `edge_list`           | `from,to,anchor`, one record per link                                                    |
| `raw_export` as `json`           | `raw_export`, `json`                | the check and its pages, links and crawler tests                                         |

A `compare` names its earlier check as `previousCheckId`, the field the Reports screen posts. The
route's answers, in order, are in the comment on `POST` in `apps/web/app/api/reports/route.ts`, and
each is a test in `route.test.ts` beside it.

The file is made inside the request and the row is written first: `create_report` writes it
`pending`, `finish_report` marks it `stored` with its path and size, `fail_report` marks it `failed`
with `build_failed`, `store_failed` or `object_left`. What was thrown is not stored or returned
(`generate-run.test.ts`), and `generate-run.ts` writes no log line
(`grep -c 'console\.' apps/web/lib/v2/reports/generate-run.ts` prints 0). A row still
`pending` fifteen minutes after it was asked for is marked `failed`, `abandoned`, by the account's
next request (`fail_abandoned_reports`). `reports.file_state` is the one of these columns a client
reads; `storage_path`, `failed_reason` and `subject_fix_id` are granted to no client role:
`pnpm --filter @crawlmouse/web exec vitest run __tests__/v2-031-b-reports.test.ts`.

A report has one object. Its name is `<account id>/<report id>.<extension>` (`reportPath`), it is
put over whatever is at that name, and `finish_report` accepts no other name for a report.

A report's row holds that name in `reports.storage_path` from its first write (`create_report`),
whatever its `file_state`, because the erasure finds a report's object by that column: an object a
dead request left behind is still one a row names. Whether the file is there to download is
`file_state = 'stored'`. A report that does not come to be stored is left without an object where
that can be done: after a throw while putting it or while marking the row stored, or when the row
stopped being pending while the file was made, `generateReport` reads the row again, keeps the
object of a row that is stored, and otherwise removes the object before it marks the row
`store_failed`. When the removal throws, the row is marked `object_left`. Each case is a test in
`lib/v2/reports/generate-run.test.ts`; the path and the CHECK that holds it (`reports_file_path`) in
`__tests__/v2-031-b-reports.test.ts`.

### What a document holds

Built by `lib/v2/reports/generate-doc.ts` from the view functions the audit pages draw from, read as
a paid plan reads them. A string of a document is one a view returned (a number it returned is
written as its digits), the screens' word for a crawler's verdict, or one of the titles and labels
in `lib/v2/copy/report-doc.ts`; the footer is "Checked with Crawlmouse" and the check's date, linking
the home page. `pnpm --filter @crawlmouse/web exec vitest run lib/v2/reports/generate-doc.test.ts`
holds the four documents to that over the contract fixtures, the recorded site and generated checks.

- **Audit** (`auditDoc`): the site, when it was checked and how much was crawled; both grades with
  their letter, score and summary (a withheld grade reads "withheld" with the page's reason); the
  access page's headline, figures and method, with a table of crawlers per group; what the
  no-JavaScript, structure and content pages head with, and their figures; the signals table; each
  live fix in the audit's order with its pages, estimated effect, effort and kind.
- **Baseline** (`baselineDoc`): the site, when and how much; both grades; the access section as
  above; what the no-JavaScript page heads with. It says what those pages say, so a site that
  something blocks reads as blocked.
- **Before and after** (`compareDoc`): each grade as a pair (letter, score and summary of each
  check, with each check's date); then, for each graded check after the earlier one up to the later
  one, what its Changes page heads with and each change it lists, as a pair: the lines removed on
  the earlier side, the cause and the lines added on the later side, with where, how many pages and
  the effect on the grades.
- **Fix verified** (`fixProofDoc`): the fix as its page showed it at the earlier check (its place
  among the open fixes, and what the packet said was wrong) beside its page at the later check
  ("Fix n, resolved" and when it was verified), then both grades as pairs.

Each document's `notMeasured` is, for its check: the partial notice; why AI readability is withheld;
that text without JavaScript, or the content checks, were not measured; the content checks the audit
did not record; and how many signals were tested when not each was. Each is the page's own sentence.
A comparison also lists what its earlier check did not measure, under its own heading.

Times in a document are the views' for a check read without its account: UTC, and they say so.

### The PDF

`lib/v2/reports/pdf.ts` and `pdf-layout.ts`: A4, with `pdf-lib` 1.17.1 and `@pdf-lib/fontkit` 1.1.1
(`grep -E '"(pdf-lib|@pdf-lib/fontkit)"' apps/web/package.json`), no browser. The fonts are Geist
Regular and SemiBold and Geist Mono Regular from the npm package `geist` 1.9.2 (SIL Open Font
License 1.1), in `apps/web/lib/v2/reports/fonts/` with the licence, embedded as subsets; `pdf.test.ts`
pins each file's sha256. They are read from disk, so `next.config.mjs` names them in
`outputFileTracingIncludes` for `/api/reports` and the Inngest route.

Text is wrapped at white space; a word wider than its column is broken between characters; a table's
column names are drawn again on each page it runs onto; a row or a pair taller than a page runs on.
What is drawn is the document's strings and each page's number:
`pnpm --filter @crawlmouse/web exec vitest run lib/v2/reports/pdf-layout.test.ts lib/v2/reports/pdf.test.ts`
(generated documents; the second reads what `pdf-lib` is given during a render). The not-measured
list is drawn after a rule, each sentence marked, with no heading: a `ReportDoc` has no string for one.

The same document gives the same bytes: the file carries no creation or modification time and no
producer.

### Raw exports

`lib/v2/reports/csv.ts`. The CSV's columns, in order: `url`, `final_url`, `status_code`, `kind`,
`template_key`, `title`, `meta_description`, `depth`, `links_in`, `links_out`, `pagerank_share`,
`is_orphan`, `js_only`, `found_via`, `sitemap_lastmod`, `suggested_parent_url`, `sampled`,
`raw_words`, `rendered_words`, `text_share`, `text_state`, `crawlers_reached`,
`crawlers_reading_text`, `content_failures`, `is_html`, `links_read`. What was not read is an empty
cell, `links_out` included where `links_read` is false. A page's redirects, declared canonical, hreflang and robots.txt verdicts are in the JSON file.

In both CSV files a value that starts with `=`, `+`, `-`, `@`, tab or carriage return has an
apostrophe put before it, and each cell is written in double quotes with its quotes doubled (RFC
4180); records end with CRLF. `pnpm --filter @crawlmouse/web exec vitest run lib/v2/reports/csv.test.ts`
reads the files back with a reader of its own over generated strings. The files are UTF-8 without a
byte-order mark.

The JSON file holds the contract's records of the check, its page results, link edges and access
tests. Each of their fields is a column a member's own session may select:
`pnpm --filter @crawlmouse/web exec vitest run lib/v2/reports/csv.columns.test.ts`.

### Measured

`pnpm --filter @crawlmouse/web exec vitest run lib/v2/reports/pdf.measure.test.ts` prints these: each
file made three times, the median, with `--maxWorkers=2`, on the build machine on 2026-11-12. The
sizes are the same on each run. The times are a machine's and moved with its load: the first column
of times is one run at 16:28 with nothing else running; the second is the range of three runs of the
final tree between 17:07 and 17:10, while other suites kept the load average near 15.

| Check                                                                         | `auditDoc` + `renderPdf`, quiet | under load    | PDF                   | CSV           | Edge list     | JSON            |
| ----------------------------------------------------------------------------- | ------------------------------- | ------------- | --------------------- | ------------- | ------------- | --------------- |
| the engine's recorded site (60 pages, 150 links, 400 crawler tests, 11 fixes) | 193 ms                          | 611 to 835 ms | 35,918 bytes, 4 pages | 20,800 bytes  | 16,468 bytes  | 1,309,952 bytes |
| a generated check of 500 pages (1,359 links, 168 crawler tests, no fix)       | 114 ms                          | 442 to 458 ms | 31,504 bytes, 3 pages | 147,930 bytes | 124,319 bytes | 911,442 bytes   |

Each raw export took 7 ms or less in those runs. The audit document does not list pages, so its cost
does not grow with them: the larger time is the recorded site's, which has fixes and more crawler
tests. These times leave out reading the check from the database. The decision's bound for making a
report in the request is two seconds for a 500-page check; 458 ms is the slowest seen, so a report
is made in the request (`maxDuration` 60) and no Inngest function makes one.

### What a report does not hold

- A drawing of the link map. The audit PDF has the structure page's figures (pages, links, orphans,
  JavaScript-only pages, click depth); the Reports screen's `pdfBody` (`lib/v2/copy/reports.ts`)
  says "link map", which names more than the PDF draws.
- The table of orphan pages, the content grid, a page-by-page list, and raw responses. The pages are
  the CSV; the responses are in the JSON.
- The steps and commands of a fix's packet. The proof of a fix quotes the packet's statement of what
  was wrong (`head.lede` of the fix page).
- An account's name, logo or domain: Branding is not in this step (D11).

### Not built: the prospect's one-pager

D6 names a fourth kind, a one-pager about a prospect's site that holds no site slot. It is not built
(questions.md Q18). `POST /api/reports` does not take the request (400 `invalid`), `create_report`
refuses the kind (22023), and no function writes a prospect's site.

### The proof page

The proof page is what an agency shows its client: a report of format `html`, drawn from the
`ReportDoc` stored for it when it was made (`REPORT_FILES.html`, read back by `parseStoredDoc` in
`lib/v2/reports/share-doc.ts`). It is outside the locked artboards: no artboard draws it. It is
built from the design system's Card, Heading and Table (`components/v2/screens/proof/ProofScreen.tsx`,
view `lib/v2/view/proof.ts`).

What it shows, in the document's order: the title, the lines under it, each section with its text,
facts, tables and before-and-after pairs, then the not-measured list under the page's own label,
then the document's footer line as a link to the address the document gives when that address is
an https one. A pair is two columns, each with its label, date, value and evidence; at 760px and
narrower the two are stacked (`ProofScreen.module.css`). The page has no form, no button and no
orange element: its previews are registered with `orange: 0`.

The page adds three labels of its own, kept in `lib/v2/copy/proof.ts`: "Not measured", and
"Before" and "After" for a pair's side whose own label is empty. A property test renders generated
documents and holds each text node of the page to the document's strings and those labels, and
holds each non-empty string of the document to appear on the page:

```bash
pnpm --filter @crawlmouse/web exec vitest run components/v2/screens/proof/ProofScreen.test.tsx
```

Two pages draw it. `/reports/[id]` is for a signed-in member: the report is read through the
caller's own session, and a report that session does not read, one that is not of format `html`, and
one with no stored document are a 404. `/s/view/[reportId]` is for whoever opened the report's share
link (§10). Each sends `proof_viewed`, with `via: 'account'` or `via: 'share'`.

```bash
pnpm --filter @crawlmouse/web exec vitest run 'app/s/view/[reportId]/page.test.tsx' lib/v2/reports/share-doc.test.ts
```

Previews: `/v2-preview/screens/proof` (two grades moved), `/proof/fix` (a fix verified) and
`/proof/baseline`. Their documents are stand-ins written in `_preview/proof.ts`; the generator's own
documents replace them once it is on the branch.

## 10. Download, share and schedules

### Share links

A share link opens one report for whoever holds it, with no account. The token is 16 random bytes
in base64url, 22 characters (`newShareToken`, `lib/v2/reports/share.ts`); `share_links` holds its
sha256, and the CHECK `share_links_token_hash` refuses a value that is not 64 lowercase hex
characters. The rules are four SQL functions in migration `20261114000002`, section B, granted to
`service_role`:

| Function             | What it does                                                                                                                                                                            |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `create_share_link`  | Needs a stored file (`report_file_stored`); revokes the report's earlier links; writes the new one, expiring 30 days on, and sets `reports.share_expires_at`. `not_ready`, `not_found`. |
| `open_share_link`    | In one statement counts the view and returns the report's id, account, site, kind, format and path. `gone` for a link that exists and does not open; `unknown` for none.                |
| `read_share_link`    | The same answer with no count: the shared page's own read.                                                                                                                              |
| `revoke_share_links` | Sets `revoked_at` on the report's links and clears `reports.share_expires_at`.                                                                                                          |

Whether a report's file is stored is asked in one SQL function, `report_file_stored`
(`file_state = 'stored'`; a row names its object from its first write, so the name alone does not say
the file is there), which the three functions above that need it call. A link does not open once it
is revoked, from the moment of its expiry, when its report's file is
no longer stored, and while its account is deleted or marked for deletion.

```bash
pnpm --filter @crawlmouse/web exec vitest run __tests__/v2-031-b2-share.test.ts
```

`POST /api/report-files/[id]/share` makes the link and `DELETE` (or a form's `_method=DELETE`)
revokes it. The report is read through the caller's own session, so a report of a client the seat
does not cover is a 404; `seat_may('share_report')` refuses a developer with 403; making a link
needs the plan's `exports` gate (402) and a stored file (409 `not_ready`), under a bound of 60 an
hour for the account. The link is answered once: JSON gets `{url, expiresAt}`; a form gets a 303 to
`/reports?notice=share_made` with the link in the HttpOnly cookie `cm_share_made`, scoped to
`/reports`, which the page shows on the report's row. That cookie lasts 120 seconds and is not
cleared sooner: a page cannot clear a cookie.

`GET /s/[token]` opens a link. In order: a 404 with `V2_CHECKS_PUBLIC` unset; a 404 for a value that
is not token-shaped, before the rate limit and any database call; a bound of 60 an hour for the
address (429); a 404 for a token no link holds; **410** with a static HTML page for a link that has
expired or was revoked. A link that opens is counted, then answered by format: a file is a 302 to
a signed URL of the stored object that lives 60 seconds, and a proof page is a 303 to
`/s/view/[reportId]` with the token in the HttpOnly cookie `cm_share`, scoped to that path for 600
seconds. The token is therefore in one address, the link's own. A signed URL already handed out
keeps working until its 60 seconds end, so a revoked link stops opening a file within a minute.
Each answer after the flag check carries `Cache-Control: no-store`, `Referrer-Policy: no-referrer`
and `X-Robots-Tag: noindex, nofollow`.

```bash
pnpm --filter @crawlmouse/web exec vitest run 'app/api/report-files/[id]/share/route.test.ts' lib/v2/reports/share.test.ts
```

A header set in `next.config` replaces a route's own, so `lib/security/headers.mjs` sets
`Referrer-Policy: no-referrer` for `/s` and the paths under it; and the `/s/<22 characters>` path
is scrubbed from what Sentry is sent.

```bash
pnpm --filter @crawlmouse/web exec vitest run __tests__/security/headers.test.ts lib/auth/sentry-scrub.test.ts
```

`/reports` lists the reports the caller's session reads, with what the page alone knows handed to
the view (`ReportsSide`, `lib/v2/view/reports.ts`): each report's file state, the reader's role on
the account, and a link just made. The file state is the generator's `reports.file_state`
(`pending`, `stored`, `failed`), read by `reportFileStates` (`lib/v2/reports/share-proof.ts`); whether
a file is stored is asked in one place in that file, `storedIn`, which the Reports page's file states
and the signed-in proof page both read.

```bash
pnpm --filter @crawlmouse/web exec vitest run app/reports/page.test.tsx lib/v2/view/reports.test.ts __tests__/v2/reports.test.tsx
```

### Client report schedules

A client's report goes to the client's contact, `sites.client_contact_email`, one address a site.
`set_client` is the writer of `sites.client_name`, `client_contact_email` and `owner_seat_id`. It
does not write `sites.client_contact_name`: this step stores no contact name, because the erasure
rules name the contact's address and no rule names the contact's name. A key `set_client` does not
set raises 22023.

A schedule is one `report_schedules` row a site: weekly or monthly, a weekday, a time and a zone.
`report_schedule_next` gives the next run: the next such weekday at that time in the zone, and for
`monthly` the first such weekday of a calendar month. `report_schedules` gains four columns granted
to no client role: `recipient_confirm_hash`, `recipient_confirm_sent_at`, `recipient_confirmed_at`
and `pause_token_hash`.

| Route                                                      | What it does                                                                              |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `PUT`, `DELETE /api/report-files/schedules/site/[siteId]`  | Saves or removes the schedule (`set_report_schedule`, `clear_report_schedule`).           |
| `PATCH /api/report-files/schedules/site/[siteId]/client`   | The client's name, contact and owning seat (`set_client`).                                |
| `POST /api/report-files/schedules/site/[siteId]/confirm`   | Asks for the confirmation mail again; 409 `nothing_to_confirm` when there is none to ask. |
| `POST /api/report-files/schedules/site/[siteId]/resume`    | Resumes a schedule its recipient paused; the next run is the first after the resume.      |
| `GET /s/confirm/[token]`, `POST /api/report-files/confirm` | The recipient's confirmation link, and the press that confirms.                           |
| `GET /s/pause/[token]`, `POST /api/report-files/pause`     | The recipient's pause link, and the press that pauses.                                    |
| `POST /s/pause/[token]`                                    | A mail client's one-click unsubscribe (RFC 8058): the body `List-Unsubscribe=One-Click`.  |

The four account routes ask `is_member_for_site` (404), then `seat_may('schedule_report')` (403 for
a developer), then the plan's `agencyBranding` gate (402). They sit under `schedules/site/` so that
no path is also one of a report's `[id]/…` routes. A form posted with `_method` is read as the verb
it names.

**Double opt-in.** No report is sent to a contact that has not confirmed. The confirmation mail's
link is used within seven days of being issued and works once; issuing another replaces it. A
contact address that changes clears the confirmation, both links' hashes and the recipient's pause,
in the statement that writes the site. A changed contact is asked to confirm when it is saved,
within the account's bound of 20 confirmation requests a day; past that bound the save stands and
the schedule's next run asks.

**The recipient's links.** Each link's GET moves its token into an HttpOnly cookie and redirects
to a page with no token in its address (`/s/confirm`, `/s/pause`); the page says what the button
will do, and the button's POST reads the token from the cookie. A GET changes nothing. The pause
link's address also takes a mail client's one-click POST, which carries no cookie, so for that one
request the token is the path's. A pause link is minted when a report is sent
(`issue_report_pause`), and minting replaces the one before: the link that pauses is the one in the
latest report sent.

```bash
pnpm --filter @crawlmouse/web exec vitest run __tests__/v2-031-b2-schedules.test.ts 'app/api/report-files/schedules/site/[siteId]/route.test.ts' app/s/confirm/page.test.tsx components/v2/screens/share/RecipientLinkScreen.test.tsx
```

**Sending.** `crawlmouse.report.schedules` runs at minute 7 of each hour, with `V2_CHECKS_PUBLIC=1`
(`inngest/report-schedules.ts`, `lib/v2/agency/schedules-run.ts`). For each schedule
`due_report_schedules` lists (not paused, its next run reached) it decides in this order, and then
moves the schedule to its next run whatever it decided:

1. the account's plan has no client reports at that moment: nothing is sent;
2. the client has no contact: nothing is sent;
3. the contact has not confirmed: the confirmation mail is asked for if none was issued yet, and no
   report is sent;
4. the account is in its Agency trial and the contact is not the owner's own address: nothing is
   sent;
5. the site has no finished check: nothing is sent;
6. no change other than a baseline was detected since the last client report sent for the site, and
   the schedule does not send unchanged: nothing is sent;
7. otherwise `write_client_report` writes the slot's row (`client_report`, `scheduled`, one a site
   and slot) and the report's mail is asked for.

The run stops at a port, `ClientReportMail`. Its implementation here sends two Inngest events that
hold an id and no address: `report.confirmation.requested {site_id}` and `report.send.requested
{report_id}`. A report handed on this way stays `scheduled`. The mailer's handlers, written with
the mail kinds, read the address and mint the link when they send (`issue_recipient_confirmation`,
`issue_report_pause`) and mark the row sent (`mark_client_report_sent`, which answers whether it is
the account's first: `first_client_report_sent`).

```bash
pnpm --filter @crawlmouse/web exec vitest run lib/v2/agency/schedules-run.test.ts lib/v2/agency/schedules-run.pglite.test.ts lib/v2/pipeline/functions.test.ts
pnpm --filter @crawlmouse/inngest exec vitest run report-schedules.test.ts
```

**Not built.** `/agency/reports`, the screen of `Final-Ag-Reports` that would carry the schedule
forms, is not built: the routes above answer JSON and forms, and a form's answer redirects to that
address. Of what the artboard draws, this step has no route for "Hold all this week", "Hold",
"Edit headline", "Preview and edit", the Opened column (open tracking) or the sender address
(Branding is out: D11).

### The two mails of a schedule

A client report schedule sends two kinds of mail, each a kind of CC-28's ledger (§6, "The mail kinds
in SQL") with a template in `lib/v2/mail/templates/` and a handler in `reportMailHandlers`
(`lib/v2/mail/handlers.ts`):

| Kind             | Event                                                 | Ledger key                           | Template         | Under a suppression |
| ---------------- | ----------------------------------------------------- | ------------------------------------ | ---------------- | ------------------- |
| `report_confirm` | `report.confirmation.requested {site_id, request_id}` | `report_confirm:<site>:<request_id>` | `report-confirm` | sent                |
| `client_report`  | `report.send.requested {report_id}`                   | `client_report:<report>`             | `client-report`  | not sent            |

- **The confirmation** says which agency asks to send reports about which site, links
  `/s/confirm/<token>`, and says that no report is sent unless the reader confirms and that they need
  no account. `request_id` names one request: the same value again is answered `done`, and the next
  request is another mail. An empty one, or one longer than 100 characters, is `invalid_request`.
- **The report** shows the report document's own title, lines and closing line
  (`ReportDoc.title`, `.lines`, `.footer.text`) as given, and links the report (`/s/<token>`) and the
  schedule's pause (`/s/pause/<token>`). The pause link is also the message's `List-Unsubscribe`
  target, with `List-Unsubscribe-Post: List-Unsubscribe=One-Click`. The template writes no sentence
  about what a check found.
- **Each link is minted after the ledger's claim**, as an account link is (spec 28, Q10): a handler
  reads who the mail goes to before the claim (`confirmationRecipient`, `clientReportRecipient`) and
  mints inside `render` (`issueConfirmation`, `issueClientReport`). An issue that answers null, or
  that names another address than the one claimed, is `nothing_to_send`.

The handlers take their reads and mints through the port `ReportMailStore`
(`lib/v2/mail/store.ts`), and their Inngest functions are `createReportConfirmFn` and
`createClientReportFn` (`inngest/mail.ts`). The port is declared and used and has no implementation
over the database, and `mailFunctions`, the list of mail functions a deployment registers, holds
neither function:
`grep -rln 'ReportMailStore' apps/web/lib apps/web/app --include='*.ts' | grep -v '\.test\.'; grep -n 'Fn(handlers)' apps/web/lib/v2/mail/functions.ts`.

`pnpm --filter @crawlmouse/web exec vitest run lib/v2/mail/handlers.test.ts lib/v2/mail/recipient-not-in-copy.test.ts lib/v2/mail/templates/report-confirm.test.ts lib/v2/mail/templates/client-report.test.ts`
and `pnpm --filter @crawlmouse/inngest exec vitest run mail.test.ts`.

Known gaps. A contact whose address is under a suppression (a hard bounce or a complaint) is still
sent the confirmation, and a report to that address is then answered `suppressed` and not sent; no
screen says so. And the gap §6 states for an invitation's link holds for these links: a failure
between Resend's acceptance and the ledger's record makes the retry mint again.

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
`reports.storage_path`, which a report row holds from its first write (§9), so the object of a
pending or failed report is listed too. A file stored under another name or bucket is not listed.

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
