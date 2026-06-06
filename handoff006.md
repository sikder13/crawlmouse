# Crawlmouse — Project Handoff 006

**Date:** 2026-06-01 (latest)
**Working directory:** `/home/udsik/nahl-clients-projects/crawlmouse-v1.0.0`
**Repo:** https://github.com/sikder13/crawlmouse (private). Work on `main`. **`origin/main` HEAD = `eee8adb`** (Plan 3 hardening pushed — 11 commits `90825ad..eee8adb`).
**User:** Udaay Sikder (`ud.sikder@gmail.com` personal; **`nahlai.tech@gmail.com` = business Gmail for ALL Nahl Tech SaaS signups**).
**Supersedes:** handoff005 (keep handoff003 §4 = methodology + §5 = Plan-4 live verification — both still apply).

---

## 0. Headline — the codebase-hardening campaign is COMPLETE

**Plans 1, 2, 3 are all hardened to ≥9/9/9 across correctness / security / perf, and pushed.** There is **no more hardening work owed.** The remaining path to launch is:
1. **Plan 4 (Billing) LIVE-environment verification — the USER's** (needs running app + Stripe/Resend/Inngest dashboards). See handoff003 §5. Still owed.
2. **Plan 5 — Launch readiness** (Turnstile widget wiring on forms, PostHog funnel + Sentry alerts, real legal copy, k6 load test, pre-launch checklist). NOT written.
3. **Deploy** (Vercel Pro, prod env LIVE Stripe keys, DNS → Vercel, register LIVE webhooks, Stripe business activation).

---

## 1. What Plan 3 hardening shipped (this session)

Scope: `app/r/[slug]/**`, `app/embed/[domain]/**`, `app/top/[platform]`, `app/compare/**` + `CompareForm`, `app/takedown/**` + `app/api/takedown`, `app/api/reports/mint`, `app/bot`, shared `GradeCard`. Ran the §4 methodology: 3 parallel Opus reviewers → controller-verify → TDD fix → re-review (4 rounds total) → ≥9 all lenses → pushed.

**Architecture decision (cost-driven): denormalize.** Added 5 columns to `public_reports` (`score, grade, cms_detected, orphan_count, avg_depth`) populated by a **BEFORE INSERT trigger** (`populate_public_report`, reads the immutable completed audit + a `pages` aggregate that exactly matches `aggregateGraphStats`). Result: the report page, OG card, embed badge, and leaderboard are each **one indexed single-table read** instead of a report→audit(→pages) fan-out — material against the ≤18%-MRR cost ceiling on the viral hot paths. A partial index `public_reports_leaderboard_idx (cms_detected, score desc) where opt_in_leaderboard and takedown_requested_at is null` serves the leaderboard.

**Bugs fixed (all the known ones + reviewer-found):**
- **OG card was blank for every report** — Next 15 makes `opengraph-image` `params` a `Promise`; the code read it sync → `undefined` slug. Now awaited.
- **Compare was non-functional** (started 2 audits, rendered 1, orphaned the other = wasted crawl). Built a real **`/compare/[a]/[b]`** results page + `CompareView` that streams BOTH audits side-by-side (shared `useAuditStream` hook) with a winner banner. `CompareForm` routes there + rejects same-site.
- **Embed badge double-nested `<html>`** under the single root layout (invalid). Rebuilt as a **Route Handler** returning a layout-free document (raw HTML → `htmlEscape` the attacker-controllable domain). View counter: atomic `increment_embed_view` RPC + an `embed_badges` row created at mint, run via `after()` so it survives serverless freeze; CDN-cached so counting is approximate-by-design (sampled per cache-miss — the right cost call).
- **Leaderboard wasn't ranked** (ordered by random `audit_id` UUID, limit 50, then JS-sorted). Now DB-ordered by the denormalized score before limit.
- **avgDepth was hardcoded 0** on public reports → now the real trigger-computed value.
- **Takedown was unauth + unthrottled + RLS `with check(true)`** → added per-IP + per-domain rate limits, bounded inputs, **validates a real non-taken-down report exists** (attaches its slug), optional Turnstile verify; dropped the always-true insert policy (anon key can't insert directly anymore).
- **Mint** → canonical `normalizeDomain`, per-user daily rate limit, slug-collision/idempotency retry (handles the double-submit `audit_id`-unique race), creates the owner's `embed_badges` row.
- **Security follow-ups (round 2/3):** taken-down reports were still readable via a direct anon PostgREST call (`public_reports` select policy was `using(true)`) → scoped to `takedown_requested_at is null`; the share functions + `increment_rate_limit` kept Supabase's default anon/authenticated EXECUTE grants (revoking from `public` doesn't remove them) → revoked by name, EXECUTE now service_role-only; both share fns are SECURITY INVOKER.
- **DRY/robustness:** `PASSING_SCORE`/`isPassingScore`, `siteUrl`/`siteHost` (no more hardcoded host), `BRAND` palette for satori/iframe, `lib/uuid`, `lib/html-escape` (+ tests); clipboard/`res.json()` hardening; `as never` hrefs → `as Route`.

**SEO decision (user said "you decide"):** public reports are now `index: true` (owner-vouched via domain verification; growth engine; leaderboard already links to them). Fallback if abuse appears: flip noindex per-report on takedown.

