# Handoff 011 — Launch-blocker SESSION A: core crawl correctness (A1/A1b/A2/A3) — 2026-06-06

Resumed from `handoff010.md` + `docs/deploy/launch-readiness-assessment.md` (§A/§E) + `project_launch_blockers`.
Scope was **Session A only**: make a real server-rendered site audit CORRECTLY. A4/A5/A6/A7 are Session B; deploy+legal are Session C.

## ✅ DONE — A1, A1b, A2, A3 implemented (TDD), gated, pushed to main
Commit **`385ea3f`** `fix(engine,inngest): launch-blocker crawl correctness (A1/A1b/A2/A3)` (no AI attribution).

- **A1** `packages/engine/src/crawler.ts` — enqueue `strategy:'same-origin'` → **`'same-hostname'`**; enqueue the
  REAL-scheme link URLs (extractPage already bounds to same host + http(s)); the redundant `startsWith(origin)`
  pre-filter (scheme/port-sensitive — the bug) was dropped. SSRF unchanged (per-hop revalidate + dnsLookup pin).
- **A1b** `url-canonical.ts` gains `canonicalizeUrl(u, { forceScheme })`; `crawler.ts` pins every stored page +
  link IDENTITY to the homepage scheme (still fetches the real URL); `audit.ts` derives `canonicalScheme`/
  `canonicalOrigin` from `homepageRes.finalUrl` and threads it through the crawl, seeds, sitemap filter, and the
  orphan/depth root. (WHATWG already strips a URL's own-scheme default port, so the port-drop only needs the forced scheme.)
- **A2** `inngest/audit.ts` — extracted **`crawlAndPersist()`** (runAudit + persistAuditResults, returns ONLY
  `{auditId,grade,score,pages:count}`); the wrapper runs it in ONE `step.run('crawl-and-persist')`. The multi-MiB
  crawl result never crosses a step boundary. Idempotent persist preserved. **Tradeoff:** a persist failure re-runs
  the whole crawl on retry (documented; accepted vs streaming the big object back).
- **A3** `grade.ts`/`constants.ts`/`audit.ts`/`types` — `MIN_COVERAGE_PAGES=5`, `LOW_CONFIDENCE_SCORE_CAP=60`.
  `computeGrade` caps the score (ceiling, not floor) when fewer than 5 **successfully-fetched** pages
  (statusCode 2xx/3xx — excludes the statusCode-0 failed rows AND 4xx); `audit.ts` emits an `incomplete_crawl`
  finding; new `FindingCategory` member + FindingsPanel label "Too few pages to grade confidently (grade capped)".

### Gate (the project's TDD + 3-reviewer ≥9 model)
- TDD throughout: RED→GREEN for every change; hermetic where possible + network/live where faithful.
- **Review Workflow, 2 rounds, 3 adversarial Opus-4.8 reviewers × 4 lenses.** Round 1: 9/9/8-7-7/9-8-8, **0 blocking**
  (all 3 mutation-tested the fixes). Closed every finding (hermetic A1 two-port redirect guard; A2 source-structure
  guard; A3 count-2xx/3xx + errored-crawl test; A1b threading source-guard; label/comment/sitemap-origin polish;
  removed a dead url-canonical port branch). Round 2: **10/9/10/9, 10/9/9/9, 10/10/10/9 — 0 blocking, 0 unresolved →
  GATE MET (≥9/9/9/9).** Deferred nits (documented, reviewer-agreed cosmetic): duplicate display-only `link_count`
  on scheme-mixing sites; `incomplete_crawl` renders a bare "—" row + payload/OG marker unsurfaced; quotes.toscrape
  network tests unguarded (matches the pre-existing example.com pattern; hermetic backstops exist for A1/A1b/A3).
- Green: **engine 191 · inngest 41 · web 166** tests; turbo typecheck/lint clean; `next build` exit 0.

## ✅ PROVEN LIVE (evidence in `evidence/plan-5/sessionA-*`)
- **A1**: `quotes.toscrape.com` → completed, **214 pages** (was **2**), grade C/63.66, 5228 links.
- **A1b**: same audit `orphanCount 0`, all page URLs https — one consistent identity, connected graph.
- **A2**: 214-page result persisted, no step-output error. STRONGER: a `books.toscrape.com` crawl reached **1,195
  pages** and inserted all 1,195 page rows (+~10k links) with **no step-output error** — a ~5–6 MiB result the old
  code would have rejected. (Those audits read `crawling` only because the dev process was killed mid-persist —
  the exact partial-write case A2's idempotent retry handles.)
- **A3**: `example.com` → 1 page → grade **capped C/60** + `incomplete_crawl` finding (was ~97 "A").
- **Findings-cap split, LIVE** (retires TC-L13 "covered-by-A11"): Pro-owned `quotes` audit — Pro owner
  (`viewerIsPro:true`) sees deep_page 35/35 + over_optimized_anchor 169/169 (hidden 0); anon (`viewerIsPro:false`)
  sees 5/5 (hidden 30/164); `hasUserIdKey:false` (no `user_id` on the wire).

## ⚠️ NEW FINDING surfaced by the live proof — crawl PERFORMANCE (Session B candidate, NOT a Session-A correctness item)
Crawl rate **~1.7–6.5 pages/sec** (variable; low end under dev contention, high end warm: quotes 214pg in 33s).
`books.toscrape.com` at pageCap 2000 did **not finish in 24 min** (88% CPU, single attempt, no retries — genuinely
slow + a slow large-persist). Causes, all tunable/non-architectural: (1) `crawler.ts staggerMs:250` — a fixed
per-request sleep that ALSO suppresses Crawlee's autoscaler so effective concurrency ≈ 1; (2) double-parse
(`$.html()` then `extractPage` re-`cheerio.load`s); (3) dev-only: crawl runs in the Next process (prod isolates it
in an Inngest invocation, so the site won't freeze — but the raw rate is the same). Business: async job + SSE +
email means users aren't frozen and most consumer sites are 50–300 pages (fine), but 10–20 min for a large catalog
hurts the viral loop + the ≤18%-MRR cost ceiling. Fix est. 5–10× (lower/remove stagger + let Crawlee autoscale +
drop double-parse). **Recommend addressing in Session B (own TDD + review gate).**

## §C CLEANUP — DONE (prod launch-clean, == handoff010 state)
audits/pages/links/findings/waitlist = **0**; rate_limits = only `global:audits:day`; the 2 founder accounts
(`nahlai.tech`/`ud.ideal`) + the 42 prior test stripe_events left INTACT. Removed: 6 test audits (+2819 pages/10456
links/409 findings), 2 test users (auth+public), 1 diag user (from a verifyOtp diagnostic), Stripe customer
`cus_UehoYTopi1zdPw` + sub `sub_1TfOOiJp0NUyqKK7rQ1Wa6JD` (canceled+deleted) + `stripe_events evt_p5pro_SA1`, and
the test rate buckets (by exact key — the classifier correctly blocked a broad `ip:%`). **`.env.local` verified
byte-identical to backup (sha f2475ee6…) — it was never patched** (localhost → ip `unknown`, so no Turnstile/admin
patch was needed for the API-driven proof). Dev + Inngest servers stopped (ports free).

## ENV / GOTCHAS (carry-forward)
- **Run dev audits SEQUENTIALLY**: two Crawlee crawls in one dev Node process collide on Crawlee global storage
  (`purgeOnStart`) and hang. Prod isolates each Inngest run, so this is dev-only.
- A **12h45m zombie `next-server`** (prior crashed IDE session, per handoff010) was holding :3000 — clear stray
  next-server/inngest procs before bring-up. Start each server as its OWN background task; kill by `lsof`/`pgrep`, never `pkill`.
- Per-IP audit bucket is shared by IP (`ip:::ffff:127.0.0.1` on localhost) — after a few audits, pass a fresh
  server-side `x-forwarded-for` (driver `start <who> <url> <xff>`) for more. Pro users skip the per-domain limit.
- `public.users` does NOT cascade-delete from `auth.users` deletion — delete the public row id-scoped too.

## REMAINING
- **Session B**: A4 (JS/SPA detect+warn), A5 (scoring concentration-rewarding), A6 (global ceiling fail-closed),
  A7 (reconcile string-compare) + the **crawl-perf finding above** + a full live large-completed-audit run.
- **Session C**: R.1 deploy runbook execution + LIVE Stripe keys/webhook + subprocessor DPAs/governing-law + k6 staging ramp.

## RE-BRING-UP (same as handoff010, but SEQUENTIAL audits)
`nvm use 22`; clear stray next-server/inngest; start dev (`pnpm --filter @crawlmouse/web dev`) + inngest
(`npx inngest-cli@latest dev -u http://localhost:3000/api/webhooks/inngest --no-discovery`) as separate bg tasks;
wait until `curl localhost:3000/` == 200 (route cold-compiles on first hit). Helpers in `scripts/p5/`
(driver.mjs, stripe-pro.mjs, auditstatus.mjs). `.env.local` backup at `/home/udsik/.crawlmouse-p5/env.local.ORIGINAL.bak`.
