# SPEC 03: v2 billing on the account model, behind `V2_BILLING` (CC-03)

v2 bills **accounts** through the entitlement machine (`apps/web/lib/billing/state-machine.ts`, CC-02) on the
Crawlmouse Stripe account (sandbox `acct_1UYedfQtByP9zja4`, test mode). v1 billing — `users.pro_until` on the
Nahl Technologies account — is untouched and keeps serving its customer until the cutover.

## Decisions

| #   | Decision                                                                                                                                                                                                                                                                                                                                            | Where                                                                                |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| D1  | One flag, `V2_BILLING`, read only in `lib/billing/flags.ts`. Unset: every v1 billing route and the v1 webhook answer as on main. Set: the v2 handlers. Production keeps it unset in this step.                                                                                                                                                      | `lib/billing/flags.ts`                                                               |
| D2  | A separate webhook, `POST /api/webhooks/stripe-account`, secret `STRIPE_ACCOUNT_WEBHOOK_SECRET`; the signature is checked on the raw body before anything else; an event whose `livemode` is not `STRIPE_ACCOUNT_LIVEMODE === 'true'` is recorded and refused with 400. The v1 webhook is not edited.                                               | `app/api/webhooks/stripe-account/route.ts`                                           |
| D3  | Prices by lookup key only; `planOfPrice` is the allow-list a webhook event's prices are read through; checkout takes `{plan, interval}`, never a price id; an event naming a foreign price is recorded `handled=false` and changes nothing.                                                                                                         | `lib/billing/catalog.ts`, `stripe-catalog.ts`                                        |
| D4  | Three layers: the `stripe_events` ledger (skip only when `processed_at` is set), the out-of-order guard on `subscriptions.last_event_created`, and customer binding (`client_reference_id` = account id on checkout; `accounts.stripe_customer_id` afterwards; no account for a subscription event → throw, Stripe retries).                        | `lib/billing/stripe-webhook.ts`, migration `20261110000001`                          |
| D5  | Every state change goes through `next()`, applied by `applyEntitlementTransition` with the `subscriptions` upsert and the ledger decision in one RPC, `apply_stripe_event(p jsonb)`; effects are carried out by `lib/billing/effects.ts`.                                                                                                           | `lib/billing/effects.ts`, `state-machine-apply.ts`                                   |
| D6  | Checkout: the account's owner; 409 when the state holds the plan or a higher one; the account's Stripe customer, created once with idempotency key `customer:<account id>`; `client_reference_id` and `metadata.account_id`; automatic tax; the account's own pages as success and cancel URLs. A Pro trialist choosing Pro is charged at checkout. | `app/api/billing/checkout/route.ts`, `lib/billing/checkout-v2.ts`                    |
| D7  | Agency trial with a card: owner; 409 when `trialRefusal` refuses the account as read; Checkout with a 14-day trial and the card always collected. No ledger rows (CC-04).                                                                                                                                                                           | `app/api/billing/agency-trial/route.ts`                                              |
| D8  | Cancel: owner, two posts (the second with `confirm: true`), `cancel_at_period_end`, the state change through the webhook. Portal: payment method, invoices and cancellation only.                                                                                                                                                                   | `app/api/billing/cancel/route.ts`, `portal/route.ts`                                 |
| D9  | Our clock: `trialLifecycleFn` (reminder at end − 3 days, expiry at the end) on `trial.started`, which the first-login hook now sends; `pastDueSweepFn` hourly. Both registered only under the flag, concurrency literals ≤ 5.                                                                                                                       | `inngest/trial-lifecycle.ts`, `inngest/past-due-sweep.ts`, `lib/auth/first-login.ts` |
| D10 | `reconcileBillingFn` gains a v2 step under the flag that reports drift to Sentry (`reconcile.drift`) and repairs nothing; the v1 step is unchanged.                                                                                                                                                                                                 | `inngest/billing.ts`, `lib/billing/reconcile-v2.ts`                                  |
| D11 | Every v2 billing POST is in CC-SEC's route registry with the strict origin rule.                                                                                                                                                                                                                                                                    | `lib/security/route-policy.ts`                                                       |
| D12 | A sandbox smoke, skipped without `STRIPE_ACCOUNT_TEST_SECRET_KEY`, feeds real Stripe events through the handler against PGlite.                                                                                                                                                                                                                     | `lib/billing/stripe-sandbox.smoke.test.ts`                                           |
| D13 | Production changes only through migration `20261110000001_v2_billing_rpc.sql` and the pipeline (dry run, merge, owner approval).                                                                                                                                                                                                                    | `infra/supabase/migrations/`                                                         |
| D14 | Out of this step: the Agency trial and pricing pages (CC-29), seat and extra-site quantities (CC-31), receipts copy, the live account and its webhook (cutover), the reminder email (CC-28), the `card_fingerprint` and `hostname` ledger kinds and the 13-month sweep (CC-04).                                                                     | —                                                                                    |