**6 migrations applied via Supabase MCP** (local mirror in `infra/supabase/migrations/`): `…07_public_reports_denormalize`, `…08_embed_view_increment`, `…09_takedown_rls_lockdown`, `…10_share_fns_invoker`, `…11_share_security_followups`, `…12_rate_limit_fn_grants`. `get_advisors` after: clean except the accepted passwordless `auth_leaked_password_protection` WARN (moot — magic-link).

**Green gates:** apps/web 64 tests / engine 171 / inngest 8; `tsc --noEmit` 0; `pnpm exec next lint` clean.

---

## 2. Accepted residuals / deferred (NOT blocking — documented)

- **Turnstile widget wiring** (takedown + other forms): the routes *verify* a token if supplied, but **no client Turnstile widget renders anywhere** in the app yet — it's a Plan-5 launch-readiness item (handoff003 §7). App-layer rate limits + report-existence validation are the live defense meanwhile.
- **Compare starts 2 audits per submit** (inherent to comparing two sites; each is individually rate-limited + SSRF-guarded via `/api/audits/start`). A partial-failure on one start orphans the other crawl — a known **cost-controls-pass** item, not a Plan-3 regression.
- **OG image cache (revalidate 3600) can persist ~1h after a takedown** (the page 404s within 300s). Low risk (owner-vouched public data, manual 2-day takedown SLA). When the admin takedown-approval action is built, add `revalidatePath('/r/[slug]')` + an OG purge.
- **AuditView (single-audit view) still has the brief 0-orphans/0.0-depth flash** at completion (the `progress[completed]` event lands before `done[stats]`). CompareView now gates on the terminal event to avoid it; AuditView is Plan-2 scope and wasn't reopened. Cheap future fix: apply the same `finished` gate.
- **`opt_in_leaderboard` defaults true** (mint never sets it) → every public report auto-joins `/top/[platform]`. Treated as intended viral/benchmarking behavior (mint is an explicit verified-owner "make public" action). Add an opt-out toggle if product wants it.

---

## 3. Gotchas discovered this session (carry-forward)

- **Next 15 metadata image routes** (`opengraph-image.tsx`, `twitter-image.tsx`) take `params: Promise<…>` — **must await** (same as pages). Reading sync silently yields `undefined` and breaks the card.
- **PostgREST can't reliably order/limit PARENT rows by an EMBEDDED column** — `order` on a referenced table only affects parent order *with `!inner`*, and it's fragile. For true top-N-by-child, **denormalize** (what we did) or use a DB view/RPC.
- **Converting a page → route handler reintroduces raw HTML** (no JSX auto-escaping) — escape every interpolated value (`lib/html-escape`).
- **`next/server` `after()`** (stable in Next 15.1+; we're on 15.5.18) for fire-and-forget work that must survive the serverless function freezing after the response flushes. A bare `void promise.then()` can be dropped.
- **`revoke execute … from public` does NOT remove Supabase's explicit per-role grants** — anon/authenticated keep EXECUTE. Revoke from `anon, authenticated` **by name**. Verify with `information_schema.routine_privileges`.
- **Clear `.next/types` after adding/removing a route** (e.g. deleting `page.tsx` for a `route.ts`) before `tsc --noEmit`, or a stale `validator.ts` references the old file → false error.
- **The Supabase MCP auto-classifier blocks persistent test DML on the live DB** (even with intent to clean up). Verify triggers/RPCs structurally (`pg_trigger`/`pg_proc`/`routine_privileges`) + test pure aggregate logic on a `VALUES` CTE, not by inserting rows.
- Standing gotchas still hold: vitest doesn't resolve `@/` in unit-tested `lib/*` (use relative imports — done); `/inngest` has its own vitest; `pnpm exec next lint` (not `eslint .` which lints `.next/`); migrations via Supabase MCP `apply_migration` (project `ezspnfeyzwsisymytssm`), NOT `supabase db push`; `nvm use` (Node 22) before pnpm; subagent push classifier blocks pushes to main → controller pushes.

---

## 4. Live verification owed (USER's) — unchanged from handoff005 §3

1. **Plan 2 anon funnel (browser):** audit logged-out → grade on `/audit/[id]` → sign up → audit appears on `/dashboard` (claimed).
2. **Plan 4 billing:** sign in (`public.users` auto-created now) → `/pricing` → Checkout (`4242…`) → confirm `users.pro_until` set, full findings + CSV work, Portal cancel clears Pro. Plus Stripe/Resend/Inngest dev loops (handoff003 §5). Wire a "Manage subscription" button → `/billing`.
3. **NEW (Plan 3, optional smoke):** verify a domain → mint a public report → check `/r/[slug]` renders the grade + real orphan/depth, the OG card unfurls, `/embed/[domain]` shows the badge, `/top/[cms]` ranks it, `/compare` runs two sites head-to-head, `/takedown` for an unknown domain is rejected.

---

## 5. Key references

- **Methodology + Plan-4 live verification:** `handoff003.md` §4 / §5. **Plan-2 details:** `handoff004.md` §4A. **Plan-3 round-1 brief:** `handoff004.md` §5 / `handoff005.md` §4.
- **Spec:** `docs/superpowers/specs/2026-05-24-crawlmouse-v1.0-design.md` + the Plan-4 billing design spec.
- **Migrations:** `infra/supabase/migrations/` (local mirror of what the MCP applied; `…07–…12` are Plan 3).

End of handoff 006.
