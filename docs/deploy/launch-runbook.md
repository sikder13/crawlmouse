# Crawlmouse v1.0 — Production Launch Runbook (R.1)

> Ordered, **gated** cutover procedure. Do steps **in order**; each ends with a **VERIFY** gate — do not proceed
> until it passes. Authored after Plan-5 Phase 7 guided-live verification (handoff010, result 9/9/9/9). Execute
> collaboratively (the operator runs each step; some need account access / a card / DNS).
>
> Status legend: ⬜ not started · ✅ done · ⛔ blocked.

---

## ▶ PROGRESS LOG — 2026-06-12 (Operator HARD GATES CLOSED — compliance deviation RESOLVED)

**✅ Stage 0 HARD GO-LIVE GATES complete (operator):** DMCA designated agent **registered + paid** (USCO directory, reg# DMCA-1074108;
agent `takedown@crawlmouse.com`; both service-provider + agent address = the Delaware registered-agent address in Dover, DE, to keep
the operating office off the public record) + **all 4 subprocessor DPAs executed** (Supabase / PostHog / Sentry self-serve + Inngest).
**✅ Stage 2 Supabase `site_url` flipped → `https://crawlmouse.com`** (operator, dashboard). ⇒ the 2026-06-11 DNS-cutover compliance
deviation is **RESOLVED**: the legal pages' present-tense DPA + DMCA claims are now true and the §512(c) safe harbor is in force.
**Launch is no longer blocked on legal.** REMAINING: **Stage 7** (10 reference benchmarks — mind the 3/day anon IP cap; k6 ramp needs
an isolated staging target) + **Stage 8** (§19.2 final checklist + prod smoke; verify the site_url flip via a real magic-link host-check).

---

## ▶ PROGRESS LOG — 2026-06-11 (Session C cont'd #4 — Stage 5 Sentry alert rules DONE + audit-failed signal shipped)

