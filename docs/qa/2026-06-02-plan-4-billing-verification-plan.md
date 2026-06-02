# Plan 4 (Billing) — Verification Test Plan (v2)

**Date:** 2026-06-02 · **Target:** the whole billing surface (code + live configuration) of Crawlmouse v1.0.
**Method:** review → score (4-lens rubric) → fix → re-review the plan to ≥9 **before** executing; then execute, score the results, fix, re-run to ≥9.
**Environment:** guided-live against the REAL remote Supabase prod project `ezspnfeyzwsisymytssm`; Stripe **test mode** (`sk_test`); Inngest dev; `pnpm dev`; Node 22.

---

## Governing principles (this is what changed from v1)

1. **Unit tests are the primary, deterministic coverage of all entitlement *logic*.** They are re-runnable, prove exact values, and touch nothing in prod. The live layer verifies only what a unit test *cannot*: signature verification, the real service-role DB write, the real browser purchase, and live config.
2. **No blocked DML.** The Supabase MCP auto-classifier blocks persistent INSERT/UPDATE/DELETE on the live DB. Every precondition is established through the **app or Stripe** (a real Checkout, a `stripe trigger` bound to the real customer), never by direct seeding. All DB *assertions* are read-only via MCP.
3. **The full-table crons are NOT invoked live.** `crawlmouse.audits-ttl-cleanup` runs an **unscoped** `delete().lte('expires_at', now)` over the entire `audits` table; `crawlmouse.stripe-reconcile` rewrites `pro_until` for **every** customer and, under `sk_test`, would null any customer id it can't resolve in test mode. Both are verified by their (shared) unit-tested logic + read-only blast-radius assertions, and explicitly flagged as deploy-gates. Live invocation is forbidden in this run.
4. **Every pass criterion is a single computed value, HTTP status, or count** — derived from the code's own formula, never "looks right".
5. **No silent skips.** Any TC that can't run live is explicitly mapped to its unit coverage.
6. **Cleanup is explicit** (Stripe CLI + a user-run SQL block, since MCP blocks DELETE).

### Test identities (isolation + cross-run determinism)
At the **start of each run** the controller picks a unique stamp `$RUN` (e.g. the wall-clock `YYYYMMDDHHMM`) and derives **per-run-unique** emails so "brand-new email" holds on every run (TC-X2's root-cause re-proof is otherwise invalidated by leftover `public.users`/`auth.users` rows that cleanup can't reach):
- **U1P** = `nahlai.tech+billingtest1-$RUN@gmail.com` — the **Pro purchaser**. Mints the real test customer `$CUS`. Used by I1, W1–W2, W5, W7, G1c, G2b, G3c/d, G4(pro), C1b.
- **U2F** = `nahlai.tech+billingtest2-$RUN@gmail.com` — a **free** user. Owns a free audit. Used by G1a, G2a, G3a/b, G4(free), I2.
- **U3N** = `nahlai.tech+billingtest3-$RUN@gmail.com` — a **fresh, never-checked-out** user for G5 (portal fallback non-customer) and X2 (provisioning).
- Three users so the U1P cancel (W5/I1) never corrupts a flow that needs Pro, and the free/non-customer branches are isolated.

### Evidence + id manifest (cleanup depends on this)
Each live TC writes `evidence/TC-<id>.txt`: the exact read-only SQL + output, the `stripe listen` status line, the HTTP status. **Every TC that mints a durable id MUST also append it to `evidence/manifest.env`** (`echo "EVT_W1=$EVT" >> evidence/manifest.env`, likewise `CUS`, `SUB`, `UID1/2/3`, every `EVT*`). §5 cleanup `source`s this manifest to build its id arrays, so cleanup completeness is mechanical, not eyeballed.

---

## §0 — Prerequisite + preflight (must pass before anything; abort on failure)

