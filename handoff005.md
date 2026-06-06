# Crawlmouse — Project Handoff 005

**Date:** 2026-06-01 (later still)
**Working directory:** `/home/udsik/nahl-clients-projects/crawlmouse-v1.0.0`
**Repo:** https://github.com/sikder13/crawlmouse (private). Work on `main`. **`origin/main` HEAD = `b377c8d`** (Plan 2 hardening pushed — 11 commits `12f1466..b377c8d`).
**User:** Udaay Sikder (`ud.sikder@gmail.com` personal; **`nahlai.tech@gmail.com` = business Gmail for ALL Nahl Tech SaaS signups**).
**Supersedes:** handoff004 (keep handoff003 for the §4 methodology + §5 Plan-4 live verification).

---

## 0. RESUME PROMPT FOR THE PLAN 3 SESSION (paste into the new session)

> Read `/home/udsik/nahl-clients-projects/crawlmouse-v1.0.0/handoff005.md` in full, then `handoff003.md` §4 (the review methodology, verbatim) and `handoff004.md` §5 (Plan-3 scope + the round-1 findings already surfaced). Your auto-loaded `MEMORY.md` index holds standing prefs — trust it but verify any file/flag it names still exists before acting.
>
> Continue the **codebase-hardening campaign** with **Plan 3 (sharing / public reports / embed / leaderboard / compare / takedown)**. Run the §4 process: scope the surface, dispatch 3 parallel **Opus** adversarial reviewers (correctness / security / perf+naming), CONTROLLER-VERIFY every finding against the real code (discard non-issues), score each lens, fix everything real with TDD tests, re-review, iterate until **≥9/10 across all lenses**, then push to `main`. The known Plan-3 bugs to verify+fix are in handoff004 §5 (compare non-functional, embed `view_count` overwrite, leaderboard not actually ranked, OG-image score-0) PLUS the residuals Plan 2 deferred to Plan 3 (see §4 below: takedown unauth insert + always-true RLS, slug collision retry). Plan 2 already owns the shared `GradeCard` numeric coercion and the capability-URL read model — build on them.
>
> Honor standing prefs: subagents on **Opus**; **never mention AI/Claude in commits/PRs/comments, strip Co-Authored-By**; distinctive/playful UI; fresh web research with sources for significant decisions; SaaS signups use nahlai.tech@gmail.com. **`nvm use` (Node 22) before any pnpm.** Apply DB migrations via the **Supabase MCP `apply_migration`** (project `ezspnfeyzwsisymytssm`), NOT `supabase db push`. **Controller pushes.** Start by confirming you've read this + MEMORY, give a 3-line status, then kick off the Plan 3 review.

---

## 1. Where we are

- **Plan 1 (engine): HARDENED + PUSHED ✅** (scores 9.5 / 9 / 9.5; 171 tests).
- **Plan 2 (apps/web + auth + tRPC + middleware + RLS): HARDENED + PUSHED ✅** — this session. `origin/main` HEAD `b377c8d`. Final scores after 3 review rounds: **correctness 9 / security 9 / perf 9**. apps/web 50 tests, inngest 8 tests, engine 171 tests — all green; tsc + `next lint` clean across packages.
- **Plan 4 (Billing): code pushed.** Its live-env verification is the USER's (handoff003 §5) — **and is now UNBLOCKED**: Plan 2 fixed the root cause that would have broken it (see §2, users-provisioning). Re-run the purchase loop and confirm `users.pro_until` actually gets set now.
- **Plan 3: NOT yet hardened — this is the next work.**
- **Plan 5 (launch readiness) + deploy:** after Plan 3.

---

## 2. What Plan 2 hardening shipped (11 commits, `12f1466..b377c8d`)

**Headline / decided fixes:**
- **Anonymous-audit capability-URL read** (the decided fix): `/audit/[id]` page + its SSE stream now read via the service-role `supabaseAdmin()` client keyed on the unguessable audit UUID (RLS bound reads to `user_id = auth.uid()`, 404ing anonymous audits). The client payload is projected (`projectForClient`) to **never** include `user_id`; findings/pages read via a shared paged `fetchAll`. RLS itself is unchanged (still closed) — verified against the live DB that the `anon` role reads 0 audits and cannot insert.
- **`numeric→string` `score.toFixed` crash:** coerced once at the data boundary via `lib/numeric.ts asNumber` (stream payload, tRPC, `listMyAudits`). GradeCard now gets a real number.
- **Anon→user claim on sign-up:** stable httpOnly `crawlmouse_anon` cookie (`lib/anon-session.ts`) stored as `anonymous_session_id`; `/api/auth/claim` (called from `login/verify`) reassigns those audits to the new user, once-guarded.

