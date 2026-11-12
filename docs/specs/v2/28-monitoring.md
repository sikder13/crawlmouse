# CC-28 — scheduled checks, alerts, and the mail the product has promised

The scheduler, the alerts, the mailer and the two pages that show them. Everything here is behind
`V2_CHECKS_PUBLIC` (`checksPublicEnabled`, `apps/web/lib/auth/flags.ts`), and the Inngest functions also
behind `V2_PIPELINE`; with them unset, the routes and pages answer 404 and the serve route registers what it
registered before. The SQL is migration `20261113000001_v2_028_monitoring.sql` (sections A–D); its revert is
`infra/supabase/rollbacks/20261113000001_v2_028_monitoring.revert.sql`.

## Decisions

| #   | Decision                                                                                                                                                                                                                                                                                                                                                                                                                   |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | One mailer, `apps/web/lib/v2/mail/`: `send()` over an injected `MailTransport` (Resend's in production, a file or memory transport anywhere else). The send ledger `email_sends` is claimed before the send (`claim_email_send`), keyed by the caller's idempotency key, holding a peppered hash of the address and no address or body. With Resend or the pepper unconfigured, nothing is claimed and the miss is logged. |
| D2  | Every promised email is a typed template, a pure function to `{subject, text, html}`, with a test, a development-only preview route and visual baselines at 600 and 390 px, light and dark.                                                                                                                                                                                                                                |
| D3  | Crawled and user text in mail is escaped and bounded; no crawled string is a link target; the recipient is never in the copy; headers are built from validated values (`headers.ts`).                                                                                                                                                                                                                                      |
| D4  | `scheduleTickFn`, hourly, claims due sites in SQL (`claim_due_sites`) and calls `requestCheck` with `scheduled`.                                                                                                                                                                                                                                                                                                           |
| D5  | `alertFn` on `check.finished` applies the account's rules and sends one message per site, check, channel and recipient.                                                                                                                                                                                                                                                                                                    |
| D6  | The weekly summary, for paid tiers, Monday 08:00 in the account's zone, never empty.                                                                                                                                                                                                                                                                                                                                       |
| D7  | Alert and summary mail carry `List-Unsubscribe` and `List-Unsubscribe-Post`; account mail does not. Bounces and complaints suppress non-account mail.                                                                                                                                                                                                                                                                      |
| D8  | `/alerts`, `/changes` and the per-site rule route on real data.                                                                                                                                                                                                                                                                                                                                                            |
| D9  | Every table this step adds joins the erasure.                                                                                                                                                                                                                                                                                                                                                                              |
| D10 | Mail from this step sends as `alerts@crawlmouse.com`; the sign-in sender move is prepared, not applied (`docs/ops/senders.md`).                                                                                                                                                                                                                                                                                            |
| D11 | `check_finished` from the `check.finished` listener; the next bucket for a re-check whose bucket's check has started; events for alert sent, summary sent, unsubscribed.                                                                                                                                                                                                                                                   |
| D12 | Out: deploy hooks and `on_deploy`, client reports, seats and invitations, pricing, packets, the unmark lifecycle, switching any flag on.                                                                                                                                                                                                                                                                                   |

## The send ledger (D1)

`send()` (`lib/v2/mail/send.ts`) runs, in order: the configuration check (no transport or no pepper: nothing
claimed, `mail.unconfigured` logged); the address check (not a plain address: nothing claimed); the claim;
`render()`, only after the claim answers `go`; the headers; the transport; `finish_email_send`.

| Claim answer     | Meaning                                                     | `send()` does                                 |
| ---------------- | ----------------------------------------------------------- | --------------------------------------------- |
| `go` (attempt n) | Send now; attempt 1 to 3.                                   | Renders, sends, records `sent` or `failed`.   |
| `done`           | The key was sent.                                           | Nothing.                                      |
| `busy`           | Another worker claimed it under 2 minutes ago.              | Throws `MailRetry`; the step retries.         |
| `suppressed`     | The address is suppressed and the kind is not account mail. | Nothing; the row records it.                  |
| `exhausted`      | Three attempts failed.                                      | Logs `mail.exhausted`; nothing more is tried. |

The retry rule: a retryable transport failure (network, 409 concurrent, 429, 5xx) records `failed` and throws
`MailRetry`, so the Inngest step retries and the next claim is the next attempt; three attempts in all. A
claim left `sending` for more than 2 minutes is a worker that died mid-send, and the next claim takes it back.
The transport sends the ledger key as Resend's `Idempotency-Key` (24 hours), so a send that did leave is not
sent again; a repeat whose payload changed is refused by Resend with 409 `invalid_idempotent_request`, which
the transport answers as sent.

