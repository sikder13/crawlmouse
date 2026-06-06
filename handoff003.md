# Crawlmouse — Project Handoff 003

**Date:** 2026-06-01 (late)
**Working directory:** `/home/udsik/nahl-clients-projects/crawlmouse-v1.0.0`
**Repo:** https://github.com/sikder13/crawlmouse (private). All work on `main`. **`origin/main` HEAD after the Plan 4 push = `ed03c7e`.**
**User:** Udaay Sikder (`ud.sikder@gmail.com` personal; **`nahlai.tech@gmail.com` is the business Gmail used for ALL Nahl Tech SaaS signups**).
**Supersedes:** handoff001 (Stripe setup) and handoff002 (Phase A env setup) — both fully consumed/done.

---

## 0. RESUME PROMPT (paste this into the new session, then read this whole file)

> Read `/home/udsik/nahl-clients-projects/crawlmouse-v1.0.0/handoff003.md` in full before doing anything else. Your auto-loaded `MEMORY.md` index holds the standing facts and preferences — trust it; it points here. Then continue the **codebase-hardening campaign**: run the rigorous adversarial review→fix→score process defined in §4 of the handoff on **Plan 1 (`packages/engine`)** first — iterate until the code scores **≥9/10** across correctness/security/perf — then push to `main`; then do the same for **Plan 2**, then **Plan 3**. The Plan-2 review must fix the anonymous-audit RLS gap (§6). Plan 4's code is already done + pushed; only its live-environment verification (§5) remains and that's the user's to run. Honor the standing preferences in memory (subagents on Opus; never mention AI tools in commits; distinctive/playful UI; fresh web research with sources for significant decisions; SaaS signups use nahlai.tech@gmail.com). Start by confirming you've read this file + MEMORY, then kick off the Plan 1 engine review.

How to use memory + this file (do this in order every new session):
1. Memory auto-loads: `~/.claude/projects/-home-udsik-nahl-clients-projects-crawlmouse-v1-0-0/memory/MEMORY.md` (one-line index) is injected at session start. Treat its **RESUME POINT** bullet + the feedback/project memories as standing truth, but **verify any file/flag it names still exists before acting** (memories reflect when they were written).
2. Read **this file** (`handoff003.md`) end-to-end — it's the detailed state.
3. Proceed from §3 "Immediate plan". Update MEMORY.md's RESUME POINT as you complete milestones, and write a handoff004.md before the next `/clear`.

---

## 1. Final goal (unchanged)

Ship **Crawlmouse v1.0** — a viral, free, CMS-agnostic internal-linking SEO grader. Free tier; paywall on CSV export + 2,000-page crawls + private reports + badge removal. The **immediate sub-goal of this phase**: bring the *entire existing codebase* (Plans 1–4) to a professional **≥9/10** bar via systematic adversarial review + fixes, before launch readiness (Plan 5) and deploy.

Wedges: (1) letter grade as share asset, (2) living link graph, (3) peer benchmarking + CMS-aware intelligence, (4) "Powered by Crawlmouse" embed badge. v1.1 = AI suggestions + scheduled re-crawl + Agency tier; v1.2 = dev surface (CLI/GH Action/agentic webhooks) on the same engine.

---

## 2. What's been achieved

### Phase A — pre-build env setup: COMPLETE ✅ (all keys live-validated, in `apps/web/.env.local`)
Supabase (project `ezspnfeyzwsisymytssm`, 9 base migrations) · Stripe (test mode, parent acct `acct_1TGtSdJp0NUyqKK7`, product + monthly `price_1TbEN0Jp0NUyqKK7mJUiTYTd` + yearly `price_1TcpJUJp0NUyqKK72qlMlLye`) · Resend (`crawlmouse.com` verified, sender `magic@crawlmouse.com`) · Supabase Auth→Resend SMTP · Cloudflare (DNS migrated; nameservers hans+kim; Turnstile widget `0x4AAAAAADcDUWXN1hJ_2MRB`; Email Routing magic@/hello@/support@ → nahlai.tech@gmail.com) · Inngest (Hobby) · PostHog (US cloud) · Sentry (Developer). Details in the [[build-state-v1]] memory.