- **Code prerequisite (gates the live run):** Part A (the dashboard plan-status card) and its `apps/web/lib/billing/plan-card.test.ts` must be **implemented, reviewed to ≥9/9/9, and merged green** before the live layers run — the §1 Layer-1 gate ("full unit suite green") and TC-U1/I1/I2/E1 all depend on code that does not exist at the time this plan is authored. Execution order: build+review Part A → §1 unit gate → live layers.
- **TC-P1 mode + runtime + clean-slate gate** *(critical)*
  - Action: `stripe config --list`; `stripe customers list -d limit=1`; `stripe promotion_codes list -d active=true -d limit=1`; `node -v`; compare the `whsec_…` printed by `stripe listen` to the app's `STRIPE_WEBHOOK_SECRET`; for each pre-existing test `$UID` with a non-null `stripe_customer_id`, `stripe customers retrieve <id>`; AND `stripe customers list --email 'nahlai.tech+billingtest%'` to catch a test customer orphaned by a mid-run abort (one with no matching live DB user row).
  - **Pass (binary):** Stripe key is test-mode AND `customers list` returns `livemode:false`; **zero** active promotion codes (`data:[]`) — else document that any present code is excluded from the I1 purchase so it can't zero the `$190/$19` amount assertions; `node -v` = `v22.*`; the `stripe listen` secret **byte-equals** `process.env.STRIPE_WEBHOOK_SECRET`; **no dangling `stripe_customer_id`** (every set id resolves in Stripe — else a prior cleanup left the DB pointing at a deleted customer → abort with "stale cleanup, re-run §5"). **If any fails → abort the entire run** (a wrong-mode run could mutate real data via the crons; a secret mismatch makes every webhook 400; a stale customer id makes W7/C1b throw an opaque Stripe error).
  - Evidence: the command outputs → `evidence/TC-P1.txt`.

---

## §1 — Layer 1: unit tests (deterministic; primary logic coverage)

> Gate for the whole layer: `pnpm exec tsc --noEmit` = 0 errors, `pnpm exec next lint` clean, **full unit suite green** (run in `apps/web`, and `inngest` has its own vitest).

- **TC-U1 `planCardModel` (NEW — Part A)** *(critical)* — file `apps/web/lib/billing/plan-card.test.ts`:
  - future `proUntil` → `{variant:'pro', ctaHref:'/billing', ctaLabel:'Manage subscription', statusLabel:'Pro', dateText:<formatted proUntil>}`.
  - expired `proUntil` → variant `'free'`, `ctaHref:'/pricing'`, `ctaLabel:'Upgrade'`, `dateText:null` (relies on `isProActive`).
  - `null`/`undefined` → `'free'` / `/pricing` / `Upgrade` / `dateText:null`.
  - malformed date string (e.g. `'not-a-date'`) → `'free'`, **no throw** (relies on `isProActive` → `NaN > now` → false).
  - **Pass:** all assertions green.
- **TC-U2 `isProActive` + `userIsPro`** *(critical)* — `apps/web/lib/pro.test.ts`:
  - CITE existing: future→true, past→false, null/undefined→false.
  - ADD exact-now boundary: `isProActive(now.toISOString(), now)` → `false` (strict `>`).
  - ADD `userIsPro` with a mocked supabase client: row `{pro_until:future}`→true; null/absent row→false; `{pro_until:past}`→false.
  - **Pass:** all green.
