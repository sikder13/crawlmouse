# Crawlmouse v1.0 — Production Launch Runbook (R.1)

> Ordered, **gated** cutover procedure. Do steps **in order**; each ends with a **VERIFY** gate — do not proceed
> until it passes. Authored after Plan-5 Phase 7 guided-live verification (handoff010, result 9/9/9/9). Execute
> collaboratively (the operator runs each step; some need account access / a card / DNS).
>
> Status legend: ⬜ not started · ✅ done · ⛔ blocked.

---

## STAGE 0 — PRE-LAUNCH FIX-GATES (close before any prod cutover)

These are the findings + deferrals the verification surfaced. **Stage 0 gates the whole launch.**

- ✅ **FIX #1 (MAJOR) — large-site audits exceed the Inngest step-output limit.** SHIPPED in Session A (`385ea3f`),
  proven live (books.toscrape 496pg → COMPLETED). Original detail below. The audit function returned the
  ENTIRE crawl result from `step.run('run-engine')` and passes it to `step.run('persist-results')`
  (`inngest/audit.ts:35-52`); Inngest caps a step's output size (~4MB cloud; the dev server caps lower), so a deep
  crawl near the 500-page free cap (`FREE_PAGE_CAP`) fails with `"step output size is greater than the limit"` and
  the audit ends `failed`. **Free users can trigger 500-page crawls on real large sites → the CORE audit feature
  can fail in prod.** FIX (one combined step / incremental persistence): run `runAudit` and `persistAuditResults`
  inside a SINGLE `step.run`, OR batch-insert pages/findings as they are produced, so the full result never crosses
  a step boundary. **VERIFY:** re-run a deep crawl (gnu.org or wordpress.org) end-to-end → audit `completed` with
  its real page_count + findings; re-run `TC-S1` (deep benchmark) green.
- ✅ **FIX #2 (MINOR) — reconcile spurious `wouldRepair`.** SHIPPED in Session B (`fc452c8`). Original detail below.
  `runReconcile` compared `pro_until` as STRINGS
  (`billing-helpers.ts:170`); the DB returns `…+00:00` while the helper computes `…000Z` (same instant) → every
  active subscriber looks "drifted" (inflated dry-run metric + harmless no-op writes in a full run). FIX: compare by
  instant (`new Date(a).getTime() === new Date(b).getTime()`) at `:170` (and the dry-run log at `:172`). **VERIFY:**
  re-run the reconcile dry-run against a subscriber whose `pro_until` matches → `wouldRepair: 0`.
- ✅ **Legal documents → industry-standard + shipped (DraftBanner removed).** Done 2026-06-07 (Session C). `/privacy`,
  `/terms`, `/aup`, `/subprocessors` rewritten to industry-standard from 4 sourced Opus research efforts, entity baked
  in (**Nahl Technologies Inc**, Delaware C-Corp, office in Indiana; **governing law = Delaware**), subprocessor regions
  verified accurate, DPF/SCC transfer split correct (DPF: Stripe/Resend/Cloudflare/Vercel/Sentry/PostHog; SCCs:
  Supabase + Inngest). **DraftBanner deleted.** A **geo-gated cookie-consent banner** was built (EU/EEA/UK: PostHog held
  until opt-in; rest of world: on with opt-out; withdraw anytime via the footer "Cookie settings" control). Passed the
  TDD + 3×Opus review gate. Sources + decisions of record: `docs/legal/2026-06-07-legal-research-synthesis.md`.
- ⬜ **HARD GO-LIVE GATE — execute the 4 unsigned subprocessor DPAs (operator).** The legal pages state, in the present
  tense, that each subprocessor "is bound by a data-processing agreement." That is TRUE only after these are executed —
  so they MUST be signed **before the public DNS cutover (Stage 2)**: **Supabase** (dashboard → request + e-sign),
  **PostHog** (in-app → generate + countersign), **Sentry** (Settings → Legal & Compliance → accept, Owner role),
  **Inngest** (email `security@inngest.com` — no self-serve, start early). Stripe/Resend/Cloudflare/Vercel auto-incorporate
  (nothing to do). **VERIFY:** all 8 DPAs in force; for each "DPF" vendor confirm status = Active at
  dataprivacyframework.gov/list. Record the executed-DPA evidence as a checked, signed-off item (not honor-system).