## Questions put to the owner

Each is built as recommended, in a commit of its own, so a different ruling is a revert. Rulings pending.

| Q   | What the build does                                                                                                                                                                                   | Departs from                       |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| Q1  | `stripe_events` gains `handled`, `handled_reason` and `effects`: the decision and its planned effects are written with the transition, and `processed_at` is stamped only once the effects are sent.  | D13 (more than the RPC)            |
| Q2  | `effects.ts` carries out nothing for `relimit`, `pause_others`, `pause_over_limit` and `resume`: `apply_entitlement_transition` has applied them in the same transaction since migration 003.         | D5 ("through state-machine-sites") |
| Q3  | Checkout is refused (409 `subscription_open`) while the account follows any subscription, not only one that holds the plan: a checkout would open a second subscription that Stripe keeps charging.   | D6                                 |
| Q4  | `lib/auth/door-deps.ts` gains the first-login hook's `dispatch`.                                                                                                                                      | allowed paths                      |
| Q5  | `inngest/client.ts` types `trial.started`, `trial.converted`, `entitlement.changed` and `email.requested`.                                                                                            | allowed paths                      |
| Q6  | The hourly sweep also expires no-card trials past their end, in case `trial.started` was lost.                                                                                                        | D9 (addition)                      |
| Q7  | v2's portal uses its own configuration (metadata `crawlmouse_key: portal_v2_billing`) with payment method, invoices and cancel at period end; the sandbox's default allows plan and customer changes. | —                                  |
| Q8  | The webhook checks the flag after the signature, as CC-SEC's verified-first rule requires.                                                                                                            | D1 (order)                         |
| Q9  | The card-required Pro trial (DECISION-LOG U3) is not built; `trialVariantFor` stays `no_card`.                                                                                                        | —                                  |
| Q10 | The webhook cancels a subscription a checkout leaves the account not following: at once; a paid one also raises `billing.orphaned_subscription` for a refund by hand.                                 | D1–D14 (a Stripe write)            |
| Q11 | The price allow-list gates grants; revokes apply whatever the price, with the plan from the mirror row.                                                                                               | D3                                 |
| Q12 | Both Checkout sessions take cards only.                                                                                                                                                               | D6, D7 (addition)                  |
| Q13 | A dispute also cancels the account's subscription, at once.                                                                                                                                           | D1–D14 (a Stripe write)            |
| Q14 | Cancel on a `past_due`, `unpaid` or `paused` subscription cancels at once; `active` and `trialing` keep the period end.                                                                               | D8                                 |
| Q15 | Every v2 billing route takes an optional `accountId` (required on the agency trial), checked with `member_role = 'owner'`; absent, the caller's sole owned account.                                   | —                                  |
| Q16 | A subscription event whose customer has no account is retried (500) while under an hour old, then recorded with a Sentry error.                                                                       | D4                                 |
| Q17 | `scripts/db/stripe-event-race.test.ts` joins the race step of CI's `db-cli-files` job.                                                                                                                | allowed paths                      |