**Confirmed CRITICAL found mid-review (not in the original list):**
- **`public.users` was never provisioned on sign-up** (verified live: 2 auth users / 0 public.users). This silently broke the Stripe entitlement webhook (it UPDATEs users by id/customer → matched 0 rows → Pro never granted). Fixed with the standard `handle_new_user` trigger + backfill (migration `…04`), EXECUTE revoked from API roles. **This is why Plan 4's purchase loop must be re-verified — it should work now.**

**Other real bugs fixed (with TDD where logic existed):**
- Inngest persistence: (a) page-id map was built from the insert's RETURNING, capped at ~1000 rows → links/findings silently dropped on >1000-page Pro crawls — now a paged read-back; (b) status flipped to `completed` before findings were inserted (race → "0 findings" stuck UI) — children inserted first; (c) made **idempotent + fail-loud** (clears children on retry, throws on every DB error) + `onFailure` marks failed only after retries; `run-engine` no longer writes a premature sticky `failed`. Row mappers + idempotency are unit-tested (`inngest/persist-helpers.ts`, `inngest/persist-results.ts`).
- Stream findings unbounded → paged. GradeCard showed hardcoded 0 orphans/0 depth (dead `LinkGraph` `full` state) → real `aggregateGraphStats` server-side. Progress bar stuck at 0% → honest indeterminate bar. completed-without-grade infinite spinner → terminal state. Dashboard duplicated `listMine` minus the `expires_at` filter → shared `listMyAudits`; timestamp via `LocalTime` client component.
- Rate-limit fallback race → fail-open + log. Domain normalization (`www.` bypass) → shared `normalizeDomain`. Magic-link had no throttle → per-IP + per-email. Verify endpoints unthrottled outbound → per-user limit (after ownership check). `checkMetaTag` SSRF (validate-then-raw-fetch) → engine `safeFetch` (now exported). tRPC raw error disclosure → opaque `TRPCError`.

**DB migrations applied via Supabase MCP (local `.sql` in `infra/supabase/migrations/`):**
- `20260601000004_user_provisioning.sql` — `handle_new_user` trigger + backfill + drop `users.id` default + revoke EXECUTE.
- `20260601000005_rls_perf_hardening.sql` — rewrote every policy's `auth.uid()` → `(select auth.uid())` (advisor `auth_rls_initplan`), **dropped `audits_owner_insert`** (all inserts go via service role), added FK covering indexes (findings.page_id, links.from/to_page_id, takedown slug). **User explicitly approved the policy drop + rewrite** (classifier had escalated it).
- `20260601000006_audits_anon_session_idx.sql` — partial index on `audits.anonymous_session_id` for the claim lookup.

Live `get_advisors` after the work: **clean** except two accepted WARNs — `takedown_anyone_insert` always-true (intentional public abuse-report form → Plan 3 adds app-layer rate-limit/captcha) and `auth_leaked_password_protection` disabled (**moot — passwordless magic-link**, optionally toggle on in the dashboard).

---

## 3. Live verification owed (USER's — needs a running app + dashboards)

1. **Plan 2 anon funnel (browser):** run an audit logged-out → see the grade on `/audit/[id]` (capability URL) → sign up → confirm the audit appears on `/dashboard` (claimed). This is the one path unit tests + the live RLS probe can't fully cover.
2. **Plan 4 billing (now unblocked):** sign in (a `public.users` row is auto-created now) → `/pricing` → Checkout (`4242…`) → confirm `users.pro_until` is set, full findings + CSV work, Portal cancel clears Pro. Plus the Stripe/Resend/Inngest dev loops from handoff003 §5. Wire the "Manage subscription" button → `/billing`.

---

## 4. Plan 3 scope + carried-over findings

**Scope files (handoff004 §5):** `app/r/[slug]/**` (+ `opengraph-image.tsx`), `app/embed/[domain]/**`, `app/top/[platform]/page.tsx`, `app/compare/page.tsx` + `components/share/CompareForm.tsx`, `app/takedown/page.tsx` + `app/api/takedown`, `app/api/reports/mint/route.ts`, `app/bot/page.tsx`. Shared `components/ui/GradeCard.tsx` (Plan 2 owns its numeric coercion — done).