- ⬜ **HARD GO-LIVE GATE — register the DMCA designated agent (operator).** The Terms direct §512(c)(3) notices to a
  "designated agent" at `takedown@crawlmouse.com`; the §512(c) safe harbor (we host owner-published public reports) is
  unavailable until the agent is **registered with the U.S. Copyright Office** (copyright.gov/dmca-directory; $6, renew
  every 3 yrs). Register **before the public DNS cutover (Stage 2)**. **VERIFY:** Copyright Office registration number on
  file; `takedown@` forwards.
- ⬜ **RECOMMENDED (not launch-blocking):** appoint EU + UK Art. 27 representatives (~$ hundreds/yr; we likely don't
  qualify for the "occasional processing" exemption). Note: Sentry error telemetry/error-replay fires for EU pre-consent
  visitors under a legitimate-interest basis (consistent with the policy) — fine for launch; revisit if a DPIA pushes it
  onto the consent gate.
- ✅ **Forwarding addresses:** `privacy@`, `abuse@`, `takedown@` `crawlmouse.com` now forward (Cloudflare Email Routing,
  alongside `magic@`/`hello@`/`support@`). Done 2026-06-07. **VERIFY (operator):** send a test to each → lands in inbox.
- ✅ **Residual prod cleanup (from §C):** the 42 prior-session test-mode `stripe_events` were deleted 2026-06-07
  (`select count(*) from stripe_events` = 0). The 2 founder accounts (`nahlai.tech@gmail.com`, `ud.ideal@gmail.com`) kept.

**GATE 0:** all of the above closed (or explicitly waived in writing). The two HARD GO-LIVE GATES (4 DPAs + DMCA agent)
may be completed any time before the **public DNS cutover (Stage 2)**, but the DNS cutover MUST NOT proceed until they
are. → proceed to Stage 1.

---

## STAGE 1 — Hosting + environment (Vercel)

- ⬜ Upgrade the Vercel project to **Pro** (Fluid Compute 800s SSE ceiling; per spec §6). **VERIFY:** plan shows Pro.
- ⬜ Set **all** prod env vars (full set in `scripts/.env.local.example`) with **LIVE** values:
  - `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (prod `ezspnfeyzwsisymytssm`)
  - **LIVE Stripe:** `STRIPE_SECRET_KEY` (sk_live_), `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` (pk_live_), `STRIPE_WEBHOOK_SECRET`
    (the LIVE endpoint secret from Stage 3), `STRIPE_PRICE_ID_PRO_MONTHLY`, `STRIPE_PRICE_ID_PRO_YEARLY` (live-mode price ids),
    **`STRIPE_RECONCILE_LIVEMODE=true`** (so the reconcile livemode guard is armed)
  - **`ADMIN_SECRET`** = a strong random secret (gates `/api/admin/takedown/process`)
  - `RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET` (Stage 3), `NEXT_PUBLIC_TURNSTILE_SITE_KEY` + `TURNSTILE_SECRET_KEY`
    (the REAL Cloudflare keys: site `0x4AAAAAADcDUWXN1hJ_2MRB`), `NEXT_PUBLIC_POSTHOG_KEY` + `NEXT_PUBLIC_POSTHOG_HOST`,
    `SENTRY_DSN` + `NEXT_PUBLIC_SENTRY_DSN` (+ `SENTRY_AUTH_TOKEN` for sourcemaps), `INNGEST_EVENT_KEY` + `INNGEST_SIGNING_KEY`,
    `GLOBAL_AUDITS_PER_DAY` / cost-lever overrides if tuning.
  - **VERIFY:** `vercel env ls` shows every key set for Production; no placeholder/empty value; Stripe keys are `*_live_`.
- ⬜ Deploy `main` to Production. **VERIFY:** build succeeds; the deployment URL serves `/` (200) and `/status` (200).

**GATE 1:** prod build is live on the Vercel URL with all env set. → Stage 2.

---

## STAGE 2 — DNS cutover (Cloudflare)

> ⚠️ **PRECONDITION (do not cut over until true):** the two Stage-0 HARD GO-LIVE GATES are complete — all 4 unsigned
> subprocessor DPAs (Supabase/PostHog/Sentry/Inngest) executed AND the DMCA designated agent registered with the U.S.
> Copyright Office. The public legal pages assert both in the present tense; cutting over before they are true publishes
> a false claim and forfeits the §512(c) safe harbor.

- ⬜ Point `crawlmouse.com` at Vercel via Cloudflare DNS: apex `A`/`AAAA` (or `CNAME` flattened) + `www` `CNAME` per
  Vercel's domain instructions. Keep the existing MX/SPF/DKIM (Email Routing + Resend `send.` subdomain) untouched.
- ⬜ Add `crawlmouse.com` + `www.crawlmouse.com` as Vercel domains; provision TLS. **VERIFY:** `https://crawlmouse.com`
  and `https://www.crawlmouse.com` both serve the app over valid TLS; `dig` shows the Vercel target; email still routes
  (send a test to `support@`).

