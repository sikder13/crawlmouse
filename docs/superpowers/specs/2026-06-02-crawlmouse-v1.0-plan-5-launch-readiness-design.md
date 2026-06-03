# Crawlmouse v1.0 — Plan 5: Launch Readiness — Design Spec

**Date:** 2026-06-02
**Status:** Draft for review (brainstorming output → feeds writing-plans)
**Author:** founder draft
**Predecessors:** Plans 1–4 built + hardened to ≥9/9/9; Plan 4 (Billing) guided-live verified (`origin/main 7a0f6cb`).
**Successor:** the Plan-5 implementation plan (`docs/superpowers/plans/2026-06-02-…-plan-5-launch-readiness.md`) + the deploy runbook (`docs/deploy/…`).

---

## 1. Goal

Bring Crawlmouse v1.0 — a viral, free, CMS-agnostic internal-linking SEO grader — from "hardened + billing-verified" to **publicly launchable**. Plan 5 closes every launch-readiness gap that can be built and verified in the codebase, brings each change to a **≥9/10 on all quality lenses**, and produces an ordered **deploy runbook** for the manual production steps. Deploy itself (Vercel prod, DNS, LIVE keys, prod webhooks) is executed collaboratively as a separate step after Plan 5 ships.

Non-goals (deferred): v1.1 features (AI suggestions, scheduled re-crawl, Agency tier), v1.2 dev surface (CLI/GH Action/agentic webhooks). SOC 2. Commissioned mascot illustration. Grade-formula re-tune (needs 1000+ real audits).

---

## 2. Locked decisions (from the brainstorm)

1. **Deliverable shape.** Plan 5 = all headlessly-executable code/config-prep, executed subagent-driven now. A separate `docs/deploy/` runbook captures manual prod steps we execute together (step 4). Each work item below is tagged **[code]** (in Plan 5) or **[runbook]** (deploy).
2. **Legal copy.** Draft real, accurate, plain-language Privacy / Terms / AUP + a real /subprocessors page, grounded in the actual stack and data-flows, GDPR/CCPA-aware, with a visible "founder draft pending counsel review" banner. Industry-standard for a seed-stage launch.
3. **Load test.** Author the k6 harness now; execute the ~1000-concurrent run against an **isolated staging target** (Vercel preview deploy on a Supabase branch with Stripe **test** keys) during deploy — never against prod data/billing.
4. **Optional §19.2 extras — all four IN scope:** /subprocessors, 10 reference benchmark audits, /status page, PostHog session-replay-on-errors.
5. **Tooling baseline (Phase P).** Provision Vercel + PostHog + Sentry MCPs (plus the already-connected Supabase/Stripe/GitHub/Cloudflare/context7) before execution, so agents can configure + verify automatically.
6. **Quality bar.** Every phase passes the per-phase ≥9 gate (§4) before commit/ship; the whole surface then passes a Phase-7 verification test plan that is itself scored ≥9 on 4 lenses, covering code AND configuration/live behavior.

---

## 3. Phase P — Prerequisites (must be green before Phase 0 executes)

**Tooling / access:**
- **Vercel MCP** (`https://mcp.vercel.com`, OAuth) — new account on `nahlai.tech@gmail.com`, GitHub repo connected (`sikder13/crawlmouse`) for preview deploys, read-only MCP authorized. Deploy *writes* later via `vercel` CLI + token.
- **PostHog MCP** (`https://mcp.posthog.com/mcp`, OAuth, US region) — existing account.
- **Sentry MCP** (`https://mcp.sentry.dev/mcp`, OAuth) — existing account.
- Verify the already-connected MCPs respond: Supabase (`ezspnfeyzwsisymytssm`), Stripe (test), GitHub, Cloudflare, context7.

**Config-token notes (not MCPs):** Turnstile *code* needs only the existing site key `0x4AAAAAADcDUWXN1hJ_2MRB`. Turnstile *dashboard* edits need a scoped `CLOUDFLARE_API_TOKEN` (the Cloudflare OAuth MCP lacks Turnstile scope). Resend webhook + Inngest prod-env are runbook dashboard steps (keys already exist).

**Exit criterion:** `/mcp` shows vercel/posthog/sentry connected; controller confirms one successful read call against each.

---

## 4. Per-phase quality gate (applies to EVERY phase — non-negotiable)

No code is committed/pushed for a phase until **all** of the following hold:

