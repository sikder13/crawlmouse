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

The address hash is HMAC-SHA256 under `TRIAL_LEDGER_PEPPER` over `mail:` and the address as
`normalizeEmail` folds it (`lib/v2/mail/address-hash.ts`): a `+tag` or a Gmail dot names the same mailbox for
a suppression.

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
A claimed site's `next_check_at` moves to the first due time after `now` in the same statement, and the
claim returns the time it was due, which keys the request (`check:<site>:scheduled:<iso>`), so a retried
request step makes the same check.

When the request step fails every retry, its `onFailure` calls `release_scheduled_claim` (owner ruling Q9):
`next_check_at` goes back to the claimed time, so the next tick claims the site again, and the slot is given
back while its 24-hour window is open. It acts only while `next_check_at` is still past the claimed time, so
a second call, or a schedule saved since, gives nothing back twice.

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