## Review findings before the build

The plan's money-path review (19 findings) is folded in. The ones that shaped the design: an ignored or
replaced checkout leaves a live subscription billing (review finding 1: Q10, and the routes expire the
customer's open sessions); a late or concurrently decided revoke could undo a payment (finding 2: the
out-of-order guard runs inside `apply_stripe_event` under row locks, and a superseded event applies
nothing); a livemode refusal must not look processed (finding 3); a transient Stripe error must be retried,
never recorded (finding 4); cards only (finding 6: Q12); a dispute and a past-due cancel stop the charges
(findings 8 and 9: Q13, Q14); which account a route bills (finding 11: Q15); a founder alert is delivered
before the event is marked done (finding 15).

## The webhook

`POST /api/webhooks/stripe-account` (`app/api/webhooks/stripe-account/route.ts`): with
`STRIPE_ACCOUNT_WEBHOOK_SECRET` unset it answers 500; it checks the signature on the raw body with the static
`Stripe.webhooks.constructEvent`, then reads the flag (unset: 404, Q8), then hands the event to
`applyStripeEvent` (`lib/billing/stripe-webhook.ts`): 200, 400 for a livemode refusal, 500 on a throw so
Stripe retries. It logs a fixed line, the event's type and id, and an error's message; never the body or the
signature.

`applyStripeEvent`, in order:

1. **Ledger.** `stripe_events` gets `id, type, livemode`. Already processed: nothing is done. Decided but not
   stamped (a crash or a failed send after the decision): the stored effects are sent again and the row is
   stamped. A livemode mismatch is written with `handled` and `processed_at` null, so the same event retried
   after the configuration is fixed is processed (review finding 3).