1. **TDD** — tests written before implementation; every new behavior is covered (unit + integration; Playwright for UI; live-SSE assertions for stream behavior; migration tests where schema changes).
2. **Green gates** — `pnpm exec tsc --noEmit` = 0 errors · `pnpm exec next lint` clean · all suites green (`apps/web` vitest, `/inngest` vitest, `packages/engine` vitest as touched).
3. **3 adversarial Opus-4.8 reviewers** (read-only, parallel) score the phase on four lenses, each returning numbered findings (severity / file:line / what's wrong / why / exact fix) + a 0–10 sub-score:
   - **Correctness + edge cases**
   - **Security** (authz/IDOR, RLS, injection, XSS, SSRF, secret handling, open redirect, abuse)
   - **Performance + naming + maintainability**
   - **Test quality** (coverage of the new behavior, negative/edge/security cases, determinism, no flakiness, no over-mocking)
4. **Controller verifies** each finding against real code (discards non-issues), fixes confirmed issues TDD-style, commits per logical group.
5. **Re-review (round 2+)**: confirm each prior finding resolved (cite the fix), hunt regressions, re-score. **Iterate 4→5 until every lens ≥ 9/10.**
6. **Commit + push** (controller pushes; subagents can't push main). Commit messages: **no AI/Claude/Cursor references, strip `Co-Authored-By`**.

Significant design choices within a phase are backed by **fresh web research with cited sources**. Subagents (implementers + reviewers) run on **Opus 4.8**, never downgraded. UI work follows the **distinctive/playful** brand bar.

---

## 5. Phases

### Phase 0 — Correctness & safety fixes (deferred live legs + cron guards) [code]
Do first so later verification is clean.

- **0A — Cron safety.** `crawlmouse.stripe-reconcile` (`inngest/billing.ts`): add a **livemode guard** (refuse to clear `pro_until` for customer ids unresolvable under the active Stripe key's mode) + a **`mode` param** `'dry-run' | 'single-customer' | 'full'` (default **dry-run** logs intended writes only; `full` requires explicit invocation; `single-customer` takes a customer id). `crawlmouse.audits-ttl-cleanup`: replace the unscoped `delete().lte('expires_at', now)` with a **bounded/batched** delete (select ≤N expired ids → delete by id in chunks → loop until drained, with an iteration cap).
  *Accept:* unit tests prove dry-run writes nothing; livemode mismatch is refused; batched delete removes exactly the expired set in ≤N-sized chunks and terminates.
- **0B — AuditView 0/0 flash.** `app/audit/[id]/AuditView.tsx` renders `orphanCount ?? 0` / `avgDepth ?? 0` before the first completion snapshot. Gate those stats behind real completion data; show a skeleton/animated placeholder until `status === 'completed'`.
  *Accept:* no numeric orphan/depth stat renders pre-completion; test asserts the skeleton then the real values.
- **0C — OG-cache purge on takedown.** A processed takedown still serves the pre-takedown OG card (`app/r/[slug]/opengraph-image.tsx`, `revalidate=3600`) for up to 1h. On takedown-processing, `revalidateTag`/`revalidatePath` the report page **and** the OG image (tag the image route).
  *Accept:* after takedown, the OG route returns the taken-down placeholder on next request (verified via tag invalidation in test).
- **0D — G1 findings-cap live SSE leg** (verification only; closed in Phase 7 with a findings-rich crawl).

### Phase 1 — Anti-abuse: Turnstile widget [code]
Add `@marsidev/react-turnstile` (managed mode; script `beforeInteractive`). Render on the **audit form** (`UrlForm.tsx`), the **magic-link/email-capture** form, and the **takedown** form; pass `cf-turnstile-response` to the server (server-verify via existing `lib/turnstile.ts`). **Policy:** require a valid token *always* on the abuse-prone low-volume forms (magic-link, takedown, /developers waitlist); on the audit funnel, require it on `captcha_required` (429) so the primary viral path stays friction-free until an IP trips the limit. Dev still falls open when `TURNSTILE_SECRET_KEY` is unset.
*Accept:* widget renders; token reaches server; required paths reject absent/invalid token; funnel unaffected below the limit; reset-on-error works.

### Phase 2 — Observability: PostHog funnel + Sentry [code] + [runbook]
- **PostHog funnel [code]:** instrument the 7 spec events at their call sites — `landing-view`, `audit-submitted`, `audit-completed`, `email-captured`, `public-share-clicked`, `csv-download`, `pro-upgrade` — with typed props. Add a **reverse-proxy** rewrite (ad-blocker resilience) and **error-only session replay** (privacy-masked inputs). Modernize client init to `instrumentation-client.ts` (Next 15.3+).
- **Cost-control #6 [code]:** PostHog **event sampling + volume caps** (supports the ≤18% MRR ceiling).
- **Sentry [code]:** wire `onRequestError` (instrumentation.ts), tag/measure the three alertable signals (5xx rate, audit-failure rate, Stripe webhook sig-fail).
- **Sentry alert rules + release/sourcemaps [runbook]** (dashboard, or via Sentry MCP).
*Accept:* each funnel event fires exactly once with correct props (asserted against a local capture/mock); forced server error reaches Sentry with the right tags; sampling config verified.

### Phase 3 — Cost controls #1/#2 + hard billing caps [code] + [runbook]
- **#1 page caps + #2 IP/domain rate limits** already exist → regression-test + confirm; add a **global daily audit-concurrency ceiling** backstop. [code]
- **Hard caps in every dashboard** (Stripe billing alerts, Supabase spend cap, Vercel spend management, Inngest concurrency, Resend cap, Sentry quota, PostHog billing limit) + a written **≤18%-MRR cost model** doc. [runbook + doc]
*Accept:* rate-limit/page-cap regression tests green; global ceiling enforced + tested; cost-model doc maps each lever to the 18% ceiling.

### Phase 4 — Auth email robustness [code-authored, runbook-applied]
Author **branded, on-brand HTML** Supabase Auth email templates (magic-link + signup) whose link is `{{ .SiteURL }}/login/verify?token_hash={{ .TokenHash }}&type=magiclink` (`&type=signup` for signup) — fixes today's same-device-only sign-in. Templates committed to the repo; **applied in the Supabase dashboard [runbook]**.
*Accept:* an admin-minted `token_hash` link completes sign-in cross-device against `app/login/verify/route.ts`; templates render correctly in an email client preview.

### Phase 5 — Legal + content pages [code]
- Real **/privacy, /terms, /aup** copy (accurate to the stack/data-flows; GDPR/CCPA-aware; plain-language; founder-draft banner).
- New **/subprocessors** — disclosure table (Supabase, Stripe, Resend, Cloudflare, Vercel, PostHog, Sentry, Inngest; purpose + region per row).
- New **/developers** — pre-announce **waitlist**: email-capture → new `waitlist` table (Turnstile-gated, rate-limited), "v1.2 coming Q3 2026" copy.
- New **/status** — distinctive static page (deployable to status.crawlmouse.com at deploy).
*Accept:* pages render with no placeholder/lorem; all internal links resolve; waitlist insert works, is rate-limited + captcha-gated; `tsc`/lint clean.

### Phase 6 — Load test harness (k6) [code-authored, runbook-run]
`tests/load/` k6 scripts: ramp to ~1000 concurrent audit submissions with realistic think-times + thresholds (p95 latency, error-rate, Inngest queue depth) + a **staging-target setup doc** (Vercel preview + Supabase branch + Stripe test keys). Executed at deploy.
*Accept:* script runs locally at low VU without error; thresholds defined; full 1000-VU run deferred to staging (documented).

### Phase 7 — Rigorous pre-launch verification [verification]
Author a **Plan-5 verification test plan**, itself reviewed→scored→fixed→re-reviewed to **≥9 on all 4 lenses** (coverage / objectivity / negative-&-security / repeatability-&-safety), covering **code AND configuration/live behavior**; execute guided-live. Closes: **0D** (G1 findings-cap live SSE via a findings-rich multi-page site), the **Plan-2 anon-funnel browser smoke**, **0C** OG-purge, **0B** AuditView flash; **seeds the 10 reference benchmark audits**.
*Accept:* every critical TC passes; result score ≥9 on each lens; evidence captured under `evidence/`.

---

## 6. Deploy runbook (`docs/deploy/…`) — step 4, executed together

Ordered, each step with verify-before-next:
Vercel Pro → set all prod env vars incl. **LIVE Stripe keys** (24 vars) → point `crawlmouse.com` DNS at Vercel via Cloudflare (A/AAAA/CNAME www) → register **LIVE Stripe webhook** + **Resend webhook** (set `RESEND_WEBHOOK_SECRET`) → apply Supabase prod email templates (token_hash + branded) → Sentry release + sourcemaps + 3 alert rules → PostHog prod project + reverse-proxy host → Inngest prod env connected → **scoped cron run** (dry-run first, then full) → **Stripe business activation** (fix "Nahl Tech**hh**nologies Inc" statement-descriptor typo) → **co-founder Stripe access** → seed 10 benchmark audits → **k6 vs staging** (evidence) → /status domain → final **spec §19.2 checklist** → prod smoke (purchase loop, magic-link cross-device, public share, CSV). Declare launch-ready only after prod smoke passes.

---

## 7. Cross-cutting standards

§4 per-phase quality gate (3 adversarial Opus reviewers → controller-verify → TDD fix → re-review ≥9/9/9/9); fresh web research with cited sources per significant decision; subagents on **Opus 4.8**; **no AI mentions** in commits/PRs/comments + strip `Co-Authored-By`; **distinctive/playful UI**; controller commits per logical group + pushes; migrations via Supabase MCP `apply_migration` (project `ezspnfeyzwsisymytssm`), not `supabase db push`; `nvm use` (Node 22) before pnpm.

---

## 8. Out of scope / deferrals (explicit)

- v1.1 / v1.2 features. SOC 2. Commissioned mascot. Grade-formula re-tune.
- Excel export (CSV-only for v1.0). DNS-TXT-default domain verification (meta-tag default stays).
- Full 1000-VU k6 run executes at deploy against staging, not in Plan-5 code phase.
- Any production write that requires LIVE keys or live dashboards → runbook.

---

## 9. References

- Spec: `docs/superpowers/specs/2026-05-24-crawlmouse-v1.0-design.md` (§18.5 load test, §19 deploy/ops, §19.2 checklist).
- Plan-4 verification + deploy-gates: `docs/qa/2026-06-02-plan-4-billing-verification-plan.md` §8.
- Handoffs: `handoff008.md` (current state), `handoff003.md` (§4 methodology, §7 roadmap).
- Memory: `~/.claude/projects/-home-udsik-nahl-clients-projects-crawlmouse-v1-0-0/memory/` (standing prefs + build state).