The address hash is HMAC-SHA256 under `TRIAL_LEDGER_PEPPER` over `mail:` and the address trimmed and
lower-cased (`lib/v2/mail/address-hash.ts`). A `+tag` is not folded: a bounce on `x+tag@` suppresses that
address only, so a stranger cannot silence someone's own address through a tagged one they typed.

Verify: `pnpm --filter @crawlmouse/web exec vitest run lib/v2/mail __tests__/v2-028-mail.test.ts`, and the
two-transaction claim on a real Postgres: `scripts/db/monitoring-race.test.ts` (CI's `db-cli-files` job).

## The scheduler (D4)

When a schedule falls due is one SQL function, `next_check_after(cadence, weekday, hour, minute, zone,
after)`: weekly, the next ISO weekday at that local time; monthly, the first such weekday of a month. A local
time the clocks skip runs an hour later; a local time that happens twice runs once, at the later instant
(`__tests__/v2-028-schedule.test.ts` pins both for New York and London). `sites.next_check_at` is written by
a trigger on `sites` (schedule columns, `account_id`, `removed_at`) and one on `accounts.timezone`, for every
writer (owner ruling Q3); a site with no `schedule_offset_min` gets one from its id.

`claim_due_sites(now, limit, slot)` claims kept, live, unpaused weekly or monthly sites whose `next_check_at`
has passed, of accounts neither deleted nor marked for deletion, whose tier allows it at `now`: any site of a
paid tier; on Free, the first live primary site in `apply_entitlement_transition`'s order, run monthly
whatever its saved cadence (Q4). Rows another transaction holds are skipped. Each claim takes a
`global:audits:day` slot in a block rolled back on refusal; a refusal ends the claim and leaves the rest due.
A claimed site's `next_check_at` moves to the first due time after `now` in the same statement. The claim
returns, per site, `site_id`, `account_id`, `slot` (the time it was due, which keys the request,
`check:<site>:scheduled:<iso>`, so a retried request step makes the same check) and `next_at` (the
`next_check_at` it set).

When a site's request step fails every retry, `scheduleTickFn` catches it per site and runs a `release` step that calls `release_scheduled_claim` (owner ruling Q9):
`next_check_at` goes back to the claimed time, so the next tick claims the site again, and the slot is given
back while its 24-hour window is open. It acts only while `next_check_at` still holds the claim's `next_at`
(to the millisecond). A schedule saved since the claim keeps the time the save computed, a site removed since
keeps its null, and a second call finds the restored slot; in each, nothing is given back, so the slot of a
site saved or removed between its claim and its release stays spent for that day. Sentry is told the site id
and the slot. A release step that fails every retry as well is reported to Sentry (`schedule.claim_release_failed`,
site id and slot) and the tick goes on to the next site; that site keeps its moved due time and its slot is spent.

## The mail the product sends (D2, D3, D7, D11)

| Event                                                      | Function                      | Template                                                        | Idempotency key                                     | Who it goes to                                                                                |
| ---------------------------------------------------------- | ----------------------------- | --------------------------------------------------------------- | --------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `email.requested` `trial_reminder`                         | `lib/v2/mail/functions.ts`    | `trial-reminder`                                                | `trial_reminder:<account>:<trial end>`              | the owner, while `email_trial_reminder` is on and the account is unmarked and on a live trial |
| `email.requested` with `tokenId`                           | same                          | `email-change-confirm`, `email-change-notice`, `account-delete` | `account_link:<tokenId>`                            | `account_link_recipient`; the link is minted after the claim (Q10)                            |
| `check.notify_requested`, `check.finished`, `check.failed` | same                          | `check-notify`                                                  | `check_notify:<check>`                              | `checks.notify_email`, once the check has ended; a cancelled check is told as failed          |
| `fix.email_developer_requested`                            | same                          | `fix-to-developer`                                              | `fix_to_developer:<request>`                        | the request row's address; `sent_at` set after the send; the body is the packet as text       |
| `check.finished`                                           | `lib/v2/monitor/functions.ts` | `alert`                                                         | `alert:<check>:email:<seat>`, `alert:<check>:slack` | `alert_email_recipients`; Slack through the account's URL at send time                        |
| `summary.requested` (from the hourly summary tick)         | same                          | `weekly-summary`                                                | `summary:<account>:<ISO week>:<seat>`               | `summary_recipients`, never for an empty week                                                 |

`check_finished` is sent once per check from the `check.finished` listener, with the owner read from the
database and `source: 'pipeline'`; Inngest's idempotency on the check id holds it to one for 24 hours.

Alert and summary mail carry `List-Unsubscribe: <https://crawlmouse.com/api/unsubscribe?t=…>` and
`List-Unsubscribe-Post: List-Unsubscribe=One-Click`; the footer links the page `/unsubscribe?t=…`, which asks
before it changes anything. Both take the same signed token (`lib/v2/mail/links.ts`), which names one seat and one
kind and lasts 90 days. The POST route accepts a cross-site request (a mail client sends it), with the
webhook policy class. Account mail carries neither.

Slack is posted with `fetch` after the engine's `validateUrlOrThrow`, only to a `https://hooks.slack.com/services/…`
URL, with no redirect followed and a timeout: the engine's `safeFetch` makes GET requests only. The message is
plain text with Slack's `& < >` escapes and link previews off. `alert_events.destination_hash` is an HMAC under the
mail pepper of the sorted recipient hashes (email) or of the URL (Slack).

Every account has the six default rules (Q13): seeded by the migration's backfill, and again, for any kind missing,
before alertFn evaluates and before the Alerts page reads.

## Erasure (D9)

`erase.ts` adds the mail step to the sequence: the plan gains `erase_mail_records(hashes, false)`'s counts, the
apply is followed by `erase_mail_records(hashes, true)`, and the recount reads them again. The hashes are the plan's
addresses under the mail pepper; with no pepper the plan refuses (`mail_pepper`) rather than skip the step. Both
port sets implement it: `deletion-ports.ts` (the purge) and `scripts/ops/erase-account.ts`.

## Owner rulings

Q1–Q8, Q10 and Q11 approved as acted on (`questions.md` in the step's notes); Q9 changed to the release
above. In short: the erasure hashes the plan's addresses and deletes ledger rows by hash (Q1); suppressions
are kept on erasure (Q2); a trigger sets `next_check_at` (Q3); a Free first site runs monthly (Q4); the
sign-in sender stays `magic@` until switch-on (Q5); `EMAIL_LINK_SECRET` keys unsubscribe tokens (Q6); the
per-site rule route is `/api/sites/[id]/alert-rules` as `ACCOUNT_ACTIONS` names it (Q7); the trial reminder is
account mail with no unsubscribe, and honours `email_trial_reminder` (Q8, correcting spec 27); an account
link is minted only after the claim (Q10); unsubscribe and recipients are per seat (Q11).

## Known gaps

- A worker that dies after Resend accepted an account email and before `finish` makes the retry mint a new
  link token, which replaces the delivered one; Resend refuses the second send, so that email's link no
  longer works (Q10).
- Slack's incoming webhooks take no idempotency key: a worker that dies between the POST and
  `finish_slack_send` can repeat one Slack message when the claim is taken back.
- The tick runs hourly at minute 0, so a site due at 06:37 starts at the 07:00 tick.
- A claim whose database call committed but whose step result never reached Inngest is not released: the
  step's retry claims the next due sites, and the first set waits for its next due time (one cadence lost,
  one slot spent). Making the claim idempotent needs a claim keyed on the run (questions Q12).
- A site removed between its claim and its request step still gets its queued `scheduled` check.
- A claim whose request and release both fail every retry is not undone: the site waits for its next due time
  (one cadence lost, one slot spent), and Sentry has its id and slot.
- The unsubscribe page and route answer 404 while `V2_CHECKS_PUBLIC` is off, so turning the flag off after mail
  has gone out breaks those links until it is on again.
- Slack turns a bare URL in message text into a link (a fix title naming a page on the member's site); we build no
  link and previews are off.
- The weekly summary reads at most 5,000 changes per account-week; past that it logs `summary.read_capped` and its
  counts are of the rows read.
- `check_finished` replayed after Inngest's 24-hour idempotency window is counted again.
- A fix with no packet is answered `queued` and nothing is sent.
- The Alerts page shows what `changes.notified` records; a failed or suppressed channel (`alert_events`) is not
  shown.
- The Supabase ports for alerts and the summary (`alerts-store.ts`, `summary-store.ts`) are typechecked and their
  SQL is tested on PGlite; the PostgREST reads themselves have not run against a real PostgREST.
