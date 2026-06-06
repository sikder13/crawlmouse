# Crawlmouse v1.0 — Launch-Readiness Assessment & Finalized Plan

> Decision-maker's pre-launch judgment, after: (1) Plan-5 Phase-7 guided-live verification (9/9/9/9, handoff010),
> (2) an external technical/product review, and (3) three parallel Opus research efforts — an internal code+algorithm
> audit (which root-caused the crawler bug live), competitor/product research (Screaming Frog, Ahrefs, Sitebulb,
> Semrush, Botify, Lumar), and a technical-solutions deep-dive (Crawlee/Inngest/Playwright/scoring). Dated 2026-06-06.

## VERDICT: 🟡 NOT READY — but the blockers are now root-caused, mostly small, and clearly sequenced.
The security/billing/auth/abuse layers are verified-live and solid. The **core audit correctness** has specific,
now-understood defects (a one-line crawler bug, a persistence-size bug, a coverage-floor gap, and a wrong-signed
scoring metric) — none are deep rewrites. Fix them, prove a real multi-page audit end-to-end, then do the
deploy/legal cutover. Estimate: ~2 focused build sessions + 1 deploy session.

---

## A. LAUNCH BLOCKERS — root-caused, with exact fixes (do before launch)

### A1 — Crawler drops almost all links on scheme-downgrading sites  🔴 CRITICAL (ROOT-CAUSED, ~1-line)
**Root cause (confirmed by live trace, not theory):** `packages/engine/src/crawler.ts:152` enqueues with
`strategy: 'same-origin'`. Crawlee re-checks that strategy **after navigation**, comparing **protocol + hostname**
(`baseUrl.origin === loadedBaseUrl.origin`). Many normal sites 308/301-redirect deep paths to a **different scheme**
(e.g. quotes.toscrape: `https://…/author/X` → `http://…/author/X/`), so `https ≠ http` → the request is SKIPPED
(`reason=redirect`). gnu.org keeps https on every page → crawls 500 fine. This is why most real sites crawled to 1–2
pages in Plan-5.
**Fix:** change `strategy: 'same-origin'` → **`'same-hostname'`** (hostname-only, scheme-agnostic). Our own code
already pre-filters to same-origin (`crawler.ts:147-151`) and SSRF-revalidates every redirect hop, so loosening
Crawlee's redundant strategy is safe. **Verified:** with the fix, quotes.toscrape went **2 → 43 pages**, links 55 →
1132. (Alt per the technical agent: `strategy:'all'` + keep our `startsWith(origin)` filter computed against
`request.loadedUrl`; equivalent. Crawlee 3.16.)

### A1b — `canonicalizeUrl` never normalizes scheme → double-counted pages  🔴 CRITICAL (fix WITH A1)
After A1, a crawl will mix `http://` and `https://` versions of the same page. `url-canonical.ts` lowercases host,
strips trailing slash, sorts query — **but not scheme** → `hashUrl` differs for http vs https → the same page is
counted twice and the in-degree graph splits, corrupting orphan/PageRank/depth.
**Fix:** pin the scheme in `canonicalizeUrl` (force to the homepage's scheme, or always https), OR seed the crawl
from the homepage redirect's `finalUrl` (`audit.ts:36`'s `safeFetch` already follows the downgrade) so one scheme
is used throughout. `packages/engine/src/url-canonical.ts:5-34`.