2. **Normalise** (`lib/billing/stripe-normalise.ts`). Each Stripe event becomes one of the machine's events,
   a record-only decision, or a refusal. Subscription status and extras are read from Stripe at processing
   time; `at` is `event.created` for every Stripe event (review finding 12). The payload is read only for
   version-stable fields (ids, `type`, `created`, `livemode`, `customer`, `client_reference_id`,
   `metadata`, `subscription`, an invoice's `parent`). A Stripe error here propagates: the event is retried,
   never recorded as foreign (review finding 4). Prices go through the allow-list; grants need allow-listed
   prices and revokes do not (Q11). An update whose retrieved status differs from its payload's, and a
   payment failure whose retrieved status is not `past_due` or `unpaid`, are recorded `superseded` and apply
   nothing: the event that made the change carries it.
3. **Decide** through `applyEntitlementTransition` with a store whose `commit` and `confirm` call one RPC,
   `apply_stripe_event(p jsonb)`, below. A version conflict re-runs steps 2–3, at most three more times.
4. **Dispatch** exactly the effects the RPC recorded (`lib/billing/effects.ts`), then stamp `processed_at`.

### `apply_stripe_event(p jsonb) returns jsonb`

Migration `20261110000001_v2_billing_rpc.sql` (revert in `infra/supabase/rollbacks/`). It also adds
`stripe_events.handled`, `handled_reason` and `effects` (Q1). `security definer`, `search_path = pg_catalog,
public, pg_temp`, `lock_timeout = 5s`; `service_role` alone may execute it. In one transaction, in lock
order:

1. the ledger row `for update`: already decided or processed → returns what was stored, writes nothing;
2. the subscription row `for update`, inserted from the call's mirror row when missing. A gated event strictly
   older than `last_event_created` is recorded "older than the subscription's last event", with no effects;
   a live read on a row stored as `canceled` or `incomplete_expired` is recorded "the subscription had
   ended". `checkout.session.completed` and `trial_will_end` are not gated, and an older one does not
   overwrite a newer mirror;
3. the account `for update`, when there is a transition, an expected version or a customer to bind: the
   version check, the binding, `apply_entitlement_transition`;
4. the mirror columns, with `last_event_created` advanced to the greater;
5. the ledger's `account_id`, `handled`, `handled_reason`, `effects`.

It returns `{decided, handled, reason, effects, version}`. SQLSTATEs: `22023` malformed `p`, `0A000` not
READ COMMITTED, `P0002` ledger row or account missing, `40001` stale version, `23505` a binding clash
(recorded on the retry, with a Sentry report), `23514` a subscription row of another account (500). Verify:
`pnpm --filter @crawlmouse/web exec vitest run __tests__/v2-billing-rpc.test.ts`; the races on a real
Postgres: `scripts/db/stripe-event-race.test.ts`, run by CI's `db-cli-files` job (Q17).

### Stripe writes from the webhook

The webhook plans a `cancel` effect, durable in the same stored plan (Q10, Q13):

- **Orphaned.** A checkout whose grant is ignored for any reason but "already the current subscription"
  (an unknown account and a customer mismatch included) and whose subscription is live (`trialing`,
  `active`, `past_due`); and the subscription an applied checkout replaced, when it is still live. Only a
  subscription on our own prices is cancelled. A `trialing` one costs nothing; a paid one also raises
  `billing.orphaned_subscription` naming it, for a refund by hand.
- **Disputed.** A dispute cancels the account's followed subscription.

A cancellation is at once, without proration, under the idempotency key `cancel:<subscription>:<reason>`,
and is skipped when Stripe already shows the subscription ended (`lib/billing/effect-sinks.ts`).

## The event × state table

<!-- BEGIN generated: the event × state table -->

89 cases, each run through the handler against PGlite with every migration. "→" is the
state after an applied event; "ignored" carries the machine's reason; "—" is a cell the cases do
not run.

| Event                                                                           | Free, never subscribed                | Free after Pro went unpaid: the subscription is kept | Free after a dispute on Pro                          | Pro trial without a card                    | Pro                                               | Agency trial                                    | Agency                                      | Past due from Pro                           |
| ------------------------------------------------------------------------------- | ------------------------------------- | ---------------------------------------------------- | ---------------------------------------------------- | ------------------------------------------- | ------------------------------------------------- | ----------------------------------------------- | ------------------------------------------- | ------------------------------------------- |
| `checkout.session.completed`, another subscription active on pro                | → pro                                 | → pro                                                | → pro                                                | → pro                                       | —                                                 | → pro                                           | → pro                                       | → pro                                       |
| `checkout.session.completed`, another subscription active on agency             | —                                     | —                                                    | —                                                    | —                                           | → agency                                          | —                                               | —                                           | —                                           |
| `checkout.session.completed`, its subscription active on pro                    | —                                     | —                                                    | —                                                    | —                                           | ignored: already the current subscription         | —                                               | —                                           | —                                           |
| `checkout.session.completed`, another subscription trialing on agency           | → agency_trial                        | ignored: the account still has a subscription        | ignored: a disputed account gets no trial            | ignored: only a Free account starts a trial | ignored: only a Free account starts a trial       | ignored: only a Free account starts a trial     | ignored: only a Free account starts a trial | ignored: only a Free account starts a trial |
| `customer.subscription.updated`, another subscription active on pro             | ignored: not the current subscription | —                                                    | —                                                    | ignored: not the current subscription       | —                                                 | —                                               | —                                           | —                                           |
| `customer.subscription.updated`, its subscription active on pro                 | —                                     | → pro                                                | ignored: a disputed account is restored only by hand | —                                           | ignored: no entitlement change                    | —                                               | —                                           | → pro                                       |
| `customer.subscription.updated`, its subscription active on agency              | —                                     | —                                                    | —                                                    | —                                           | —                                                 | → agency                                        | ignored: no entitlement change              | —                                           |
| `customer.subscription.updated`, another subscription past_due on pro           | ignored: not the current subscription | —                                                    | —                                                    | ignored: not the current subscription       | —                                                 | —                                               | —                                           | —                                           |
| `customer.subscription.updated`, its subscription past_due on pro               | —                                     | → free                                               | → free                                               | —                                           | → past_due                                        | —                                               | —                                           | → past_due                                  |
| `customer.subscription.updated`, its subscription past_due on agency            | —                                     | —                                                    | —                                                    | —                                           | —                                                 | → past_due                                      | → past_due                                  | —                                           |
| `customer.subscription.updated`, another subscription canceled on pro           | ignored: not the current subscription | —                                                    | —                                                    | ignored: not the current subscription       | —                                                 | —                                               | —                                           | —                                           |
| `customer.subscription.updated`, its subscription canceled on pro               | —                                     | → free                                               | → free                                               | —                                           | → free                                            | —                                               | —                                           | → free                                      |
| `customer.subscription.updated`, its subscription canceled on agency            | —                                     | —                                                    | —                                                    | —                                           | —                                                 | → free                                          | → free                                      | —                                           |
| `customer.subscription.updated`, its subscription incomplete_expired on pro     | —                                     | → free                                               | —                                                    | —                                           | → free                                            | —                                               | —                                           | —                                           |
| `customer.subscription.updated`, another subscription unpaid on pro             | ignored: not the current subscription | —                                                    | —                                                    | ignored: not the current subscription       | —                                                 | —                                               | —                                           | —                                           |
| `customer.subscription.updated`, its subscription unpaid on pro                 | —                                     | → free                                               | → free                                               | —                                           | → free                                            | —                                               | —                                           | → free                                      |
| `customer.subscription.updated`, its subscription unpaid on agency              | —                                     | —                                                    | —                                                    | —                                           | —                                                 | → free                                          | → free                                      | —                                           |
| `customer.subscription.updated`, its subscription paused on pro                 | —                                     | → free                                               | —                                                    | —                                           | → free                                            | —                                               | —                                           | —                                           |
| `customer.subscription.updated`, its subscription paused on agency              | —                                     | —                                                    | —                                                    | —                                           | —                                                 | —                                               | → free                                      | —                                           |
| `customer.subscription.updated`, its subscription trialing on agency            | —                                     | —                                                    | —                                                    | —                                           | —                                                 | ignored: status trialing changes no entitlement | —                                           | —                                           |
| `customer.subscription.updated`, another subscription trialing on agency        | ignored: not the current subscription | —                                                    | —                                                    | —                                           | —                                                 | —                                               | —                                           | —                                           |
| `customer.subscription.updated`, its subscription incomplete on pro             | —                                     | —                                                    | —                                                    | —                                           | ignored: status incomplete changes no entitlement | —                                               | —                                           | —                                           |
| `customer.subscription.deleted`, another subscription canceled on pro           | ignored: not the current subscription | —                                                    | —                                                    | ignored: not the current subscription       | —                                                 | —                                               | —                                           | —                                           |
| `customer.subscription.deleted`, its subscription canceled on pro               | —                                     | → free                                               | → free                                               | —                                           | → free                                            | —                                               | —                                           | → free                                      |
| `customer.subscription.deleted`, its subscription canceled on agency            | —                                     | —                                                    | —                                                    | —                                           | —                                                 | → free                                          | → free                                      | —                                           |
| `customer.subscription.trial_will_end`, another subscription trialing on agency | ignored: not the current subscription | —                                                    | —                                                    | ignored: not the current subscription       | —                                                 | —                                               | —                                           | —                                           |
| `customer.subscription.trial_will_end`, its subscription unpaid on pro          | —                                     | ignored: not a trial                                 | —                                                    | —                                           | —                                                 | —                                               | —                                           | —                                           |
| `customer.subscription.trial_will_end`, its subscription canceled on pro        | —                                     | —                                                    | ignored: not a trial                                 | —                                           | —                                                 | —                                               | —                                           | —                                           |
| `customer.subscription.trial_will_end`, its subscription active on pro          | —                                     | —                                                    | —                                                    | —                                           | ignored: not a trial                              | —                                               | —                                           | —                                           |
| `customer.subscription.trial_will_end`, its subscription trialing on agency     | —                                     | —                                                    | —                                                    | —                                           | —                                                 | → agency_trial                                  | —                                           | —                                           |
| `customer.subscription.trial_will_end`, its subscription active on agency       | —                                     | —                                                    | —                                                    | —                                           | —                                                 | —                                               | ignored: not a trial                        | —                                           |
| `customer.subscription.trial_will_end`, its subscription past_due on pro        | —                                     | —                                                    | —                                                    | —                                           | —                                                 | —                                               | —                                           | ignored: not a trial                        |
| `invoice.payment_failed`, another subscription past_due on pro                  | ignored: not the current subscription | —                                                    | —                                                    | ignored: not the current subscription       | —                                                 | —                                               | —                                           | —                                           |
| `invoice.payment_failed`, its subscription past_due on pro                      | —                                     | → free                                               | → free                                               | —                                           | → past_due                                        | —                                               | —                                           | → past_due                                  |
| `invoice.payment_failed`, its subscription past_due on agency                   | —                                     | —                                                    | —                                                    | —                                           | —                                                 | → past_due                                      | → past_due                                  | —                                           |
| `charge.dispute.created`                                                        | → free                                | → free                                               | → free                                               | → free                                      | → free                                            | → free                                          | → free                                      | → free                                      |

<!-- END generated -->

## Effects

`planEffects` turns the machine's effects into Inngest sends with ids fixed by name, account and source:
`trial.started {accountId, trialEndsAt, variant}`, `trial.converted {accountId}`, `entitlement.changed
{accountId, from, to}`, `email.requested {accountId, template}` (CC-28 sends the mail; nothing here does).
`founder_alert` becomes a Sentry message, flushed before the event is stamped (review finding 15).
`relimit`, `pause_others`, `pause_over_limit` and `resume` plan nothing: `apply_entitlement_transition` has
applied them in the same transaction since migration 003 (Q2). `dispatchPlanned` sends the events in one
call, then the cancellations, then the alerts; a failure throws and the plan is sent again later.

## Routes

Every v2 route: the session's `getUser()` (401 `auth_required`), the flag (new routes 404 `not_found`
unset; checkout and portal run v1's body unset), the account (an optional `accountId`, required on the
agency trial, else the caller's sole owned account; several → 409 `account_ambiguous`; Q15), the literal
`sb.rpc('member_role', …)` = `'owner'` (403 `not_owner`), and only then the service-role client. A form gets
303 to Stripe; JSON gets `{url}`. Errors are a status and `{error}`.

| Route                            | v2 behaviour                                                                                                                                                                                                                                                                                                                                    |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/billing/checkout`     | `{plan, interval}`. 409 `plan_held` when the state holds the plan or a higher one; 409 `subscription_open` (`next: 'portal'`) while the account follows any subscription (Q3). The customer is the account's, created once (`customer:<account>`); the customer's open sessions are expired; card only (Q12); automatic tax; 31-minute session. |
| `POST /api/billing/agency-trial` | `{accountId, interval}`. 409 `trial_refused` with `trialRefusal`'s reason; a 14-day trial, the card always collected, the trial cancelled if the card is removed.                                                                                                                                                                               |
| `POST /api/billing/cancel`       | First post: `{step: 'confirm', endsAt}`, no Stripe call. With `confirm`: `active`/`trialing` → `cancel_at_period_end` (no idempotency key, so a second cancel after a renewal writes); `past_due`/`unpaid`/`paused` → cancelled at once (Q14). A form goes back to `/settings/plan`.                                                            |
| `POST /api/billing/portal`       | The account's customer (400 `no_customer`), on v2's own portal configuration (Q7).                                                                                                                                                                                                                                                              |

With the flag unset, checkout, portal and status are pinned to main's behaviour:
`pnpm --filter @crawlmouse/web exec vitest run app/api/billing/checkout/route.v1-pin.test.ts app/api/billing/portal/route.v1-pin.test.ts app/api/billing/status/route.v1-pin.test.ts`.
The v1 webhook (`app/api/webhooks/stripe/`) is not edited.

**Registry (D11).** `lib/security/route-policy.ts` lists the agency trial and cancel as `member` routes with
the strict origin rule, and the v2 webhook as a `webhook` with `verifier: 'constructEvent'`. A POST from
another site, or with neither `Origin` nor `Sec-Fetch-Site: same-origin`, to any of the four billing routes is
refused 403 by the middleware before the route runs:
`pnpm --filter @crawlmouse/web exec vitest run __tests__/security/billing-cross-site.test.ts`.

## Our clock

- `trialLifecycleFn` (`crawlmouse.trial.lifecycle`, on `trial.started`, idempotent per account, cancelled by
  `trial.converted`): the reminder at end − 3 days (skipped when it wakes at or after the end), the expiry
  at the end; applying and sending are separate steps.
- `pastDueSweepFn` (`crawlmouse.billing.past-due-sweep`, hourly): past-due accounts out of their grace go to
  Free; no-card trials past their end expire (Q6). At most 100 a run, longest overdue first.
- The first-login trial now sends `trial.started` and `entitlement.changed` through the same dispatcher (D9b,
  Q4); a failed send is reported and the sign-in goes on.
- `reconcileBillingFn` runs the v2 reconcile as a second step under the flag (D10): it reports
  `reconcile.drift` per account (mirror vs Stripe, a followed subscription missing or ended, tier vs plan, a
  live subscription the account does not follow) and repairs nothing.

## Operations

- Register the Stripe endpoint only once the flag is on, with `api_version: 2026-05-27.dahlia` (the SDK's)
  and ARCH-2 §3.3's event list. The sandbox renders events in `2026-10-28.endive` by default.
- The D12 smoke creates customers in the sandbox; it must not run while a sandbox endpoint points at a
  deployment, whose database has no account for them.
- New variables (`turbo.json` `build.env`): `V2_BILLING`, `STRIPE_ACCOUNT_SECRET_KEY`,
  `STRIPE_ACCOUNT_WEBHOOK_SECRET`, `STRIPE_ACCOUNT_LIVEMODE`. Production keeps `V2_BILLING` unset.

## Known gaps

- A clock step retried after its commit loses that step's `entitlement.changed` (review finding 13); nothing
  in CC-03 consumes it.
- v1 and v2 share `stripe_events` keyed by event id; the cutover needs one endpoint per account or a consumer
  column (review finding 19).
- The portal's cancel is at period end for every status, `past_due` included (Q14 covers our route).
- With `V2_BILLING=1`, v1's pricing cards post `{priceId}` and are refused 400; the pricing pages (CC-29)
  replace them.
- An applied checkout that replaces an `unpaid` or `paused` subscription does not cancel it (it is not
  "live"); the checkout route refuses while the account follows one (Q3), so only a race reaches it.
- Two of CC-SEC's tests built their "after" database from every migration, so any later migration broke
  them; they now compare their own migration alone (`__tests__/v2-definer-search-path.test.ts`,
  `scripts/db/definer-search-path.test.ts`), and `__tests__/v2-billing-rpc.test.ts` runs check 09 with this
  step's function in place.
- Upgrades Pro → Agency are a subscription change, not a checkout: CC-29 or CC-31. Seat and site quantities:
  CC-31. The card-required Pro trial: Q9.
