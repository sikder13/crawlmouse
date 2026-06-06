# Crawlmouse — Project Handoff 004

**Date:** 2026-06-01 (later)
**Working directory:** `/home/udsik/nahl-clients-projects/crawlmouse-v1.0.0`
**Repo:** https://github.com/sikder13/crawlmouse (private). Work on `main`. **`origin/main` HEAD = `639402f`** (Plan 1 engine hardening pushed).
**User:** Udaay Sikder (`ud.sikder@gmail.com` personal; **`nahlai.tech@gmail.com` is the business Gmail for ALL Nahl Tech SaaS signups**).
**Supersedes:** handoff003 (still useful for the §4 methodology + §5 Plan-4 live verification + §6 RLS context — keep it around).

---

## 0. RESUME PROMPT FOR THE PLAN 2 SESSION (paste this into the new session)

> Read `/home/udsik/nahl-clients-projects/crawlmouse-v1.0.0/handoff004.md` in full before doing anything else, then read `handoff003.md` §4 (the review methodology you must follow verbatim), §5, §6. Your auto-loaded `MEMORY.md` index holds standing facts/preferences — trust it but verify any file/flag it names still exists before acting.
>
> Continue the **codebase-hardening campaign** with **Plan 2 (apps/web + auth + tRPC + middleware + RLS)**. Run the §4 process: scope the surface, dispatch 3 parallel **Opus** adversarial reviewers (correctness / security / perf+naming), CONTROLLER-VERIFY every finding against the real code (discard non-issues), score each lens, fix everything real with TDD tests, re-review (round 2), iterate until **≥9/10 across all lenses**, then push to `main`. A complete round-1 **correctness** review is already in this handoff (§4A) — treat it as a head start to verify, not gospel; the security + perf reviewers were killed mid-run so re-run those two fresh.
>
> The headline fix: the **anonymous-audit RLS gap** (§3) — the user has DECIDED the **capability-URL** approach (read `/audit/[id]` page + its SSE stream via the service-role `supabaseAdmin()` client keyed on the unguessable UUID, minimal columns, no migration). Also fix the **`numeric→string` `score.toFixed` crash** and the **anon-audit claim-on-signup** gap (§4A #1/#2/#8).
>
> Honor standing prefs: subagents on **Opus**; **never mention AI/Claude in commits/PRs/comments or strip Co-Authored-By**; distinctive/playful UI; fresh web research with sources for significant decisions; SaaS signups use nahlai.tech@gmail.com. **`nvm use` (Node 22) before any pnpm.** Apply DB migrations via the **Supabase MCP `apply_migration`**, NOT `supabase db push`. **Controller pushes** (subagents are blocked from pushing to main). Start by confirming you've read this file + MEMORY, give a 3-line status, then kick off the Plan 2 review.

(There's a separate Plan 3 resume prompt in §6 if you run Plan 3 in parallel.)

---

## 1. Where we are

- **Plan 1 (packages/engine): HARDENED + PUSHED ✅** — `origin/main` HEAD `639402f`, 8 commits `eece188..639402f`. Final scores after 3 review rounds: **correctness 9.5 / security 9 / perf 9.5**. 171 engine tests green, tsc + eslint clean, full monorepo suite green. Closed real SSRF holes (safeFetch validates + IP-pins all raw fetches; crawler pins via got-14 `dnsLookup`; sitemap caps/gzip/DOCTYPE guard; NAT64/6to4/userinfo), fixed an empty-graph crash + orphan double-penalty + score/grade boundary, made robots.txt RFC-9309-compliant (linear matcher, no ReDoS) AND enforced, high-precision CMS detection, constants, dead deps removed.
- **Plan 4 (Billing): CODE COMPLETE + PUSHED ✅** (was the prior milestone, HEAD `ed03c7e`, folded under Plan 1's history now). Scores 10/~10/8.5. **Its LIVE-environment verification is the USER's to run** (Stripe `stripe listen`, Resend webhook + `RESEND_WEBHOOK_SECRET`, Inngest dev crons, browser purchase loop, `pnpm test:e2e billing`, wire a "Manage subscription" button → `/billing`). See handoff003 §5.
- **Plan 2 + Plan 3: NOT yet hardened — this is the work.**
- **Plan 5 (launch readiness) + deploy:** after the hardening campaign.

---

## 2. The review methodology (follow handoff003 §4 verbatim)

Per plan: (1) map files + LOC; (2) dispatch **3 parallel Opus reviewers** (`Agent`, `subagent_type: general-purpose`, `model: opus`, read-only) — correctness / security / perf+naming, each returning numbered findings with severity / file:line / what's wrong / why / EXACT fix + a 0–10 sub-score, flaws only; (3) **controller verifies every finding against the real code** (discard non-issues — do not blindly trust subagents); (4) **fix** confirmed issues yourself or via sequential fix-subagents (NEVER parallel implementers — git index conflicts), add/extend unit tests per logic fix, commit per logical group (**no AI mentions, no Co-Authored-By**); (5) re-run the 3 reviewers (round 2) to confirm resolution + hunt regressions + re-score; (6) iterate 4→5 until **≥9/10**; (7) controller pushes.

**Lesson from Plan 1: actually run the production path.** Two regressions (got option name, and a hostile-robots ReDoS) passed the unit tests because the tests used bypass/loopback — they were only caught by a real non-bypass crawl + a ReDoS timing test. For Plan 2, exercise the real auth/RLS/SSE path, not just mocks.

Verification commands (run `source ~/.nvm/nvm.sh && nvm use 22` first):
- Web tests: `cd apps/web && pnpm exec vitest run` (e2e excluded by vitest.config).
- Web typecheck: `cd apps/web && pnpm exec tsc --noEmit` (engine baseline is now 0, so any error here is genuinely apps/web).
- Web lint: `cd apps/web && pnpm exec eslint .`
- E2E (needs running app + env): `cd apps/web && pnpm test:e2e`.

---

## 3. Plan 2 scope + the DECIDED anon-audit fix

**Scope (apps/web core):** `lib/supabase/{server,client,admin}.ts`, `middleware.ts` (only 11 LOC — verify it isn't a no-op), `app/login/**`, `app/api/auth/magic-link`, `lib/turnstile.ts`, `lib/trpc/{router,server,client,Provider}`, `app/api/audits/{start,[id]/stream,[id]/export}`, `app/audit/[id]/**`, `app/dashboard`, `app/api/verify/**` + `lib/verification.ts`, `lib/rate-limit.ts`, `lib/findings.ts`, `lib/pro.ts`, `lib/tier.ts`, `lib/limits.ts`, `lib/origin.ts`, `lib/slug.ts`, and the RLS migrations `infra/supabase/migrations/20260524000004_rls.sql` + `20260526000001_rls_rate_limits.sql`. (Billing — `lib/billing/**`, `app/api/billing`, `webhooks/stripe` — was hardened in Plan 4; skip its internals but flag any auth/RLS issue touching it.)

**Anonymous-audit RLS gap — DECISION MADE: capability-URL.** `audits_owner_read` is `using (user_id = auth.uid())` only; anonymous audits have `user_id = NULL`, so the RLS-bound `supabaseServer()` client returns null → `app/audit/[id]/page.tsx` calls `notFound()` → a 404 on the user's own result, and the SSE stream emits nothing. The migration even comments an "anonymous_session_id matches header" policy that was never written.
**Fix to implement:** read the `/audit/[id]` page AND its SSE stream (`app/api/audits/[id]/stream/route.ts`) via the existing service-role `supabaseAdmin()` client, keyed on the unguessable audit UUID, selecting **minimal columns only** (never `user_id`/emails). This matches the existing public `/r/[slug]` model; Plan 4 already caps findings to top-5 server-side for non-owners, so no over-exposure. ~2–3 files, **no migration**. Pro "private reports" still governs `/r/[slug]` indexing separately. **Watch the blast radius:** once reads bypass RLS via admin client, make sure those endpoints don't over-select or leak other-user data, and that owner-only actions (export, mint, dashboard) still authorize the caller.

---

## 4A. Plan 2 CORRECTNESS review — COMPLETE (round 1, sub-score 4/10). CONTROLLER MUST VERIFY each before fixing.

These are a subagent's findings on the CURRENT apps/web (Plan 1 didn't touch apps/web). Verify each against the code; some may be partial/non-issues. **Release-blockers in bold.**

- **#1 [CRITICAL] anon-audit RLS gap** — see §3 (decided: capability-URL). Files: `lib/supabase/server.ts`, RLS `:16`, consumed in `stream/route.ts`, `audit/[id]/page.tsx:10`, `lib/trpc/router.ts:11`. Also fix `pages`/`findings` reads for anon audits the same way.
- **#2 [HIGH/blocker] `score` numeric→string `.toFixed` crash** — PG `numeric(5,2)` is serialized by PostgREST as a JSON **string** (`"87.50"`). `AuditView.tsx:60` passes `snapshot.score` (typed `number`, actually string) to `GradeCard.tsx:19` which calls `score.toFixed(0)` → **TypeError white-screens every completed report**. `r/[slug]:59` and `top/[platform]:48` already wrap with `Number(...)`; AuditView doesn't. Fix: coerce once (`Number(snapshot.score)`), and audit ALL score/numeric consumers. (Shared with Plan 3 pages.)
- **#3 [HIGH] SSE stream no `maxDuration`** — `app/api/audits/[id]/stream/route.ts` has no `export const maxDuration`; Vercel kills it at ~10–15s while a crawl takes minutes → EventSource reconnect churn. Fix: set `maxDuration` (300) and confirm tier, or make the reconnect-as-poll pattern intentional (short stream + `retry:`).
- **#4 [HIGH] progress bar always 0%** — `page_count` is written only in the terminal `persist-results` step (`inngest/audit.ts`), so `AuditProgress` shows `0 / 500` for the whole crawl then jumps to done. Fix: write incremental `page_count` during crawl, or stop implying page progress while `status==='crawling'`.
- **#8 [MEDIUM/funnel] no anon→user claim flow** — anon audits (`user_id=null`) are never reassigned on signup, and can't be exported/shared by anyone. So "audit anonymously → sign up → keep it" is broken; user loses prior audits. Fix: on magic-link verify/first sign-in, `update audits set user_id=:uid where anonymous_session_id=:sid and user_id is null` (needs the anon session id stored — a cookie set at audit-start; coordinate with the capability-URL decision).
- **#9 [MEDIUM] rate-limit boundary + non-atomic fallback** — fixed-window allows 2× at the boundary; the `error` fallback path in `lib/rate-limit.ts` is read-then-write (races, undercounts). Fix: sliding window or accept fixed-window tradeoff explicitly; make the fallback an atomic upsert or remove it. (Cost-control lever — the 18%-MRR ceiling.)
- **#10 [MEDIUM] inconsistent domain normalization** — rate-limit key uses raw `hostname` (keeps `www.`) while mint/verify strip `^www\.` → `www.` vs apex are separate rate buckets (free-audit bypass) but same domain for verify/share. Fix: one shared normalize helper everywhere.
- **#11 [LOW] completed-but-ungradable stuck on spinner** — `AuditView.tsx:48` `done = status==='completed' && grade`; a completed audit with null grade → `running` forever. Fix: derive `done` from status alone; handle missing-grade as its own state.
- **#13 [LOW] done-before-findings race** — `inngest/audit.ts` flips status to `completed` before inserting findings (same step); the 2s stream poll can observe completed in the gap → emits `done` with empty findings, EventSource closes, user permanently sees "0 findings". Fix: set `completed` only AFTER pages/links/findings are all inserted.
- **#14 [LOW] verify-check unbounded outbound** — `app/api/verify/check/[id]` does DNS/`fetch` on each click with no rate limit; `checkDnsTxtRecord` resolves an unvalidated `_crawlmouse.${domain}`. Fix: rate-limit the check endpoint.
- **#15 [LOW] slug insert no retry on collision** — `lib/slug.ts` 22-char nanoid into PK with no 23505 retry (astronomically rare; optional).
- **#16 [LOW] dashboard vs `listMine` divergence + hydration** — `listMine` filters `expires_at`, `dashboard/page.tsx` doesn't → lists disagree; `dashboard:42 toLocaleString()` renders server-tz then client-tz → hydration mismatch. Fix: unify the filter; stable timezone.

**Findings #5, #6, #7, #12 belong to PLAN 3** (see §5) — the correctness reviewer's scope bled into sharing/embed.

## 4B. Plan 2 SECURITY + PERF reviews — KILLED mid-run (no final report). RE-RUN FRESH. Partial leads captured:
- **Security leads (unconfirmed):** confirm RLS `enabled/forced` on every sensitive table (`audits`, `pages`, `links`, `findings`, `users`, `sessions`, `rate_limits`, `stripe_events`, `email_events`, `public_reports`, `embed_badges`); check `audits_owner_insert` allows `user_id is null` — can someone forge/claim another's audit?; audit the new `supabaseAdmin()` read paths for over-select/IDOR; verify `app/api/audits/start` runs the engine SSRF guard before any fetch; Turnstile actually enforced on start/login; magic-link open-redirect; service-role key never reaches the client.
- **Perf leads (unconfirmed):** SSE polls every 2000ms with no max-duration; `buildDone` fetches findings unbounded (PostgREST silently caps ~1000 rows); dashboard duplicates audit-list logic instead of using tRPC; export route inlines a `pro_until` query instead of the shared `isProActive`. Run the typecheck/lint/test baseline first.

---

## 5. Plan 3 scope (sharing / public reports / embed / leaderboard / compare / takedown)

**Scope files:** `app/r/[slug]/**` (+ `opengraph-image.tsx`), `app/embed/[domain]/**`, `app/top/[platform]/page.tsx`, `app/compare/page.tsx` + `components/share/CompareForm.tsx`, `app/takedown/page.tsx` + `app/api/takedown`, `app/api/reports/mint/route.ts`, `app/bot/page.tsx`, shared `components/ui/GradeCard.tsx` (also used by Plan 2).

**Plan 3 findings already surfaced (from the correctness reviewer; verify before fixing):**
- **#5 [HIGH] compare is non-functional** — `CompareForm` starts BOTH audits and routes to `/audit/${idA}?compare=${idB}`, but `AuditView` never reads the `compare` param → audit B is started (cost + rate-limit consumed) then orphaned; no comparison renders. Fix: build the real two-column compare view, or remove `/compare` + `CompareForm` until built.
- **#6 [HIGH] embed view counter broken** — `app/embed/[domain]/page.tsx:38` does `update({ view_count: 1 })` (sets to literal 1, never increments) AND no `embed_badges` row is ever inserted (mint only writes `public_reports`) → the `.eq('domain', …)` update matches 0 rows, no-ops. Plus an unhandled `.then()` rejection. Fix: an `increment_embed_view` RPC (`view_count = view_count + 1`) + ensure the row exists (insert-on-conflict).
- **#7 [MEDIUM] leaderboard not actually ranked** — `top/[platform]:29` orders by `audit_id desc` + `.limit(50)` BEFORE the JS `.sort` by score → it's the 50 newest, then sorted, not the top-50 by score. Fix: order by the joined score in the DB before limit.
- **#12 [LOW] OG image treats score 0 as falsy** — `r/[slug]/opengraph-image.tsx:26` `audit?.score ? … : '—'` → an F-site (score 0) shows "—" on its social card (the exact viral case). Use `!= null`. Also the `params` shape is sync vs the awaited `Promise` siblings (Next 15).
- Plus the **shared `GradeCard` `.toFixed` coercion (#2)** and the **capability-URL read model (#1)** — Plan 3's `r/[slug]`/`embed` pages depend on both; see §6.

Plan 3 also needs its own fresh 3-lens review (these are only the correctness bleed-over). Security focus for Plan 3: XSS in the public/indexed `/r/[slug]`, `embed/[domain]`, `opengraph-image` (unescaped user data / `dangerouslySetInnerHTML`), CSV/formula injection in any export, IDOR on mint/takedown, open SSRF via embed/compare.

---

## 6. Parallel vs sequential — honest recommendation + how-to

**Recommendation: do Plan 2 first, then Plan 3 (sequential).** Reason: Plan 2 and Plan 3 both live in `apps/web` and **share** (a) the audit-read model you're changing to capability-URL, (b) the `numeric→string score` coercion fix, and (c) the `GradeCard` component. Plan 3's `r/[slug]`/`embed`/`top` pages render audits/scores using exactly what Plan 2 hardens, so running them truly in parallel means Plan 3 reviews/fixes a moving target and you pay a painful integration merge on the overlapping files. Sequential lets Plan 3 build on a hardened, pushed Plan 2 foundation.

**If you still want parallel** (saves wall-clock, costs an integration merge), use **git worktrees** — two separate checkouts on two branches, each driven by its own Claude Code session:

```bash
cd /home/udsik/nahl-clients-projects/crawlmouse-v1.0.0
git worktree add -b harden/plan-2 ../crawlmouse-plan2 main
git worktree add -b harden/plan-3 ../crawlmouse-plan3 main
# each worktree is a full checkout on its own branch off 639402f
```
Then per worktree (each needs its own install + the gitignored secrets copied in):
```bash
cd ../crawlmouse-plan2 && source ~/.nvm/nvm.sh && nvm use 22 && pnpm install
cp /home/udsik/nahl-clients-projects/crawlmouse-v1.0.0/apps/web/.env.local apps/web/.env.local
cp /home/udsik/nahl-clients-projects/crawlmouse-v1.0.0/scripts/.env.local scripts/.env.local 2>/dev/null || true
# repeat for ../crawlmouse-plan3
```
Open one Claude Code session in `../crawlmouse-plan2` (Plan 2 prompt, §0) and another in `../crawlmouse-plan3` (Plan 3 prompt below). Each session works/commits on its own branch and does NOT push to `main` directly — instead:
1. Land **Plan 2 first**: merge `harden/plan-2` → `main`, push. (It owns the shared read-model + score fix + GradeCard.)
2. Then **rebase `harden/plan-3` on the updated `main`**, resolve the overlap conflicts (mostly GradeCard / shared read helper / `r/[slug]` reads), re-run Plan 3's tests + a round-2 review on the merged result, then merge → `main`.
Cleanup when done: `git worktree remove ../crawlmouse-plan2 && git worktree remove ../crawlmouse-plan3`.

Caveats: each worktree has its own `node_modules`; `.env.local` and `scripts/.env.local` are gitignored so copy them in; do NOT run two `pnpm install` against the same store concurrently the first time (let one finish). Two sessions can't both push to `main` cleanly — integrate via the branch-merge order above.

**Plan 3 resume prompt (if running in parallel):**
> Read `/home/udsik/nahl-clients-projects/crawlmouse-v1.0.0/handoff004.md` §5 + §6 in full, then handoff003.md §4 (methodology). You are hardening **Plan 3 (sharing / public reports / embed / leaderboard / compare / takedown)** in apps/web, in an isolated git worktree on branch `harden/plan-3`. Run the §4 process (3 parallel Opus reviewers → controller-verify → TDD fix → re-review → ≥9/10), commit to `harden/plan-3` (do NOT push to main — Plan 2 lands first, then this rebases on it). The known Plan-3 bugs to verify+fix are in §5 (compare non-functional, embed counter broken, leaderboard not ranked, OG-image score-0). Coordinate the shared `GradeCard` numeric-coercion fix and the capability-URL audit-read model with Plan 2 — assume Plan 2 owns those; rebase onto its merged result before final review. Honor standing prefs (Opus subagents; no AI mentions in commits; distinctive/playful UI; fresh research; Node 22 `nvm use`; Supabase MCP for migrations).

---

## 7. Operational watch-outs (carry-forward)

- **Node 22** required — `nvm use` (or `source ~/.nvm/nvm.sh && nvm use`) in every terminal before pnpm.
- **Migrations:** apply to remote via **Supabase MCP `apply_migration`** (project `ezspnfeyzwsisymytssm`), NOT `supabase db push` (`SUPABASE_DB_URL` absent). The capability-URL fix needs NO migration; if Plan 2/3 add one, use the MCP. Keep local `.sql` files in `infra/supabase/migrations/`.
- **got 14 gotcha (engine):** crawlee 3.16 → got-scraping → **got 14**; the DNS pin option is `dnsLookup` (NOT `lookup`), and got 14 THROWS on ANY unknown gotOptions key. (Already handled in `crawler.ts`; relevant if you touch crawl options.)
- **The "40 engine typecheck errors" were a stale pnpm store** — `pnpm install` fixes it to 0; not a code issue.
- **Production-path testing:** apps/web has a network-dependent crawler smoke test now; bypass/mocked tests miss real wiring bugs (see §2 lesson). Exercise the real auth/RLS/SSE path.
- **Subagents on Opus** always; **no AI/Claude mentions** in commits/PRs/comments/Co-Authored-By; **distinctive/playful UI**; **fresh web research with sources** for significant decisions; **SaaS signups use nahlai.tech@gmail.com**.
- **Subagent push classifier blocks `git push` to `main` from subagents — controller pushes.**
- **Cost ceiling:** ops cost (excl Stripe/marketing) ≤18% of MRR — rate-limit/SSE/concurrency fixes feed this.
- Cloudflare MCP OAuth lacks Turnstile scope (needs scoped `CLOUDFLARE_API_TOKEN` in `scripts/.env.local` for Turnstile edits). Stripe statement-descriptor typo + co-founder access + legal placeholders still pending (Plan 5/deploy).

---

## 8. Key references

- **Memory:** `~/.claude/projects/-home-udsik-nahl-clients-projects-crawlmouse-v1-0-0/memory/` (MEMORY.md index — RESUME POINT points here).
- **Methodology + Plan-4 live verification + RLS context:** `handoff003.md` §4 / §5 / §6.
- **Spec:** `docs/superpowers/specs/2026-05-24-crawlmouse-v1.0-design.md` (21 locked sections) + the Plan-4 billing design spec.
- **Plans:** `docs/superpowers/plans/2026-05-24-...-plan-{1,2,3}-*.md` + `...-plan-4-billing.md`.
- **Execution logs:** `~/.claude/projects/.../work-log/plan-{1,2,3}-execution-log.md`.

End of handoff 004.
</content>
</invoke>