### A2 — Large-site audits exceed the Inngest step-output limit  🔴 CRITICAL (ROOT-CAUSED)
`inngest/audit.ts:35` returns the **entire** crawl result from `step.run('run-engine')` and passes it to
`step.run('persist-results')` (`:52`). Inngest caps step output (docs cite **1–4 MB**; confirm exact) and run-state
at 32 MB. Measured: 47 pages = 212 KiB → a 500-page free crawl ≈ **2.4–6 MiB**, a 2000-page Pro crawl ≈ 9–24 MiB →
the step output is rejected → audit ends `failed`. So the product silently fails on exactly the large, well-linked
sites it should grade.
**Fix (Inngest's own guidance):** collapse into ONE `step.run('crawl-and-persist')` that runs `runAudit` +
`persistAuditResults` and returns only `{auditId, grade, score, pages}` — the big object never crosses a step
boundary. (Persistence is already idempotent, so the lost crawl/persist retry-split is low-cost.) `inngest/audit.ts:35-52`.

### A3 — A truncated/empty crawl reports a confident high grade  🔴 CRITICAL (MISLEADING OUTPUT)
Verified with a pure-function harness: a 2-page crawl → **97 "A"**, an empty graph (0 pages) → **100 "A"**, a single
page → **100 "A"**. There is no coverage floor — every grade term clamps to 1 with no data. Combined with A1 this
means users on broken crawls got perfect grades.
**Fix:** add a minimum-coverage guard — if `pages.length < N` (e.g. 5) or the crawl errored, emit a
`low_confidence`/`incomplete_crawl` finding and withhold or cap the letter grade. `audit.ts` / `grade.ts`.

### A4 — JS-rendered (SPA) sites → false "orphan" reports  🔴 CRITICAL for trust (CONFIRMED + market-standard fix)
The engine is `CheerioCrawler` = raw static HTML, **no JS execution**. Pure client-side-rendered sites
(custom React/Vue/Next-CSR, parts of Shopify/Wix/Squarespace) return few/no links → real pages reported as
"orphans" — a trust-killer on exactly the consumer sites likely to go viral. (Mitigation: Shopify/Wix/Squarespace
server-render their primary nav + product/collection links, so many such sites still produce good graphs.)
**Market-standard fix (Screaming Frog/Sitebulb/Semrush/Ahrefs all do this):** rendering is **on-demand, not
default**, detected by a **two-pass diff**. For Crawlmouse:
- **v1.0 FLOOR (non-negotiable):** cheap `looksJsRendered()` detection (empty SPA root `#root/#app/#__next`,
  low text/HTML ratio, content-bearing page with <3 links, `noscript` "enable JavaScript"). If it trips and we
  crawled raw → **show a banner, never emit an orphan score** ("This site renders links with JavaScript — Deep Crawl
  coming"). Turns a limitation into an honest message + a Pro upsell. **This single rule defuses the reputational risk.**
- **v1.0-stretch / v1.1:** bounded two-pass Cheerio→Playwright render fallback (Agent-3 pattern) or Crawlee
  `AdaptivePlaywrightCrawler` (`renderingTypeDetectionRatio:0.1` + `resultChecker`); cap headless budget per audit +
  gate by tier to hold the ≤18%-MRR ceiling. (`AdaptivePlaywrightCrawler` is experimental in 3.16 → the explicit
  two-pass is the lower-risk launch option.)

### A5 — Scoring rewards an EVEN link-equity spread (wrong-signed)  🟠 MAJOR (CREDIBILITY) — friend was right
`grade.ts:35` `structureScore = clamp(1 - pageRankGini)`, weight **20/100**, penalizes concentrated PageRank.
Confirmed wrong from three angles: (1) harness — a textbook siloed site (50 pages → 1 money page) is penalized 9 pts,
while a maximally-fragmented graph (home + 10 isolated orphans) gets a **perfect** structure score; (2) competitors —
Screaming Frog's "Link Score" IS internal PageRank (damping 0.85) that **rewards concentration**; Semrush flags
under-linked AND >100-outlink pages; (3) authorities — Google/Mueller + Ahrefs/Moz all teach concentrating authority
on important pages (siloing/topic-clusters); a flat structure is a *weakness*.
**Fix (cheap, reuses existing PageRank/depth):** replace `1 - gini` with a concentration-rewarding blend —
`0.5*hubConcentration + 0.3*siloCohesion + 0.2*hubReachability` (hub-concentration = top-5% PageRank share in a
healthy band; silo-cohesion = path-prefix conductance, O(E), no new dep, or `graphology-communities-louvain`
modularity; hub-reachability = top-PageRank pages within depth 3, reuses `computeDepth`). Don't ship a half-baked
algorithm under launch pressure — the cheapest safe step is hub-concentration + hubReachability now. `grade.ts:35`,
`analysis/pagerank.ts`.

### A6 — Global cost ceiling fails OPEN on DB error  🟠 MAJOR (COST SAFETY)
`rate-limit.ts:19` returns `{allowed:true}` on any RPC error, and `audits/start/route.ts:44` applies that to the
**global 18%-MRR daily ceiling**. A Supabase blip uncaps spend. Fail-open is fine for per-IP limits; the **global
cost backstop should fail CLOSED or degrade to a conservative cap**. `rate-limit.ts:19`, `start/route.ts:44`.

### A7 — Reconcile reports false "drift" (Finding #2 from handoff010)  🟡 MINOR
`runReconcile` compares `pro_until` as strings (`billing-helpers.ts:170`); DB `+00:00` vs computed `.000Z` →
every active subscriber looks drifted. **Fix:** compare by instant (`getTime()`).

### A8 — `getClientIp` trusts left-most `x-forwarded-for`  🟡 MINOR (Vercel-only)
`client-ip.ts:11` is correct ONLY behind Vercel (which rewrites XFF). Off-Vercel it's spoofable → free-audit abuse.
Acceptable for v1.0 *iff* the deploy is Vercel-only; document it.

**PROVE IT (the real launch gate):** after A1–A4, crawl a real ~50–300-page site end-to-end → `completed` with real
page_count + a category of >5 findings; observe the **live findings-cap split** (retiring TC-L13's covered-by-A11);
re-run TC-S1 (deep benchmarks now complete). This is the demonstration that the product delivers its core value —
which it never did during verification.

---

## B. DEPLOY / LEGAL CUTOVER (the R.1 runbook — `docs/deploy/launch-runbook.md`)
Vercel Pro + prod env + **LIVE Stripe keys + LIVE webhook**, DNS cutover, Supabase prod email templates (token_hash),
Sentry sourcemaps + 3 alert rules, PostHog prod dashboard caps, Inngest prod, Stripe business activation +
"Tech**hh**nologies" descriptor typo, co-founder access, **k6 1000-VU staging ramp (never run)**, forwarding for
`privacy@/abuse@/takedown@`, counsel sign-off + 8 subprocessor DPAs + governing-law/entity + remove DraftBanner +
subprocessor-region accuracy, residual cleanup (42 prior test stripe_events). Full ordered, gated procedure is in the
runbook (Stage 0 fronts the A-list fixes).

---

## C. POST-LAUNCH ROADMAP (validated, explicitly NOT launch blockers — reconciles the external review)

Decision rule: **fix-before-launch** = anything that produces a wrong/embarrassing result the first time a user
touches it (correctness, credibility, billing, security). **Safe-to-defer** = reversible/cheap, needs post-launch
data to decide well, or only matters over the subscription lifecycle.

- **v1.1 #1 — Continuous monitoring / delta-alerting (the churn fix).** The episodic-audit churn thesis is real and
  the most important *business* insight. But churn isn't measurable until ≥1 billing cycle, and monitoring only has
  value once audits are *accurate* (depends on A1–A4). → first post-launch epic; Inngest crons already exist. Cheap
  launch-era MVP: opt-in "monthly re-audit, email only on regression."
- **v1.1 #5 — AI-Agent-Readiness score (differentiator).** Real, under-served category, on-strategy for v1.2, and
  **all signals (robots.txt GPTBot/ClaudeBot/PerplexityBot, llms.txt presence + the "decorative llms.txt" mistake,
  JSON-LD density, training-vs-search-bot split) parse from static HTML at ~zero cost.** Ship the cheap subset
  near-launch as a shareable "🤖 AI-readiness" badge (with honest copy: llms.txt is unproven; robots.txt is the real
  control). DOM-token-efficiency + `.well-known/` → later.
- **v1.1 — Caps/pricing tuning.** KEEP the **500-page free cap** (market-standard, Screaming-Frog parity — the
  friend's "reduce to 300" is *not* supported; 500 reads as legitimate). $19/mo undercuts every credible rival.
  Adopt **"no credits, unlimited crawls"** positioning (Sitebulb's winning differentiator) if the cost model allows;
  gate on page-count/crawl + concurrency, not credits. Tune with real conversion data post-launch — it's a one-line
  config change, so wait for the data. NOTE: the 2000-page Pro cap depends on A2 being fixed first.
- **v1.1/v1.2 — Agency / usage-based tier + multi-tenant + white-label.** Real, significant schema + Stripe-metering
  build. Co-design with the v1.2 dev-tool surface (CLI/GH Action/agentic) since both need API keys + usage metering.
- **v1.1 — Peer benchmark percentiles (k-anonymity n≥25).** Cold-start *by necessity* — needs launch traffic before
  percentiles are meaningful. Designed-unbuilt; build after data exists.
- **Content / blog.** Content marketing: yes. **"Daily auto-generated posts": NO** — Google's 2024 scaled-content-
  abuse policy penalizes it, it creates the orphan/thin-content anti-pattern we sell against, and our own site must
  be exemplary (people will audit crawlmouse.com). Do **quality-cadence, data-driven** content instead ("internal-
  linking health of the top 500 Shopify stores", "AI-readiness of the web's top 1000 sites") — un-copyable, linkable,
  feeds the benchmark feature + viral loop. AI-assisted, human-edited; never fully-automated daily publish. Post-launch.
- **Full Playwright hybrid (A4 stretch)** if not shipped at launch.

---

## D. LEAVE UNTOUCHED (v1.2 readiness — answer to the review's explicit question)
Keep the **TypeScript-isolated engine boundary**, the **Inngest job/streaming model**, the **capability-URL + RLS
security model** (verified live — genuinely solid), and the **SSE result stream**. These ARE the v1.2-ready
foundation; build monitoring (#1), the agentic/AI surface (#5), and usage tiers (#2) ON TOP of the engine, not as a
refactor. The only foundation-adjacent change is the crawler, and even A4 is additive (a renderer strategy behind the
existing `runAudit` interface), not a rewrite.

---

## E. SEQUENCING TO LAUNCH
- **Session A (core crawl correctness):** A1, A1b, A2, A3, A4-floor (detect+warn) — under TDD + the 3-reviewer ≥9
  gate. Then prove a real multi-page audit persists.
- **Session B (grade + safety + live proof):** A5 (scoring), A6 (fail-closed), A7 (reconcile); then the full live
  proof (real audit + findings-cap split + re-run TC-S1); optionally A4-render-fallback + the AI-readiness cheap subset.
- **Session C (deploy):** execute the R.1 runbook collaboratively + k6 staging ramp + legal close-out.
```
```