- **TC-U3 entitlement webhook logic** *(critical)* — CITE `apps/web/lib/billing/apply-stripe-event.test.ts` (already green); confirm it asserts each guarantee, add any missing:
  - idempotency-skip (processed_at set → `{handled:false}`, 0 writes) ⇒ **covers W2 logic**.
  - **crash-recovery re-apply** (duplicate id, processed_at null → re-applies, exact `pro_until`).
  - active → `pro_until == new Date(period_end*1000).toISOString()` ⇒ **covers W1 logic**.
  - canceled → `pro_until == null` ⇒ **covers W5 logic**.
  - **downgrade-guard**: active + no period-end → `pro_until` untouched (0 writes) ⇒ **covers W5c**.
  - out-of-order: no user row for customer → **throws** ⇒ **covers W4 logic**.
  - non-conflict insert error → throws.
  - **ADD (the historical root cause — currently un-unit-tested):** a `checkout.session.completed` event with `{client_reference_id:'u0', customer:'cus_1'}` → exactly one `users` update `{stripe_customer_id:'cus_1'}` **targeting `id='u0'`**; the same event with `client_reference_id=null` → **0** users updates (the `if (userId && customerId)` guard holds); both stamp `stripe_events.processed_at`. (apply-stripe-event.test.ts currently fires only `customer.subscription.*`, so the customer-link branch — the literal original silent-billing-failure — has no deterministic coverage. **The fake `update().eq(col,val)` must record the `.eq()` column+value, not just the row payload, and assert `eqCol==='id' && eqVal==='u0'`** — otherwise the test can't prove the link targets the right user.)
  - CITE `apps/web/lib/billing/pro-until.test.ts`: `past_due`/`trialing`/`active`+period-end → ISO; `canceled`/`unpaid`/null-period-end → null ⇒ **covers "past_due grants Pro" and the clear paths**.
  - **Pass:** both suites green; the `checkout.session.completed` case is added and green.
- **TC-U4 CSV export logic** *(critical)* — CITE `apps/web/lib/billing/csv.test.ts` (green): formula-injection on leading `= + - @` (incl. leading-whitespace/tab), CRLF quoting, exact headers (`category,severity,page_url,detail` / `url,title,status_code,depth,in_degree,out_degree,is_orphan`), row-per-record. **ADD** a `detail`-truncation case (the `MAX_DETAIL=4000` cap in `export/route.ts:10,39` is an abuse mitigation with no test): a finding whose serialized `payload` is >4000 chars → exported `detail.length == 4001` and `detail.endsWith('…')`; a payload of exactly 4000 chars → unchanged (no `…`). (Extract the truncation into a tiny pure helper if the route makes it untestable in isolation.) **Pass:** green incl. the truncation case. (Live G2b only spot-checks the zip *structure*.)
- **TC-U5 tier limits** *(critical)* — CITE `apps/web/lib/tier.test.ts`: `tierLimits(false)=={pageCap:500,perHostConcurrency:1}`, `tierLimits(true)=={pageCap:2000,perHostConcurrency:8}`. **Pass:** green.
- **TC-U6 findings cap logic** *(critical)* — CITE existing `apps/web/lib/findings.test.ts` (green): free → `groups.find(g=>g.category==='orphan')` has `total:7, shown.length:5, hidden:2` and `deep_page` `shown.length:3, hidden:0`; Pro → `shown.length:7, hidden:0`; empty → `[]`. **ADD** only the exact boundary `N==5` → `shown.length:5, hidden:0` if absent. (`groupAndCapFindings` returns `FindingGroup[]`; assert via `.find(g=>g.category===X)`, not a flat object.) **Pass:** green. (Deterministic core of G1.)

---

## §2 — Layer 2: live webhook integration (signature + real DB write)

> Precondition: **TC-I1's real Checkout has run** and minted the test customer `$CUS` linked to `$UID1` (= `public.users.id` for U1P). Capture `$CUS` (`stripe customers list --email nahlai.tech+billingtest1@gmail.com -d limit=1 | jq -r '.data[0].id'`) and `$UID1` (read-only via MCP).
> `stripe listen --forward-to localhost:3000/api/webhooks/stripe` is running; capture each `$EVT` via `stripe events list -d limit=1`.

- **TC-W1 happy path → real entitlement** *(critical)*
  - Action: bind the fixture to the real user/customer so the link is not a no-op (bare `stripe trigger` ships a null `client_reference_id` and a dummy customer → the code's `if (userId && customerId)` guard skips, or the subscription path throws):
    ```
    stripe trigger checkout.session.completed \
      --override checkout_session:client_reference_id=$UID1 \
      --override checkout_session:customer=$CUS
    stripe trigger customer.subscription.created --override subscription:customer=$CUS
    ```
  - **Pass (binary):** `stripe listen` shows `[200]` for both; `users.stripe_customer_id == $CUS`; `users.pro_until == new Date(sub.current_period_end*1000).toISOString()` (read `current_period_end` from the `stripe listen` subscription payload or `stripe subscriptions retrieve $SUB`); a `stripe_events` row exists per `$EVT` with `processed_at` **non-null**.
  - **Fallback (explicit, non-silent):** if the installed Stripe CLI lacks `--override` for these resources, the happy path is covered by TC-I1's real Checkout, and `stripe trigger` is used only for W2/W3 — recorded as such, not skipped.
- **TC-W2 idempotency replay** *(critical)*
  - Action: capture `$EVT` = the `customer.subscription.created` event from W1; `stripe events resend $EVT`.
  - **Pass:** `[200]`; snapshot `{users.pro_until, users.stripe_customer_id, stripe_events.processed_at}` for the affected rows **byte-identical** before/after the resend (no duplicate effect, `processed_at` unchanged).
- **TC-W3 signature failure (security)** *(critical)* — split:
  - **W3a no header:** `POST /api/webhooks/stripe` with a well-formed `customer.subscription.created` JSON body and **no** `Stripe-Signature` header. **Pass:** `400`; **no** new `stripe_events` row (`select count(*)` before==after for that body's would-be id); `users` rows unchanged.
  - **W3b mutated body:** capture a validly-signed payload, flip one byte of the body, POST. **Pass:** `400`; no DB mutation.
  - **W3c expired timestamp (optional):** a valid signature with a `t=` older than Stripe's tolerance. **Pass:** `400`. Mark optional if crafting a custom signed payload with the CLI is impractical; W3a+W3b cover the security contract.
- **TC-W4 out-of-order resilience** *(critical)* — PRIMARY = unit TC-U3 (throws on no-row). LIVE confirmation, run **before** the W1 link, with a fresh dummy customer:
  - Action: `stripe trigger customer.subscription.updated` (no override → dummy customer not linked to any user).
  - **Pass:** `stripe listen` shows a non-2xx (500); the `stripe_events` row for that `$EVT` has `processed_at IS NULL`; `select count(*) from users where stripe_customer_id = '<dummy>'` == 0 (no garbage `pro_until` written). **Ordering: W4-live MUST precede W1.**
- **TC-W5 cancel / downgrade** *(critical)* — run on U1P near the end (clears Pro):
  - **W5a deleted→null:** `stripe trigger customer.subscription.deleted --override subscription:customer=$CUS`. **Pass:** `users.pro_until IS NULL` for `$UID1`.
  - **W5b past_due keeps Pro:** covered by unit (pro-until.test.ts `past_due`→ISO). Optional live: `stripe trigger customer.subscription.updated --override subscription:customer=$CUS --override subscription:status=past_due` with a future period end → `pro_until ==` that period end (NOT null).
  - **W5c downgrade-guard:** covered by unit TC-U3 (active+no-period-end → untouched).
- **TC-W6 checkout input validation (security)** *(critical)* — live, no DML; authed as U1P unless noted:
  - **W6a bad price:** `POST /api/billing/checkout {priceId:'price_bogus'}` → **400** `bad_price`; no session created.
  - **W6b unauthenticated:** `POST /api/billing/checkout` with no session cookie → **401** `auth_required`; no `stripe.checkout.sessions.create` call.
  - **W6c malformed body:** POST body `not json`, and `{}` → **400** `invalid` (NOT 500 — `req.json().catch(()=>({}))` then schema fails).
  - **W6d ref-id integrity:** authed POST including a spoofed `client_reference_id`/`customer` in the JSON → retrieve the created session → `session.client_reference_id == $UID1` (server-set; spoof ignored).
- **TC-W7 re-subscribe customer reuse (reactivate)** *(critical)* — after W5a (U1P has `$CUS`, `pro_until` null):
  - Action: `POST /api/billing/checkout {valid priceId}` → `stripe checkout sessions retrieve <id>`.
  - **Pass:** `session.customer == $CUS` (reuse — NOT a new customer, NOT `customer_email`); `stripe customers list --email …billingtest1 -d limit=1` count unchanged. Then `stripe trigger customer.subscription.created --override subscription:customer=$CUS` → `users.pro_until` restored to a future ISO.
- **TC-W8 origin allow-list (security)** *(major)*
  - Action: `POST /api/billing/checkout` with header `Origin: https://evil.example` (authed) → retrieve the session.
  - **Pass:** `session.success_url` host == `NEXT_PUBLIC_BASE_URL` host (NOT `evil.example`); `cancel_url` likewise. (Confirms `resolveOrigin`'s allow-list; repeat conceptually for `/billing` portal `return_url`.)
- **TC-W9 missing-secret guard (optional, run isolated last)** *(minor)*
  - Action: with `STRIPE_WEBHOOK_SECRET` unset, `POST /api/webhooks/stripe`.
  - **Pass:** `500` "server misconfigured"; no signature processing, no DB mutation. Run in an isolated env so it doesn't poison the rest of the suite.

---

## §3 — Layer 3: gating, IDOR, crons

- **TC-G1 findings cap (live SSE)** *(critical)* — preconditions: U2F owns a completed audit with a category of **N>5** findings; U1P owns a completed audit with **N>5**.
  - **G1a owner-free:** U2F opens its own audit stream → parse the `done` SSE JSON: `done.findingGroups.find(g=>g.category===X)` has `shown.length==5`, `hidden==N-5`, `total==N`, and `done.viewerIsPro==false`.
  - **G1b cross-tenant (security):** U1P (Pro) opens **U2F's** audit URL → `viewerIsPro==false` and every `findingGroups[].shown.length <= 5` (capped — confirms the `user.id===row.user_id && userIsPro` branch). Repeat as an **anonymous** viewer → same cap.
  - **G1c owner-Pro:** U1P opens its own audit → `viewerIsPro==true`, `shown.length==N`, `hidden==0`.
  - (Deterministic core in TC-U6.)
- **TC-G2 CSV gate** *(critical)*
  - **G2a free→402:** U2F `GET /api/audits/<own id>/export` → **402** `pro_required`.
  - **G2b Pro→200 zip:** U1P `GET /api/audits/<own id>/export` → **200**, `Content-Type: application/zip`; unzip → entries exactly `findings.csv` + `pages.csv`, header lines exact (spot-check; full coverage TC-U4).
- **TC-G3 export IDOR (security)** *(critical)* — response ladder (`401 → 402 → 404`):
  - **G3a unauth:** GET export with no session → **401**.
  - **G3b free-before-owner:** U2F (free) GETs export for an audit it does **not** own → **402** (Pro gate fires before the ownership check ⇒ no audit-id existence oracle for free users).
  - **G3c Pro non-owner:** U1P GETs **U2F's** audit export → **404** `not_found`, empty body.
  - **G3d non-existent:** U1P GETs a well-formed random UUID → **byte-identical 404** to G3c (no oracle).
- **TC-G4 page cap + concurrency tiering** *(critical)*
  - **Pro:** the audit U1P started → `select settings from audits where id=<pro audit>` → `settings == {pageCap:2000}` (note: `perHostConcurrency` is **not** stored in `settings` — it rides only the dispatched event); AND the captured `audit.requested` Inngest event has `data.perHostConcurrency === 8` as an **explicitly present** field (the engine defaults absent→8 at `inngest/audit.ts`, so assert present-and-equal, never inferred from a default).
  - **Free:** the audit U2F started → `settings == {pageCap:500}`; the `audit.requested` event `data.perHostConcurrency === 1` (explicitly present — this is the case the default would silently mask).
  - (Deterministic `tierLimits` in TC-U5.)
- **TC-G5 portal fallback — `GET /billing` redirect route (live redirects)** *(critical)*
  - logged-out `GET /billing` → redirect to `/login`.
  - logged-in non-customer (U3N, no `stripe_customer_id`) `GET /billing` → redirect to `/pricing` (no error/leak).
- **TC-G6 portal — `POST /api/billing/portal` JSON route (distinct contract; security)** *(critical)* — this is a SEPARATE route from `/billing` with different semantics (`api/billing/portal/route.ts`):
  - **unauth:** `POST` with no session → **401** `{error:'auth_required'}`; no `stripe.billingPortal.sessions.create` call.
  - **non-customer:** authed U3N (no `stripe_customer_id`) → **400** `{error:'no_customer'}` (note: this differs from `/billing`'s 302→`/pricing` — G5 does NOT transitively cover it).
  - **customer + origin guard:** authed U1P (has `$CUS`) with header `Origin: https://evil.example` → **200** `{url}`; the created portal session's `return_url` host == `NEXT_PUBLIC_BASE_URL` host (NOT evil.example).
- **TC-C1 reconcile cron — LOGIC (unit) + read-only truth; NO live full-table run** *(critical)*
  - **C1a value-mapping (partial coverage, stated accurately):** reconcile reuses `ACTIVE_STATUSES` + `subscriptionPeriodEnd` from `@crawlmouse/types` (covered by pro-until.test.ts), but it does **NOT** call `proUntilFrom` — it **inlines** its own `pro_until = periodEnds.length ? new Date(Math.max(...periodEnds)*1000).toISOString() : null` (`inngest/billing.ts:42`) plus a line-41 `if (activeSubs.length>0 && periodEnds.length===0) continue` skip. So only the single-status→ISO mapping is unit-covered; the **multi-sub `Math.max` selection**, the **skip-don't-downgrade `continue`**, and the **per-customer error path** are cron-only and uncovered → see C1d.
  - **C1b read-only single-customer truth:** for `$CUS`, compute expected = `max active-sub current_period_end` via `stripe subscriptions list --customer $CUS --status all`; assert `users.pro_until` for `$UID1` already equals it (set by the webhook). **Pass:** expected ISO == DB value (so reconcile would be a no-op, `repaired=0`, for this customer).
  - **C1c SAFETY (explicit non-invocation):** the live full-table `crawlmouse.stripe-reconcile` is **NOT** invoked against prod — under `sk_test` it would null `pro_until` for any customer id it can't resolve in test mode, and it writes to every row. Read-only blast radius: `select count(*) from users where stripe_customer_id is not null;`. **Pass:** the count is recorded in `evidence/TC-C1.txt` AND a deploy-gate line is appended to §8 with the cron id (fails if either is absent). **Deploy-gate:** the cron needs a single-customer/dry-run mode or guard before it can run against a DB holding live customers.
  - **C1d cron resilience + selection (NEW unit test + small hardening)** *(critical)* — add `inngest/billing.test.ts` (the `inngest` package has its own vitest) with a mocked `stripeClient` + supabase: (i) **multi-sub selection** — a customer with two active subs whose period-ends differ → `pro_until == max` of the two; (ii) **skip-don't-downgrade** — a customer with an active sub but no resolvable period-end and an existing future `pro_until` → **0 writes** (not nulled); (iii) **per-customer resilience** — `subscriptions.list` **throws `resource_missing` for customer B** but returns active subs for A and C in the same chunk → A and C still get their correct `pro_until` and B does **not** get a garbage/`null` write. **(iii) requires a code fix:** wrap the per-customer `subscriptions.list` in `try/catch` (skip-and-log on throw) so one deleted/invalid customer can't throw the whole 200-row `step.run` chunk (which on retry re-issues every Stripe call for that page). **Pass:** the test is green AND, before the fix, case (iii) fails against current `inngest/billing.ts` (proving the gap was real).
- **TC-C2 TTL cleanup — predicate + blast radius; NO live run** *(critical)*
  - **C2a predicate logic:** delete predicate is `expires_at <= now`; Pro audits have `expires_at IS NULL` (`start/route.ts:77`) and SQL `NULL <= now` → NULL/false → never selected; free audits get `now+30d` so a fresh free audit is never selected now. Confirm by inspection + symmetry with `listMyAudits`' `expires_at.is.null,expires_at.gt.now` filter (`audits.ts:27`).
  - **C2b read-only blast radius:** `select count(*) from audits where expires_at <= now();` → record the count (expected ~0 pre-launch); confirm our fresh free test audit (`expires_at ~ now+30d`) is **not** in it.
  - **C2c cascade (structural, read-only):** confirm `pages`, `links`, `findings` carry `references audits(id) on delete cascade` (cite migration `20260524000002_audits.sql`; verify via `pg_constraint`/`information_schema`) so a delete wouldn't orphan child rows.
  - **C2d SAFETY (explicit non-invocation):** the live `crawlmouse.audits-ttl-cleanup` is **NOT** invoked (unscoped `delete().lte('expires_at', now)` over the whole table). **Pass:** the C2b blast-radius count is recorded AND a deploy-gate line is appended to §8 with the cron id. **Deploy-gate** (also the known launch-scale deferral): needs a bounded/batched delete.
  - **Follow-up (non-blocking):** extract `expiredAuditPredicate(now)` as a pure helper + unit test for future deterministic coverage.

---

## §4 — Layer 4: integration capstone + config

- **TC-I1 full browser purchase loop (U1P)** *(critical — also mints `$CUS` for Layer 2)*
  - Steps: magic-link sign in → **assert provisioning (TC-X2) first** → `/pricing` (annual **$190** default; toggle → monthly **$19** — assert the displayed amounts/intervals) → Checkout `4242 4242 4242 4242` → browser URL `=== <base>/dashboard?upgraded=1` exactly (the literal `upgraded=1` query string present) → the **plan-status card shows "Pro · Manage subscription"** linking to `/billing` → findings render uncapped (`viewerIsPro==true`) and CSV export returns 200 → "Manage subscription" opens the Stripe **Customer Portal** → cancel in the portal → return.
  - **Pass (binary):** after cancel, `users.pro_until` for `$UID1` == the value computed by `proUntilFrom(finalStatus, finalPeriodEnd)` read from the `stripe listen` log — i.e. **NULL** if Stripe reports the sub `canceled` immediately, or the **period-end ISO** if it's `cancel_at_period_end` (status stays `active`). Record final sub status + period_end and the exact DB value; assert they correspond.
  - Evidence: DB snapshot at each transition (sign-in, post-checkout, post-cancel) + the `stripe listen` event log.
- **TC-I2 free-state dashboard (covers the branch E1's fallback would drop)** *(critical)*
  - Action: log in as a fresh free user (U3N, no checkout) → `/dashboard`.
  - **Pass:** the plan-status card shows **"Free plan · Upgrade"** linking to `/pricing` (accessible-name `Upgrade`, `href==/pricing`).
- **TC-E1 Playwright dashboard render (automated if seedable)** *(major)*
  - Extend `tests/e2e/billing.spec.ts` / new `dashboard-plan.spec.ts`: Pro session → link name `Manage subscription`, `href==/billing`; free session → link name `Upgrade`, `href==/pricing`.
  - If headless Pro-state seeding is infeasible (no DML), the **Pro branch is covered by TC-I1** and the **free branch by TC-I2** — explicitly mapped, not skipped.
- **TC-X1 config presence** *(critical)*
  - Inngest dev lists `crawlmouse.stripe-reconcile` **and** `crawlmouse.audits-ttl-cleanup`.
  - `STRIPE_WEBHOOK_SECRET` (app env) byte-equals the `stripe listen` `whsec_…` (also TC-P1).
  - magic-link email arrives at the seeded inbox within 60s AND clicking it yields an authenticated session (`sb.auth.getUser()` returns the user).
- **TC-X2 provisioning — root-cause re-proof** *(critical)*
  - Action: after a brand-new magic-link sign-in (never-seen email), **before any checkout**: `select count(*) from public.users where id = '<auth uid>'`.
  - **Pass:** exactly **1** row. This is the precondition that makes the webhook's customer-link `update … where id = client_reference_id` non-empty (the original silent-billing-failure root cause).

---

## §5 — Cleanup (MCP blocks DELETE → Stripe CLI + a user-run SQL block; ordered for re-runnability)

Controller `source`s `evidence/manifest.env` (all captured `$EVT*`, `$SUB`, `$CUS`, `$UID1/2/3`) and provides the user an **ordered** block — DB rows first, Stripe objects second, so the DB never ends up pointing at a deleted Stripe customer:
1. **DB (user runs via Supabase SQL editor / service-role psql — NOT MCP, which blocks DELETE).** All statements are `id`-scoped DELETEs, so a partial prior cleanup re-runs cleanly (deleting 0 rows is a no-op) — and deleting the user row itself removes any pointer to `$CUS`, so no separate null-update is needed:
   ```sql
   delete from stripe_events where id = any('{<EVT*>}');
   delete from audits       where user_id = any('{<UID1>,<UID2>,<UID3>}');
   -- restore a true clean slate so TC-X2 ("brand-new email") holds on the NEXT run:
   delete from public.users where id = any('{<UID1>,<UID2>,<UID3>}');
   delete from auth.users   where id = any('{<UID1>,<UID2>,<UID3>}');  -- or auth.admin.deleteUser per id; cascades to public.users if the FK is ON DELETE CASCADE
   ```
2. **Stripe (CLI, allowed) — AFTER the DB deletes above:** `stripe subscriptions cancel $SUB`; `stripe customers delete $CUS` (so a future reconcile never re-touches the test customer; safe because step 1 already removed the user row that referenced it).
- Per-run-unique `+billingtest{1,2,3}-$RUN` emails mean even a partially-failed cleanup can't collide with the next run's identities; TC-P1's dangling-customer check is the backstop.
- Test audits run against a throwaway domain, kept **non-public** (off `/top`/leaderboard), deleted in step 1.

---

## §6 — Ordering & isolation (mandatory)

`TC-P1` → **unit Layer 1** (incl. TC-C1d cron unit test + its try/catch fix — all unit, no prod contact) → **TC-X2/TC-I1** (sign-in + real Checkout, mints `$CUS`) → **TC-W4-live** (must precede the W1 link; uses a fresh dummy customer) → **TC-W1** → **TC-W2** (replay W1's `$EVT`) → W3/W6/W8 (independent) → G1–G6 → C1b/C1c/C2b/C2c (read-only) → **TC-W5/W7** (cancel then reactivate, last on U1P) → finish TC-I1's cancel leg → **TC-W9** (isolated) → §5 cleanup. Each `stripe trigger` mints a fresh `$EVT` (append to `evidence/manifest.env`); W2 targets W1's specific `$EVT`. U1P and any cancel-flow never share state with U2F/U3N.

---

## §7 — Result scoring (after execution)

Record a pass/fail + evidence row per TC. Then score the **results** 0–10 on the same four lenses; **every critical TC must pass** and the result score must be **≥9** on each lens. Distinguish real defects (always fix → re-run the TC + a regression sweep) from environment-only blockers (document explicitly; never silently pass).

**Critical TC set (the result gate):** P1, U1–U6, W1–W7, G1–G6, C1 (incl. C1b/C1c/C1d), C2 (incl. C2b/C2c/C2d), I1, I2, X1, X2. (W8 major; W9/W5b/W3c optional.)

---

## §8.0 — CRITICAL finding (live, confirmed read-only) — self-grant-Pro billing bypass

**TC-S1 (entitlement-column write protection).** `users_self_update` (`infra/supabase/migrations/20260524000004_rls.sql:10`, perf-rewritten `…0005:14`) has `using (id = auth.uid())` and **no `WITH CHECK`**, and `anon`+`authenticated` hold an **UPDATE grant on `users.pro_until` and `users.stripe_customer_id`** (verified live via `information_schema.role_column_grants`/`role_table_grants`); there is **no protecting trigger** on `public.users` (`pg_trigger` = none). Net effect: a **logged-in** user can `PATCH /rest/v1/users?id=eq.<own uid>` with `{"pro_until":"2099-…"}` via the publishable key + their JWT and **self-grant Pro for free** — a complete paywall bypass. (`anon` is incidentally blocked because `auth.uid()` is null → matches no row.) Pre-existing Plan-2 RLS, not introduced by Plan 4 or Part A. **No client code updates `users`** — every client path is SELECT; the only `users` UPDATEs are the webhook + reconcile cron via the **service-role** client (unaffected by these grants).
- **Pass criterion (post-fix):** `anon`/`authenticated` have **no** UPDATE privilege on `public.users` (re-query the two grant views → empty); a logged-in user's direct `PATCH users.pro_until` is rejected; the webhook/cron (service-role) still set `pro_until` (TC-W1 still passes).
- **STATUS: FIXED + VERIFIED (2026-06-02).** Applied as migration `harden_users_entitlement_grants` (remote `20260602054456`; local mirror `…000013`). Read-only re-verify: UPDATE on `public.users` is now `postgres`+`service_role` only (no `anon`/`authenticated`, no column-level grant); only `users_self_read` remains. Live `PATCH` rejection by a free user is the remaining live-leg of this TC (do during the run).
- **Fix migration (`harden_users_entitlement_grants`):**
  ```sql
  -- Entitlement columns must be writable ONLY by the service-role webhook/cron.
  revoke update on table public.users from anon, authenticated;
  drop policy if exists users_self_update on public.users; -- now dead (no UPDATE grant remains)
  ```

## §8 — Deploy-gates surfaced by this verification (not blockers for the run; must close before prod)

Appended-to as TCs run; each line names the exact artifact:
- **Magic-link email template → `token_hash` (auth robustness).** Sign-in is now a server route (`app/login/verify/route.ts`) whose robust path is `verifyOtp({token_hash,type})` — cross-device safe (no PKCE verifier). But the **default** Supabase "Magic Link" email template sends a PKCE `?code=` link, which the route can only complete **same-device** (the verifier cookie lives only in the requesting browser). **Gate:** in Supabase Auth → Email Templates → Magic Link, set the link to `{{ .SiteURL }}/login/verify?token_hash={{ .TokenHash }}&type=magiclink` (and the signup template likewise with `&type=signup`) so production email sign-in works cross-device. Until then, magic-link email sign-in is same-device-only. (Local verification used an admin-minted `token_hash` link, which exercises the robust path directly.)
- `crawlmouse.stripe-reconcile` (TC-C1c): full-table iterate + per-customer `pro_until` write; under a test key it would null unresolvable customers. **Gate:** add a single-customer/dry-run mode or a livemode guard before running against a DB with live customers. (The per-customer `subscriptions.list` try/catch is implemented + tested in TC-C1d.)
- `crawlmouse.audits-ttl-cleanup` (TC-C2d): unscoped `delete().lte('expires_at', now)`. **Gate:** bounded/batched delete (also the known launch-scale deferral).
- **Resend webhook** (`/api/webhooks/resend` + `RESEND_WEBHOOK_SECRET` + `email_events`): shipped in Plan-4 migrations but **explicitly deferred to deploy/Plan 5** (Resend can't reach `localhost`; not on the purchase path). Not silently skipped — listed here.
- **LIVE Stripe keys + prod webhook registration**; Stripe statement-descriptor typo check ("Nahl Techhnologies Inc"). Deploy/Plan 5.

---

## Rubric self-assessment (pre-execution; to be re-scored by reviewers)

1. **Coverage** — every Plan-4 guarantee has ≥1 TC: entitlement set (U3/W1) / cleared (U3/W5), idempotency + crash-recovery (U3/W2), out-of-order (U3/W4), downgrade-guard (U3/W5c), past_due-grants-Pro (U3), customer reuse/reactivate (W7), findings cap incl. cross-tenant (U6/G1a-c), CSV gate + contents + injection (U4/G2), CSV IDOR ladder (G3a-d), page cap + concurrency (U5/G4), portal + fallback (G5/I1), origin guard (W8), missing-secret (W9), reconcile logic + safety (C1), TTL predicate + cascade + safety (C2), provisioning (X2), plan-card (U1/I1/I2/E1), config (X1).
2. **Objectivity** — each TC pins to a computed value (`proUntilFrom`/`subscriptionPeriodEnd` output, exact `shown/hidden/total`, exact HTTP status, exact count), not prose.
3. **Negative/edge/security** — signature (no-header + mutated + expired), replay, crash-recovery, out-of-order, IDOR ordering (unauth/free-before-owner/non-existent), cross-tenant cap, invalid/unauth/malformed checkout, ref-id integrity, origin forgery, TTL boundary/null/cascade, reconcile clear-on-cancel + don't-downgrade.
4. **Repeatability & safety** — webhook path bound to a real customer via `stripe trigger --override` (re-runnable); test-mode preflight gate; full-table crons NOT invoked (logic via shared unit tests + read-only blast radius); explicit cleanup despite the MCP DML block; explicit ordering/isolation; no silent skips.