### Plan 4 — Billing + Pro features: CODE COMPLETE, REVIEWED, FIXED, PUSHED ✅
- Brainstormed (design spec `docs/superpowers/specs/2026-06-01-crawlmouse-v1.0-plan-4-billing-design.md`) → implementation plan (`docs/superpowers/plans/2026-06-01-crawlmouse-v1.0-plan-4-billing.md`) → executed subagent-driven (14 tasks, Opus) → **adversarially reviewed (3 lenses × 2 rounds) → ~20 issues fixed → pushed (`origin/main` = `ed03c7e`).**
- **Final scores: correctness 10, security ~10, perf 8.5** (the 8.5 = two deliberate launch-scale deferrals, NOT defects: per-customer Stripe calls inside each reconcile `step.run` chunk; one unbounded TTL-cleanup `DELETE`. Fixing either now is premature optimization — the N+1 "fix" would worsen Stripe rate-limit pressure).
- Shipped: hosted Stripe Checkout + Customer Portal (`/billing` redirect), idempotent webhook + entitlement (`stripe_events`), annual-default pricing toggle, Pro gating via one `isProActive`/`userIsPro` predicate, page-cap + crawl-concurrency tiering, **server-side** findings top-5 paywall + `UpgradeCard`, Pro-gated CSV (findings+pages) zip, cost controls #3 (30-day TTL + cleanup cron) / #5 (concurrency) / #7 (`email_events` + Resend webhook), daily Stripe reconciliation cron. Shared entitlement logic lives in `@crawlmouse/types` (no split-brain).
- **Migrations applied to remote Supabase** via the Supabase MCP `apply_migration`: `stripe_events`, `audits.expires_at`, `email_events`. (NB: `supabase db push` does NOT work here — `SUPABASE_DB_URL` isn't in env; the project's recent migrations were applied via MCP, which is why remote versions like `20260526055250` don't match local filenames.)
- Test bar: `apps/web` unit suite green (7 files / 25 tests). `apps/web/vitest.config.ts` excludes `tests/e2e/`.

---

## 3. Immediate plan — the codebase-hardening campaign

Run the §4 process on each plan, **in order**, iterating each to **≥9/10** before pushing:

1. **Plan 1 — engine** (`packages/engine`, ~1700 LOC): crawler (Crawlee/Cheerio), grading, CMS detection, **SSRF guard (security-critical — it fetches arbitrary external sites)**, sitemap/robots, URL canonicalization, graph analysis (depth/pagerank/anchor/orphans). 14–16 vitest files (~125 assertions) to lean on. **Known finding to fix: ~40 pre-existing typecheck errors live here** (missing `vitest`/`crawlee` type resolution + implicit-`any` in `crawler.ts`) — they surface whenever apps/web or inngest typecheck (their tsconfigs glob in engine src). ← CURRENTLY STARTING THIS.
2. **Plan 2 — web app + auth + RLS** (`apps/web` core, tRPC, Supabase auth, middleware, `infra/supabase/migrations/*rls*`): **fix the anonymous-audit RLS gap here (§6).**
3. **Plan 3 — sharing/public reports/embed/leaderboard/compare/takedown**.

Then: Plan 4 live verification (§5) → Plan 5 launch readiness → deploy.

---

## 4. THE REVIEW METHODOLOGY (repeat verbatim per plan)

This is the exact process used on Plan 4; replicate it.

1. **Scope** the plan by domain (the directories listed in §3). Map the files + line counts first.
2. **Dispatch 3 adversarial reviewers in parallel** — `Agent` tool, `subagent_type: general-purpose`, **`model: opus`** (per [[subagent-model-opus]] — never downgrade), read-only so parallel is safe. One lens each:
   - **Correctness + edge cases** (div-by-zero, empty/huge inputs, null handling, async races, off-by-one, malformed data).
   - **Security** (for Plan 1: SSRF — private/link-local/IPv6/decimal-octal-hex IPs, DNS-rebinding TOCTOU, redirect-to-internal, non-http schemes, credentials-in-URL; ReDoS; zip-bomb/huge-HTML; robots bypass. For Plan 2/3: authz/IDOR, RLS, injection, secret handling, open redirect, XSS in embed/reports).
   - **Performance + naming + maintainability** (O(n²), memory on large crawls, convergence, dead code, DRY, magic numbers, misleading names, the typecheck baseline).
   - Each returns: numbered findings with **severity / file:line / what's wrong / why it matters / EXACT fix (code)**, plus a **sub-score (0–10)**. Only flag flaws — no praise.
3. **Controller verifies** each finding against the actual code (do NOT blindly trust subagents — discard non-issues, e.g. "not injectable because it's a server constant"). Produce a scored report (overall + per-lens).
4. **Fix** confirmed issues — controller edits directly (you hold the context) OR sequential fix-subagents (**never parallel implementers — git index conflicts**). Add/extend unit tests for every logic fix. Commit per logical group. **Commit messages: NO reference to AI/Claude/Cursor, NO `Co-Authored-By` trailer** (per [[never-mention-ai-tools-in-commits]]). Subagents commit but DON'T push (the subagent push classifier blocks pushes to main); the **controller pushes**.
5. **Re-run the 3 reviewers (round 2)** on the updated code: verify each prior finding is resolved (cite the fix), hunt for REGRESSIONS the fixes introduced, and RE-SCORE.
6. **Iterate** 4→5 until **≥9/10** across lenses. Distinguish real defects (always fix) from scale-only perf items (document as deferrals if they'd be premature optimization — note them, don't silently skip).
7. **Push** `main → origin` (controller). Update MEMORY RESUME POINT.

Verification commands (run `nvm use` / `source ~/.nvm/nvm.sh && nvm use` first — Node 22):
- Engine tests: `cd packages/engine && pnpm test`
- Web tests: `cd apps/web && pnpm test` (vitest; e2e excluded)
- Per-package typecheck: `cd <pkg> && pnpm exec tsc --noEmit` (filter engine baseline noise when judging a non-engine package).

---

## 5. Plan 4 — remaining LIVE-ENVIRONMENT verification (USER runs; needs dashboards/running app)

Not code; can't be done headlessly. Do anytime, in parallel with the Plan 1–3 reviews:
- **Stripe webhook:** local `stripe listen --forward-to localhost:3000/api/webhooks/stripe`; for prod register the endpoint in the Stripe dashboard → set `STRIPE_WEBHOOK_SECRET`.
- **Resend webhook:** add `https://crawlmouse.com/api/webhooks/resend` in the Resend dashboard → paste its secret into `RESEND_WEBHOOK_SECRET` in `apps/web/.env.local` (the var is documented in `.env.local.example`; currently unset).
- **Inngest crons:** `npx inngest-cli@latest dev` + `pnpm dev` → confirm `crawlmouse.stripe-reconcile` + `crawlmouse.audits-ttl-cleanup` appear and run.
- **Purchase loop:** sign in → `/pricing` → Checkout (test card `4242 4242 4242 4242`) → confirm `users.pro_until` set, full findings + CSV download work, Portal cancel clears Pro.
- **E2E:** `cd apps/web && pnpm test:e2e billing`.
- Wire a "Manage subscription" UI button → the existing `/billing` portal-redirect route.

---

## 6. Known carry-forward issue: anonymous-audit RLS gap (FIX DURING PLAN 2 REVIEW)

Pre-existing Plan-2 bug (NOT introduced by Plan 4; Plan 4 actually tightened exposure). `infra/supabase/migrations/20260524000004_rls.sql` defines `audits_owner_read using (user_id = auth.uid())` only — anonymous audits have `user_id = NULL`, so the RLS-bound client can't read them, and `apps/web/app/audit/[id]/page.tsx` does `notFound()` → **an anonymous user gets a 404 on their own audit result**, breaking the core viral funnel. The migration comment claims an "anonymous_session_id matches header" policy that was never implemented. See [[anon-audit-rls-gap]] memory. **Design decision required (make it during the Plan 2 review, with full context):**
- **(Recommended) Capability-URL:** read `/audit/[id]` page + stream via the service-role admin client keyed on the unguessable audit UUID — same model as the existing public-report slugs. Safe because Plan 4 already caps findings server-side for non-owners (top-5). ~2 files. Implication: anyone with the link can view (= the intended sharing model). Pro "private reports" governs the separate `/r/[slug]` indexing, unaffected.
- **(Alt) Anon-session cookie + RLS policy:** set a `crawlmouse_anon` httpOnly cookie, store as `anonymous_session_id`, add an RLS policy + PostgREST header passthrough. Stricter (link alone doesn't grant view) but more work.

---

## 7. Roadmap beyond the hardening campaign

- **Plan 5 — Launch readiness:** hook up Turnstile on forms, PostHog funnel events + Sentry alerts, real legal copy (`/privacy` `/terms` `/aup`), `/developers` pre-announce email capture, k6 load test (1000 concurrent), branded Supabase Auth email templates, hard billing caps in every dashboard, pre-launch checklist (spec §19.2). Cost controls #1/#2/#6 land/confirm here.
- **Deploy:** Vercel (upgrade to Pro $20/mo before commercial launch), prod env vars (LIVE Stripe keys), point `crawlmouse.com` DNS at Vercel via Cloudflare, register LIVE Stripe webhook, complete Stripe business activation (⚠️ verify "Nahl Techhnologies Inc" double-h typo in statement descriptor), add co-founder Stripe access.
- v1.1 / v1.2 per the spec.

---

## 8. Operational watch-outs (carry-forward)

- **Node 22** required — `nvm use` (or `source ~/.nvm/nvm.sh && nvm use`) in every new terminal before pnpm.
- **Migrations:** apply to remote via **Supabase MCP `apply_migration`** (project `ezspnfeyzwsisymytssm`), NOT `supabase db push` (`SUPABASE_DB_URL` absent; CLI falls back to a local socket and fails). Keep the local `.sql` files in `infra/supabase/migrations/` for the record.
- **Cloudflare MCP OAuth lacks Turnstile scope** (`/challenges/widgets` → auth error 10000). Turnstile edits need a scoped `CLOUDFLARE_API_TOKEN` (Account→Turnstile:Edit) in `scripts/.env.local` (user may have revoked the one-time token used in Phase A).
- **Subagents on Opus** always ([[subagent-model-opus]]); **no AI mentions in commits** ([[never-mention-ai-tools-in-commits]]); **distinctive/playful UI** ([[ux-not-boring]]); **fresh web research with sources** for significant decisions ([[research-depth-and-cms-agnostic]]); **SaaS signups use nahlai.tech@gmail.com** ([[saas-account-email]]).
- **Subagent push classifier** blocks `git push` to `main` from subagents — controller pushes.
- **Engine typecheck baseline (~40 errors)** is a Plan 1 finding to fix (missing vitest/crawlee types + implicit-any in crawler.ts).
- **Cost ceiling:** ops cost (excl Stripe/marketing) ≤18% of MRR ([[cost-controls-18pct]]).
- Stripe statement-descriptor typo + co-founder access + legal placeholders still pending (deploy/Plan 5).

---

## 9. Key references

- **Memory:** `~/.claude/projects/-home-udsik-nahl-clients-projects-crawlmouse-v1-0-0/memory/` (MEMORY.md index + per-fact files).
- **Spec:** `docs/superpowers/specs/2026-05-24-crawlmouse-v1.0-design.md` (21 locked sections) + `docs/superpowers/specs/2026-06-01-crawlmouse-v1.0-plan-4-billing-design.md`.
- **Plans:** `docs/superpowers/plans/2026-05-24-...-plan-{1,2,3}-*.md` (done) + `...-plan-4-billing.md`.
- **Execution logs:** `~/.claude/projects/.../work-log/plan-{1,2,3}-execution-log.md`.
- **Scripts:** `scripts/configure-cloudflare.sh`, `scripts/configure-supabase-smtp.sh`, `scripts/.env.local` (gitignored admin tokens).

End of handoff 003.
</content>