**GATE 2:** the production domain serves the app over TLS. → Stage 3.

---

## STAGE 3 — Webhooks (Stripe + Resend)

- ⬜ **Stripe (LIVE):** register the prod webhook endpoint `https://crawlmouse.com/api/webhooks/stripe` for the events
  the handler processes (`checkout.session.completed`, `customer.subscription.created/updated/deleted`). Copy the
  endpoint's **signing secret** into `STRIPE_WEBHOOK_SECRET` (Stage 1) and redeploy. **VERIFY (read-only):** send a
  Stripe test ping → the endpoint returns 200; a bad-signature POST returns **400 `invalid signature`** + a Sentry
  warning tagged `signal=stripe-webhook-sig-fail` (proven live in TC-L9). `STRIPE_WEBHOOK_SECRET` byte-equals the
  prod endpoint secret (unset → the route 500s `server misconfigured`).
- ⬜ **Resend:** register the prod webhook + set `RESEND_WEBHOOK_SECRET`. **VERIFY:** Resend test event reaches the app.

**GATE 3:** both webhooks verified (Stripe 400-on-bad-sig + tagged Sentry; Resend ping). → Stage 4.

---

## STAGE 4 — Supabase auth email templates (DEPLOY-GATE from TC-L11)

- ⬜ In the Supabase dashboard (prod), set the **Magic Link** + **Signup** email templates to the branded
  `token_hash` form: `{{ .SiteURL }}/login/verify?token_hash={{ .TokenHash }}&type=magiclink|signup`
  (HTML in `infra/supabase/email-templates/*.html`). **Default sends `?code=` (PKCE) → same-device-only**; the
  `token_hash` path is the cross-device-robust one verified in TC-L11. **VERIFY:** request a magic link in prod,
  open it on a DIFFERENT device → lands authenticated at `/dashboard` (307); the email renders the branded template.

**GATE 4:** cross-device sign-in works in prod. → Stage 5.

---

## STAGE 5 — Observability (Sentry + PostHog + Inngest)

- ⬜ **Sentry:** confirm the prod DSN; enable release + **sourcemap upload** (`SENTRY_AUTH_TOKEN`); create the **3 alert
  rules** — (a) 5xx rate, (b) audit-failure rate (via PostHog `audit-completed` with `status=failed`, or a Sentry
  metric), (c) `stripe-webhook-sig-fail`. **VERIFY:** a forced prod 5xx appears in Sentry with a stack trace
  (sourcemapped); the sig-fail alert fires on a bad-signature webhook.
- ⬜ **PostHog:** confirm the prod project + the `/ingest` reverse-proxy host (`NEXT_PUBLIC_POSTHOG_HOST`); build the
  funnel insight over the 7 events (`landing-view → audit-submitted → audit-completed → email-captured →
  public-share-clicked → csv-download → pro-upgrade`); set the **7 dashboard hard caps** (Phase-3 cost-model doc
  `docs/ops/2026-06-03-cost-model.md`). **VERIFY (note from TC-L8):** PostHog ingestion does NOT flush under headless
  automation, so verify the funnel events land from a **real interactive browser** session (the call sites are
  correct — TC-A9 — but confirm live ingestion once with a real browser).
- ⬜ **Inngest:** connect the prod environment (`INNGEST_EVENT_KEY`/`INNGEST_SIGNING_KEY`); confirm the 4 functions
  register. **⚠️** the scheduled crons auto-fire (03:00 reconcile dry-run; 04:00 TTL cleanup). After FIX #1, the TTL
  cleanup deletes only past-TTL rows (bounded/batched, 25k/run ceiling). **VERIFY:** the functions appear in the
  Inngest prod dashboard; do NOT manually invoke `audits-ttl-cleanup` or `stripe-reconcile-manual` against prod.