**✅ The 3 Sentry alert rules are created** (operator built them in the dashboard from handed-over specs; the `sntrys_` org token
can't create rules). **Rule 1 (`signal:stripe-webhook-sig-fail`) VERIFIED LIVE** — a bad-sig POST reopened CRAWLMOUSE-2 and emailed
the operator. Rule 2 = new prod error (env `vercel-production`). Rule 3 = `signal:audit-failed`. **Rule 3 needed a code signal —
shipped `b00e738`:** a permanently-failed audit now emits `signal:audit-failed` via a dependency-injection reporter seam (the
`@crawlmouse/inngest` worker stays Sentry-agnostic; `apps/web/lib/audit-failure-sentry.ts` does the `Sentry.captureMessage`, wired
in the inngest serve route). The signal fires even if the failure-marking DB write rejects; the reason is length-bounded; guards
pin the onFailure→handleAuditFailure delegation + the app→worker wiring. TDD + 3×Opus gate (8/9/9, 0 blocking; all consensus
findings closed + mutation-verified). Post-deploy happy-path audit smoke green (example.org C/60); deploy `mowr3cued` Ready. Rule 3
not force-fired (genuine crawl failures are now rare — the engine is robust); it fires on the next real failure. Sentry env tags are
`development` / `vercel-production`. **origin/main HEAD `b00e738`.**

---

## ▶ PROGRESS LOG — 2026-06-11 (Session C cont'd #3 — Stage 2 DNS CUTOVER executed ⚠️ AHEAD OF the legal gates, at operator direction)

**⚠️ COMPLIANCE DEVIATION (operator-directed):** the DNS cutover was executed **before** the 4 subprocessor DPAs and the
DMCA designated-agent registration were complete. The operator was explicitly warned (the legal pages assert both
present-tense; going live forfeits the §512(c) safe harbor until the agent is registered) and chose to proceed.
**OPEN ACTION — register the DMCA agent ASAP** ($6, same-day, copyright.gov/dmca-directory) + execute the 4 DPAs
(Supabase/PostHog/Sentry self-serve + Inngest via email). Optionally soften the legal pages' present-tense DPA/DMCA
wording until those close.

**✅ Stage 2 — DNS cutover LIVE + verified.** `crawlmouse.com` + `www` attached to the Vercel project; Cloudflare DNS
repointed: apex `A → 76.76.21.21`, `www CNAME → cname.vercel-dns.com`, **both DNS-only (grey-cloud)** so Vercel serves
TLS directly. **All MX/SPF/DKIM/DMARC (Email Routing + Resend) left untouched** — email still routes. Verified:
`https://crawlmouse.com` (+ `/pricing /status /privacy`) and `https://www.crawlmouse.com` all **200** over valid TLS;
**Stripe webhook repointed in place** to `https://crawlmouse.com/api/webhooks/stripe` (id `we_1ThBIfJp…`, status enabled,
**same `whsec_`** — no env swap), apex webhook bad-sig → **400**. Done via Vercel CLI (domain add) + the Cloudflare API
(DNS PUT) + the Stripe `rk_live` key (endpoint PATCH).
**⬜ Supabase `site_url` flip → `https://crawlmouse.com` STILL PENDING** — the connected Supabase MCP has no auth-config
tool, so it needs a Management-API PAT (operator to drop in `scripts/.env.local` as `SUPABASE_PAT`) or a dashboard flip
(Auth → URL Configuration). `uri_allow_list` already includes `https://crawlmouse.com/**`, so magic-links still work
(they currently point at the vercel alias until flipped).

---

## ▶ PROGRESS LOG — 2026-06-11 (Session C cont'd #2 — Stage 3 Stripe webhook + Stage 5 Sentry source-maps + Vercel Pro/maxDuration, all LIVE + verified)

**✅ Stage 3 — Stripe LIVE webhook DONE + verified live.** Registered live endpoint `we_1ThBIfJp0NUyqKK7HieIGRUw`
(events `checkout.session.completed` + `customer.subscription.created/updated/deleted`) via the `rk_live` restricted
key (Webhook-Endpoints scope) in `scripts/.env.local` → `POST /v1/webhook_endpoints`; set `STRIPE_WEBHOOK_SECRET`
(live `whsec_`) in Vercel Prod (rm+add) + redeployed. PROVEN against the live function: **bad-sig→400** + Sentry
`stripe-webhook-sig-fail` (CRAWLMOUSE-2, fresh), **valid-sig→200**, **wrong-key→400**, and a **full purchase→Pro**
grant via a signed synthetic `customer.subscription.updated` (synthetic user got `pro_until` set, then deleted). Prod
re-cleaned to baseline. At DNS, update the endpoint URL in place to the apex (keeps the same `whsec_`).

**✅ Stage 5 — Sentry source-map upload DONE + verified.** next.config had NO `withSentryConfig` (the token alone
uploads nothing). Wrapped it (`apps/web/next.config.mjs`, exported `sentryBuildOptions`) + added `app/global-error.tsx`
(client render-error capture) + set `SENTRY_AUTH_TOKEN` in Vercel Prod (`turbo.json build.env` already declared it).
The **prod build log CONFIRMS upload**: "Uploaded files to Sentry", "Release: `ad2fcde…`", Source Map Upload Report
(dozens of `.map`). ⚠️ The `SENTRY_AUTH_TOKEN` in `scripts/.env.local` is an **ORG auth token (releases scope only)** —
it CANNOT create alert rules (403). **The 3 alert rules still need a Sentry USER Auth Token (`alerts:write` +
`org:read` + `project:write`) — operator to mint into `scripts/.env.local` as `SENTRY_ALERTS_TOKEN`.** (Errors are
captured/visible without it — non-blocking.)

**✅ Vercel Pro (operator) DONE + `maxDuration=300` shipped.** Team plan = pro confirmed. Added `export const
maxDuration = 300` to the inngest serve route so large crawls aren't killed at the ~60s Hobby default.
`INNGEST_AUDIT_CONCURRENCY` stays **5** (Inngest still Free — 50 would re-break the app sync, bug `0d1152e`).

**Gate:** both code changes (source-maps + maxDuration) passed TDD + a 2-round 3×Opus gate + an independent
adversarial closure pass. The one blocking finding (guard regex bypassable via quoted-key/truthy-value `disable`,
identity-shadowing `withSentryConfig`, comment-blindness, fixture-keyed errorHandler) was re-engineered to
**value-based + behavioral + comment-immune** assertions and verified against ALL 9 reviewer-found bypasses. Monorepo
gate 13/13, web 251/251. Commits `7381e24` (source-maps) + `ad2fcde` (maxDuration), pushed → auto-deployed
`dpl_JBAq8…` (Ready).

**Post-deploy LIVE smoke:** webhook bad-sig still 400; `example.com`→COMPLETED C/60 (1pg); `quotes.toscrape.com`→
COMPLETED **B/76.09 (214pg)** — the `next.config` build-path change did NOT re-break crawlee tracing, and the
214-page crawl exercised the maxDuration headroom. Test audits deleted (prod at baseline).

**REMAINING:** Stage 5 alert rules (operator token); operator **HARD GATES** (4 subprocessor DPAs + DMCA agent)
before Stage 2 DNS; Stage 2 DNS cutover (flip Supabase `site_url`→crawlmouse.com + repoint the Stripe webhook URL to
the apex in place); Stage 7 (10 benchmarks + k6 staging ramp); Stage 8 (§19.2 prod smoke). **origin/main HEAD `ad2fcde`.**

---

## ▶ PROGRESS LOG — 2026-06-11 (Session C cont'd: Stage 3 webhooks + Stage 5 observability + a CORE-FEATURE prod blocker)

**🔴→🟢 CRITICAL — the core audit pipeline was 100% BROKEN in prod; now FIXED + PROVEN LIVE** (3 live audits ran
`pending→crawling→completed`). All prior "proven live" used the LOCAL inngest-cli dev server, never the deployed
Vercel function, which masked three STACKED prod-only bugs:
1. **`633c022`** — `crawlee` was not nft-traced into the lambdas (transitive-only dep via the engine + externalized) →
   `/api/audits/start`, `/api/verify/check/[id]`, `/api/webhooks/inngest` all **500'd** "Cannot find module 'crawlee'".
   Fix: declare `crawlee` a DIRECT `apps/web` dep (+ guard test).
2. **`0d1152e`** — `auditFn` concurrency `50` > Inngest **Free** plan cap `5` → the prod app SYNC was rejected, NO
   functions registered, audits stuck `pending`. Fix: env-driven `INNGEST_AUDIT_CONCURRENCY` (default 5, clamp 100);
   set `=50` in Vercel only on Inngest Pro.
3. **`6de9e72` + `e281e89`** — Crawlee spawns `ps` (absent on Vercel) for memory metrics → `spawn ps ENOENT` → crawl
   `failed`. Fix: set `AWS_LAMBDA_FUNCTION_MEMORY_SIZE` via **`globalThis.process.env`** (a Next bundle's local
   `process.env` write does NOT reach the EXTERNALIZED crawlee) in `engine ensureCrawleeMemoryHint()`, gated on
   `process.platform==='linux'`. (Vercel rejects setting that var as a project env var — reserved name.)

**Stage 3 (webhooks):** ✅ **Resend** webhook registered via API + `RESEND_WEBHOOK_SECRET` set/deployed. ⬜ **Stripe
LIVE webhook** still needs an `sk_live_` (or restricted key w/ Webhook-Endpoints:write) — then register the endpoint +
set `STRIPE_WEBHOOK_SECRET` + prove purchase→Pro. (`STRIPE_WEBHOOK_SECRET` is still a TEST value.)
**Stage 5 (observability):** ✅ **PostHog** funnel insight + pinned dashboard built (id 1697858); ✅ **Sentry** prod DSN
confirmed live-capturing (`stripe-webhook-sig-fail` tag fired, issue CRAWLMOUSE-2); ✅ **Inngest** 4 fns registered +
crons live. ⬜ **Sentry** sourcemaps + 3 alert rules need `SENTRY_AUTH_TOKEN` (turbo.json build.env already declares it).
**7 spend caps** = billing-dashboard settings, mostly no-ops until cards are added (not MCP-settable).

**2 minor findings (post-launch, non-blocking):** (a) rate-limit buckets are consumed on REJECTED requests
(`app/api/audits/start/route.ts` increments before the audit is created → captcha-retry on the same domain is unwinnable
for the window); (b) the Turnstile widget isn't allow-listed for the `*.vercel.app` alias (auto-fixes at the DNS cutover).
**Tunable later:** the audit route has no `maxDuration` (large crawls need Vercel Pro + an explicit maxDuration; single-page
works now); `crawlee` is `^3.11.0` caret-pinned (a minor bump could silently re-break the ps fix — consider exact-pin).
Prod re-cleaned to baseline (0 audits). origin/main HEAD `e281e89`.

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

- ⬜ Upgrade the Vercel project to **Pro** (Fluid Compute 800s SSE ceiling; per spec §6). **STILL PENDING** —
  team is on Hobby; not blocking the build, but REQUIRED before launch for the SSE audit stream. **VERIFY:** plan shows Pro.
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
- ✅ Set prod env vars — DONE 2026-06-07 (CLI). All 20 set for Production (TEST Stripe keys for now; **swap to
  `*_live_` + live price ids + live webhook secret before the Stage-2 cutover**). `NEXT_PUBLIC_BASE_URL=https://crawlmouse.com`,
  `STRIPE_RECONCILE_LIVEMODE=true`, `ADMIN_SECRET` generated. Still to add (Stages 3/5): `RESEND_WEBHOOK_SECRET`, `SENTRY_AUTH_TOKEN`.
- ✅ Deploy `main` to Production — DONE 2026-06-07: `dpl_aCYqRK…` (commit `f89e872`) **READY**; `/ /status /privacy /terms
  /aup /subprocessors` all **200**, legal copy live (entity present, no DraftBanner, footer "Cookie settings" rendering).
  **Two gotchas fixed (carry-forward):** (a) the build needs `turbo.json` to DECLARE the env (`build.env`, commit `f89e872`)
  — Turborepo strict mode strips Vercel platform env from the build task → Stripe SDK threw at page-data collection; local
  builds were unaffected (Next reads `.env.local` directly). (b) **Vercel Deployment Protection → Vercel Authentication**
  returned 401 on every route until set OFF for production (Settings → Deployment Protection).

**GATE 1:** ✅ prod build is live on the Vercel URL with all env set (modulo the Pro upgrade + the test→live Stripe swap). → Stage 2.

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
- ⬜ **Flip Supabase `site_url` → `https://crawlmouse.com`** (Management API `PATCH …/config/auth` or dashboard →
  Auth → URL Configuration). It was staged on the vercel alias in **Stage 4** so the cross-device test could run
  pre-DNS; flipping it now points the `token_hash` sign-in link at the canonical domain. `uri_allow_list` already
  includes `https://crawlmouse.com/**`, so no allow-list change is needed. **VERIFY:** a freshly requested magic
  link's link host is `crawlmouse.com` and a cross-device open lands at `/dashboard`.

**GATE 2:** the production domain serves the app over TLS; Supabase `site_url` flipped to `crawlmouse.com`. → Stage 3.

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

- ✅ **DONE 2026-06-09 via the Supabase Management API** (`PATCH /v1/projects/ezspnfeyzwsisymytssm/config/auth` —
  the connected Supabase MCP has no auth-config tool, so this used a short-lived personal access token — local copy
  deleted; **operator to revoke it at the Supabase dashboard** if not already done).
  Set the **Magic Link** (`mailer_templates_magic_link_content`) + **Confirm signup**
  (`mailer_templates_confirmation_content`) email bodies to the branded `token_hash` form
  `{{ .SiteURL }}/login/verify?token_hash={{ .TokenHash }}&type=magiclink|signup` (from
  `infra/supabase/email-templates/*.html`) — re-read and verified **byte-identical** to the repo files
  (4982 / 4997 chars); stored content carries `token_hash`, **no** `{{ .ConfirmationURL }}`. Subjects → "Sign in to
  Crawlmouse" / "Confirm your email". Replaced the previous PKCE/`ConfirmationURL` default (same-device-only).
- ✅ **URL config:** `site_url` = the **vercel alias** `https://crawlmouse-001-nahl-technologies-projects.vercel.app`
  (was `http://localhost:3000`) — staged so the cross-device test works **pre-DNS**; **flip to `https://crawlmouse.com`
  at Stage 2** (see that step). `uri_allow_list` (was empty) =
  `http://localhost:3000/**`, `<vercel-alias>/**`, `https://crawlmouse.com/**`, `https://www.crawlmouse.com/**`.
  (App passes `emailRedirectTo=${NEXT_PUBLIC_BASE_URL}/login/verify` = crawlmouse.com, but the template hard-codes
  `{{ .SiteURL }}`, so the link host = `site_url`, not the redirect — both hosts are allow-listed regardless.)
- ✅ **SMTP verified** (custom send, not the Supabase default sender): `external_email_enabled=true`,
  `smtp.resend.com:587`, user `resend`, sender **`Crawlmouse <magic@crawlmouse.com>`**, password set.
- ✅ **Link expiry aligned:** `mailer_otp_exp` 3600 → **600** (10 min) so the templates' "expires in 10 minutes" copy
  is accurate (and a tighter link lifetime).
- ✅ **GATE 4 mechanics PROVEN LIVE (no inbox / second device needed):** minted a one-time `token_hash` via admin
  `generate_link` (founder email, no email sent, used immediately to dodge `otp_expired`) and exercised
  `…vercel.app/login/verify?token_hash=…&type=magiclink` with a **fresh cookie jar** (no PKCE verifier = a different
  device) → **307 → `/dashboard`**. The exact cross-device path the PKCE default would FAIL now succeeds.
- ⬜ **Residual (human, optional polish only):** request a real magic link in prod and open the email to eyeball that
  the branded HTML renders in Gmail/Outlook. The link mechanics + the byte-identical template are already proven; this
  only confirms client-side rendering.

**GATE 4:** ✅ cross-device sign-in mechanics proven live in prod (`token_hash` → `/dashboard`); branded templates +
custom Resend sender + 10-min expiry in place. → Stage 5.

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

- ✅ **Stripe business activation** — account `acct_1TGtSdJp0NUyqKK7` is an established LIVE account (already runs live
  agency charges), so KYC/activation is already complete. **Statement-descriptor typo FIXED days ago** (operator-confirmed
  2026-06-08); also mitigated for Crawlmouse by the product-level descriptor **CRAWLMOUSE**.
- ✅ **Co-founder Stripe access** — already added (operator-confirmed 2026-06-08).
- ✅ **Live products/prices created (2026-06-08, via MCP):** product `prod_UfF3mDgWtNhWAQ` (Crawlmouse Pro), monthly
  `price_1Tfua6Jp0NUyqKK7JdkdHweF` ($19), yearly `price_1TfuaNJp0NUyqKK7FvumlEsm` ($190), descriptor CRAWLMOUSE +
  default_price=monthly. **USER:** set the 4 LIVE Stripe env vars in Vercel Prod (2 keys + the 2 price ids above) by
  EDITING the existing vars (not Add), then redeploy.
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