**Known Plan-3 bugs to verify+fix (handoff004 §5):** compare is non-functional (starts both audits, never renders a comparison); embed `view_count` does `update({view_count:1})` (overwrite, never increments; no `embed_badges` row ever inserted) → needs an `increment_embed_view` RPC + insert-on-conflict; leaderboard orders by `audit_id desc` then JS-sorts (it's the 50 newest, not top-50 by score) → order by joined score in DB before limit; OG-image treats score 0 as falsy (`audit?.score ? … : '—'`) → use `!= null`.

**Residuals Plan 2 deferred to Plan 3 (verified real, intentionally scoped out):**
- **Takedown endpoint** (`app/api/takedown`): fully unauthenticated + unthrottled, and RLS `takedown_anyone_insert with check (true)` lets the anon key insert directly (advisor WARN). Add app-layer rate-limit + Turnstile + validate `publicReportSlug`; treat stored `reason`/`email` as untrusted wherever rendered.
- **Slug collision retry** (`lib/slug.ts` / mint): 22-char nanoid into a PK with no 23505 retry (astronomically rare; add a tiny retry in the mint insert).
- **Plan-3 security focus:** XSS in the public/indexed `/r/[slug]`, `embed/[domain]`, `opengraph-image` (unescaped user data / `dangerouslySetInnerHTML`); CSV/formula injection in exports; IDOR on mint/takedown; SSRF via embed/compare.

**Accepted LOW/INFO residuals (documented, not blocking — re-confirm during Plan 3 if they touch its surface):**
- No CSRF/Origin check on state-changing POSTs (claim/start/verify) — SameSite=Lax + idempotent/own-data-only make it near-nil; add an Origin allowlist as defense-in-depth if convenient.
- Rate-limiter fails **open** on RPC error (availability-over-strictness, logged) + per-IP trust assumes the **Vercel** edge rewrites `x-forwarded-for` (true on Vercel; the `ip==='unknown'` skip avoids a shared-bucket lockout off-platform). For v1.2 self-host, gate the skip on an explicit `process.env.VERCEL`/trusted-edge flag.
- `magic:email` bucket doesn't canonicalize Gmail plus/dot aliases (per-IP + Supabase's own throttle bound it).
- tRPC `audits.getById`/`listMine` are the **reserved v1.2 API surface** (mounted but unused by the v1.0 UI; `getById` is owner-scoped via RLS by design). Gate behind v1.2 API-key auth before that surface actually ships.

---

## 5. Gotchas discovered this session (carry-forward)

- **vitest path aliases:** `apps/web` vitest does NOT resolve the `@/…` alias inside imported lib modules. Unit-tested `lib/*` files must use **relative imports** (`./numeric`), like the rest of `lib`. Route/component files (not unit-tested) can keep `@/…`.
- **`/inngest` now has a test runner** (added `vitest` + `vitest.config.ts`; `pnpm test` = `vitest run`). 13 inngest tests live there. It's a separate workspace package — can't import `apps/web` lib (no shared supabase-utils package; `fetchAll`/`POSTGREST_PAGE` is duplicated as `PAGE_READBACK` in inngest by necessity — documented).
- **`eslint .` lints `.next/` build output** (1684 false "errors"). Use `pnpm exec next lint` (or `--ignore-pattern '.next/**'`) for the real source-lint (clean).
- **LinkGraph deleted** + its `sigma`/`graphology`/`@react-sigma/core` deps removed from `apps/web` (engine keeps its own graphology for PageRank). It was an unwired shell feeding fake-0 stats. The **"living link graph" wedge** will need a real data-wired implementation when built (recover the shell from git if useful).
- Inngest default retries (4) mean a failing crawl re-runs the engine up to 5× — pre-existing; a cost-control follow-up could set `retries` lower for crawl failures.

---

## 6. Operational watch-outs (unchanged carry-forward)

- **Node 22** — `nvm use` before pnpm. **Migrations via Supabase MCP `apply_migration`** (project `ezspnfeyzwsisymytssm`), NOT `supabase db push`. **Subagents on Opus; no AI mentions in commits/PRs/comments; distinctive/playful UI; fresh research with sources; SaaS signups → nahlai.tech@gmail.com.** **Subagent push classifier blocks pushes to main — controller pushes.** Cost ceiling ≤18% MRR. Cloudflare MCP lacks Turnstile scope. Stripe statement-descriptor typo + co-founder access + legal placeholders pending (Plan 5/deploy).

## 7. Key references

- **Methodology + Plan-4 live verification:** `handoff003.md` §4 / §5. **Plan-2 details + Plan-3 round-1 findings:** `handoff004.md` §4A / §5.
- **Spec:** `docs/superpowers/specs/2026-05-24-crawlmouse-v1.0-design.md` + the Plan-4 billing design spec.
- **Migrations:** `infra/supabase/migrations/` (local mirror of what the MCP applied).

End of handoff 005.
</content>