**GATE 5:** errors, funnel, and jobs are observable in prod. → Stage 6.

---

## STAGE 6 — Billing activation + reconcile

- ⬜ **Stripe business activation:** complete the live-mode business profile. **Fix the statement-descriptor typo
  "Nahl Tech​hnologies Inc" (double "h") → "Nahl Technologies Inc"** under Settings → Business → Public details.
- ⬜ Add **co-founder Stripe access**.
- ⬜ **Scoped reconcile:** the scheduled `crawlmouse.stripe-reconcile` cron is dry-run BY CONSTRUCTION (proven
  write-free live, TC-L1, now with a real customer). For a real repair, trigger `billing.reconcile.requested` ONCE
  (defaults to a full run; with `STRIPE_RECONCILE_LIVEMODE=true` the livemode guard throws on a key/mode mismatch).
  **VERIFY:** the run summary `repaired` is sane (after FIX #2, `wouldRepair` is not inflated); spot-check one user's
  `pro_until` against Stripe.

**GATE 6:** live purchases grant Pro; reconcile is correct + write-safe. → Stage 7.

---

## STAGE 7 — Content, benchmarks, load

- ⬜ **Seed + verify the 10 reference benchmark audits** (after FIX #1, deep CMS sites complete): `POST
  /api/audits/start` for the §S CMS spread; record id/url/grade/score/cms → keep them off the public leaderboard.
  **VERIFY:** ≥ the CMS-spread set complete with non-null grade/score (re-run TC-S1).
- ⬜ **k6 staging ramp:** run `tests/load/smoke.js` (low VU) + `audit-submit.js` (~1000 VU) against an ISOLATED
  STAGING target with Cloudflare always-pass keys — **never prod/CI/local** (per `tests/load/README.md`). Capture
  evidence under `evidence/`. **VERIFY:** thresholds hold (`p(95)`, error rate); the front-gate (400/429) behaves.
- ⬜ Confirm the **`/status`** page renders (static, no external calls) and is reachable at the prod domain.

**GATE 7:** benchmarks seeded, load validated on staging, status live. → Stage 8.

---

## STAGE 8 — Final checklist + prod smoke (declare launch-ready)

- ⬜ Walk the **spec §19.2 pre-launch checklist** end-to-end (incl. the four extras: subprocessors page, 10
  benchmarks, status page, error-only session replay).
- ⬜ **Prod smoke (real browser, real card in live mode with a refund, or a Stripe test-clock in a sandbox):**
  - audit a small site → grade renders, no 0/0 flash (TC-L4) ✅ verified pattern
  - purchase loop → Pro granted via the live webhook (TC-L13 Pro-seed pattern) ✅ verified pattern
  - magic-link **cross-device** sign-in (TC-L11) ✅ verified pattern
  - public share → mint a report for a **verified** domain → `/r/<slug>` + OG card render
  - CSV export as Pro → 200 zip; non-Pro → 402; cross-tenant → 404 (TC-L8b) ✅ verified pattern
  - findings-cap: a free viewer sees ≤5 per category, the Pro OWNER sees all (after FIX #1 a real >5-findings audit
    is obtainable → the numeric split is now live-observable, not just covered-by-A11)
- ⬜ **Declare launch-ready** only after prod smoke passes.

**GATE 8 (LAUNCH):** all checklist items + prod smoke green, Stage-0 fixes shipped. 🚀

---

## Appendix — what the verification already PROVED (don't re-litigate)
Security/billing/abuse/auth paths confirmed LIVE in Plan-5 Phase 7 (evidence in `evidence/plan-5/`): Turnstile gates
(L6/L7), global ceiling + per-domain (L10), waitlist idempotent/rate-limited (L12), anon-claim (L14), webhook
sig-fail tag (L9), admin-takedown auth (L5 part 1), CSV-export Pro gating 401/402/404/200 (L8b), the SSE findings-cap
SECURITY gate — Pro-owner-only, cross-tenant denial, no `user_id` on the wire (L13), cross-device token_hash sign-in
(L11), reconcile dry-run write-free (L1). The deterministic layer (TC-A*) is green in the TC-P1 gate. The two
findings above are the only known launch-blockers from verification.
