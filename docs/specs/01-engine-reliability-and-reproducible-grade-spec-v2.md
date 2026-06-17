# SPEC 01 v2 — Engine Reliability & Reproducible Grade (Phase 1)

> **Supersedes SPEC 01 v1.** This version closes six gaps found in a stress-test of v1: (1) the naive "±2 across caps"
> claim, (2) unsafe deletion of a finding category, (3) no validation against real prior audits, (4) crawl politeness
> vs. the 300s durable-job limit, (5) underspecified URL/canonical/internal-scope rules, (6) no non-regression contract.
> Status: Phase 1, blocks everything, **conversion prerequisite #1** (SPEC 00 D1). A free result that can't be trusted
> converts at zero.
>
> **Implementer note:** verify exact file paths/function/table names against the live repo before editing. Engine:
> `packages/engine/src/` (`crawler.ts`, `analysis/*`, `grade.ts`); orchestration in `inngest/` + `apps/web`; data in
> Supabase `audits`/`pages`/`links`/`findings`/`public_reports`. Do not assume signatures — confirm in-code.

---

## 0. The bug we are killing (reproduce first)

On `en.books4.you` (WordPress), ~33% of fetches were blocked/throttled and recorded as **HTTP status 0**, yet still
counted as **graph nodes with no outlinks**. That broke BFS reachability and manufactured **false critical
`unreachable_page` findings on live HTTP-200 pages**. The cap compounded it: Free (500) flagged **403** "unreachable",
Pro (2000) flagged **71** — same site, same day; Free **C/64.86**, Pro **B-/70.07**. The grade was a function of
`(page cap, how blocked the crawl got)`, not a property of the site.

---

## 1. Fetch-outcome taxonomy & node eligibility

Assign every fetched URL exactly one outcome. **Only `ok` pages become gradeable nodes.**

| Outcome | Condition | Treatment |
|---|---|---|
| `ok` | HTTP 200 + HTML content-type | **Eligible node.** Parse, extract links. |
| `redirect` | 3xx | Follow chain (§2). Source is not a node; the final 200 target is. |
| `dead` | 4xx/5xx, non-blocking (404/410/500…) | **Not a node.** Recorded only as a link-target status (for future broken-link findings). |
| `blocked` | 403, 429, 503, status 0, conn reset, timeout | **Retry w/ backoff (§5).** Still failing → **not a node**; recorded in crawl-health. **Never** a node with empty outlinks. |

**Hard rule:** `blocked`/`dead` are *crawl outcomes*, not pages. They never enter the set used for reachability, depth,
orphan, PageRank, or grade. This rule alone eliminates the §0 bug.

## 2. URL identity, canonicalization & internal scope (was underspecified)

Node identity is load-bearing for the grade, so it is fully defined and deterministic.

**Canonical URL key** (applied before dedup/graphing):
1. Lowercase scheme + host; strip default ports (`:80`/`:443`); drop fragment (`#…`).
2. Resolve `.`/`..`; collapse duplicate slashes.
3. **Trailing slash:** normalize to no trailing slash except root `/`. If the site's own 301/`rel=canonical` disagrees,
   the site's canonical wins (see below).
4. **Query params:** strip a configurable tracking allowlist (`utm_*`, `gclid`, `fbclid`, `mc_*`, `ref`, …); keep all
   other params; sort remaining params for a stable key.
5. **`rel=canonical`:** a page that canonicalizes to a *different* URL is **not** a separate node — consolidate to the
   canonical target (Screaming Frog "not canonicalised away"). Self-canonical = keep.
6. **Redirect chains:** follow ≤ **5** hops; the final 200 is the node; record the chain. Loops or >5 hops → excluded +
   flagged.

**Internal scope:** "internal" = same **canonical host** as the homepage. Unify `www` vs non-`www` by following the
homepage's own redirect/canonical (whichever the site resolves to is canonical). **Subdomains are external by default**
(config flag to include). External links are recorded but are never nodes.

**`nofollow` links:** the target is still *discovered* (edge exists for reachability/discovery) but the edge carries
**zero PageRank weight**. **`noindex` pages:** eligible nodes (they exist and receive links), but an orphan finding on a
`noindex` page is **informational**, not critical (the owner may intend it unlinked).

## 3. Reachability, orphans, depth — corrected & deterministic

- **Seed reachability from ALL successfully-fetched entry points** (homepage + every `ok` sitemap URL + discovered
  links), not homepage-only BFS.
- **Orphan** = an `ok` (200) internal page with **zero internal inbound links** across the full graph. (A 200 page known
  only from the sitemap with no inbound internal link is a *true* orphan — a legitimate finding.)
- **`unreachable_page` is RETIRED** (see §7 for safe migration). Do not emit it. The only legitimate case (200 node, no
  inbound internal links) is already `orphan`. Never emit a finding for null BFS depth caused by a blocked intermediate.
- **Depth** = min clicks from homepage over the **eligible (200) graph only**. A 200 page reachable only via sitemap
  (no link path) is an **orphan**, not a "deep page." Deep-page fires only on a real link path at depth > 3 (severity
  escalates at ≥ 4; tolerance scales for large sites).
- **Deterministic frontier ordering (critical for reproducibility under truncation):** the crawl frontier expands in
  strict `(depth ASC, canonicalUrl ASC)` order. When the page cap truncates a larger site, the **same cap always selects
  the same subset** — making a given cap reproducible run-to-run even when the whole site isn't seen.

> **Implementer clarification (Phase 1 build, ENGINE_V2):** the multi-seed rule in the first bullet governs
> **reachability / orphan determination** (a page is an orphan iff it has zero inbound internal links — an inherently
> multi-source, BFS-free graph property), **not depth**. **Depth stays homepage-rooted** ("min clicks from homepage",
> fourth bullet): seeding the depth BFS from all entry points would zero out click-depth and make the metric
> meaningless. Accordingly the v2 code leaves `computeDepth` homepage-seeded and detects orphans by inbound-link count;
> `analysis/depth.ts` needed no change. The `(depth ASC, canonicalUrl ASC)` ordering applies to the **crawl** (which
> pages survive page-cap truncation): v2 implements deterministic **seed** truncation (sitemap seeds sorted before the
> cap slice); the **link-discovered** crawl frontier is a separate, higher-risk crawler change tracked with **T4**.

## 4. Reproducibility — defined precisely (was an unprovable "±2")

v1 claimed "same site → same grade ±2 across caps." That's false for sites larger than the cap: 500 vs 2000 score
*different samples of the site*. v2 replaces one naive claim with three precise, testable ones.

**R1 — Determinism (same settings, clean crawl):** identical site + identical cap + identical settings, on a crawl with
`block_rate < 0.05`, yields an **identical grade (±1)** run-to-run. On a deterministic local fixture server →
**exactly equal**. Mechanisms: deterministic frontier ordering (§3), deterministic PageRank (§4.1), stable URL keys (§2),
and exclusion of nondeterministic blocked fetches (§1).

**R2 — Cap-independence, coverage-gated:** when the site **fits within the smaller cap** (coverage ≥ 0.9 at cap 500),
grade@500 and grade@2000 are within **±2**. We do **not** claim cap-independence when the site exceeds the cap — that's
sampling, not a bug.

**R3 — Sampled-estimate honesty:** when coverage < 0.9 (site bigger than cap), the grade is a **sampled estimate**
carrying a **confidence band** derived from coverage (§6), and the UI communicates "estimate based on N of ~M pages."
The point estimate is still deterministic per R1.

### 4.1 Grade computation
- Components & weights unchanged unless review justifies: **Orphans 40 / Depth 20 / Anchor 20 / Structure 20**; A–F + 0–100.
- **All components are RATIOS over eligible (200) nodes**, never raw counts (orphan rate, % at depth ≤ 3, descriptive-
  anchor ratio, PageRank concentration/reachability).
- **PageRank:** directed eligible-node graph; **damping 0.85**; iterate until **L1 delta < 1e-6 or 30 iterations**
  (whichever first) — deterministic; unique edges (A→B once); self-links ignored; `nofollow` = zero weight; normalize
  0–100 logarithmically.
- **Coverage/confidence floor (kept, re-triggered):** cap the score on **low confidence** (block_rate / coverage), not
  only on raw page count.

## 5. Polite, robust crawler — reconciled with the 300s durable-job limit (was a latent prod failure)

Flat "1 req/s + low concurrency" would make 500 pages take ~500s and **blow the Inngest/Vercel `maxDuration=300s`** the
crawl+persist step runs under (`PROJECT_OVERVIEW.md` §7). v2 uses a **time budget + adaptive concurrency** instead.

- **Crawl time budget:** **240s** soft cap (config), leaving ≥60s headroom under 300s for persist + grade. On budget
  exhaustion, **stop gracefully**, mark the crawl partial, and set `coverage_pct`/`confidence` accordingly (partial is a
  surfaced state, not an error).
- **Adaptive concurrency (AIMD):** start `maxConcurrency = 2`, ceiling **5**. Increase by 1 after M consecutive successes
  if median host latency < L and no 429/5xx; on any 429/5xx, **halve** and back off. Keeps fast hosts fast, fragile hosts
  safe — without a flat slow rate.
- **Same-domain delay:** base **750ms ± 250ms jitter**, adaptive (tightens on healthy hosts). **Hard floors:** robots.txt
  `crawl-delay` and `Retry-After` are honored as minimums. If a declared `crawl-delay` would blow the budget, crawl what
  fits in budget and mark low coverage (never hang).
- **Backoff:** exponential **full jitter** on 429/5xx: `delay = random(0, base * 2^attempt)`; `maxRequestRetries` 3–4;
  retire host after N consecutive failures.
- **User-Agent:** descriptive + contact URL: `Crawlmouse/1.0 (+https://crawlmouse.com/bot)`. Keep `retryOnBlocked` /
  session rotation if available. Preserve `ensureCrawleeMemoryHint()` + direct-`crawlee` dependency (§9).
- **Block vs dead:** 403/429/503/0/timeout = `blocked` (retry→exclude); 404/410 = `dead` (no block-retry). Never collapse
  a block into a "page with no links."
- **Security:** the SSRF guard / `safe-fetch` (`ssrf-guard.ts`, `safe-fetch.ts`) must remain fully in force — politeness
  changes must not introduce any new unguarded fetch path. (§9 non-regression.)

## 6. Crawl-health & confidence (trust = conversion)

- **Per audit:** `discovered`, `fetched_ok`, `blocked`, `dead`, `coverage_pct = fetched_ok / discovered`,
  `block_rate = blocked / attempted`, `partial` (budget/cap hit).
- **Confidence:** `low` if `block_rate > 0.15 || coverage_pct < 0.7`; `medium` if `> 0.05 || < 0.9`; else `high`. Constants
  in `constants.ts`.
- **Confidence band for the score** (feeds R3): map confidence → a ± band shown in UI (high ≈ ±2, medium ≈ ±5, low ≈
  "estimate, re-crawl recommended").
- **Findings guard:** on `low` confidence, suppress/caveat structural findings + grade. Never present a confident grade
  on a poorly-reached crawl. This produces the "we crawled 412/500 — confidence: high" professionalism.

## 7. Data model, migration & backward-compatibility (was a one-line hazard)

**Additive, non-breaking migrations:**
- `pages`: add `fetch_outcome` enum (`ok|redirect|dead|blocked`), `excluded_from_grade boolean default false`. Only `ok`
  is gradeable. (Or a sibling `crawl_health` table — pick the lower-risk migration.)
- `audits`: add `discovered_count`, `blocked_count`, `coverage_pct`, `block_rate`, `confidence`, `partial`. Nullable +
  backfilled defaults.

**Retiring `unreachable_page` safely (do NOT just delete):**
- **Stop emitting** it for new audits; true cases become `orphan`.
- **Keep the enum value** readable for historical rows — do **not** drop it.
- **Do NOT mutate `public_reports`** (denormalized, frozen at mint) or any minted/cached `/r/` artifact — rewriting a
  shared, possibly-linked artifact silently is a trust event. Old reports stay as the snapshot they were; new audits/mints
  use corrected logic. Offer "re-audit to refresh," never an in-place rewrite.
- **Rendering backward-compat:** the report renderer, OG card, embed badge, and CSV export must **not crash** on the
  deprecated category — map it to the orphan display or hide it. Add a fallback + a test.
- **CSV/export stability:** keep column headers stable; document the change in a `CHANGELOG`/migration note in case
  downstream users scripted against exports.

## 8. Rollout & validation against REAL prior audits (was missing)

Fixtures prove correctness; they don't catch silent grade swings on real sites. Add a backtest gate.

- **Backtest harness (reusable, keep it):** a script (`scripts/backtest-engine.ts`) that pulls the last **N=30–50**
  completed real audits from Supabase, re-runs the new engine, and emits a **diff report** (old vs new grade, score, and
  per-category finding counts) as markdown/CSV.
- **Expected & required:** block-affected sites (false-unreachable-heavy) should **improve** (fewer false criticals).
  **Acceptance:** every grade delta is either ≤ an explainable threshold or has a one-line root cause ("removed K false
  unreachables"). **Any unexplained large swing blocks the cutover** and gets human sign-off.
- **Reuse for benchmarks:** fold in the 10 reference benchmark audits (the paused Stage-7 item in `PROJECT_OVERVIEW.md`
  §12) as part of the corpus — one effort, two outcomes.
- **Safe cutover:** ship behind a flag (`ENGINE_V2`) for instant rollback. Optional shadow-run (compute v2 alongside v1
  for a short window, log deltas to PostHog) before flipping the default. Given current low traffic, backtest-then-flip
  with a rollback flag is acceptable.

## 9. Non-regression contract (behaviors that MUST NOT change without explicit sign-off)

Claude Code must preserve these; "fixing" them is a regression:
1. **SSRF guard / `safe-fetch`** — security, load-bearing. No weakening.
2. **RLS deny-by-default + capability-URL admin reads**; anon-audit + claim-on-signup flow.
3. **JS/SPA detector + its orphan suppression** (it becomes the AI-readiness signal in SPEC 05 — keep it).
4. **Coverage floor concept** (re-trigger on block-rate; don't remove).
5. **Four-component weights & the A–F / 0–100 scale** (no silent re-weighting).
6. **Minted public-report immutability** (don't mutate snapshots).
7. **Crawlee memory hint + direct-`crawlee`-dependency workarounds** (`PROJECT_OVERVIEW.md` §11).
8. **Turnstile + per-IP/domain/global rate limits**; the `global:audits:day` fail-closed behavior.

## 10. Observability
- Emit per-audit crawl-health to **PostHog** (confidence distribution, block_rate, partial-rate).
- **Sentry** breadcrumbs for `blocked`/`dead` outcomes and budget-exhaustion; keep the `signal:audit-failed` path.
- Structured logs of fetch outcomes (sampled). The §8 backtest diff is an artifact for sign-off.

## 11. Acceptance criteria / test matrix (Phase-1 exit gate)

| # | Test | Pass condition | Closes |
|---|---|---|---|
| T1 | Blocked-fetch fixture (some 200, some 403/429/0) | No orphan/"unreachable" finding on any internally-linked 200 URL; blocked fetches are not nodes | §0 bug |
| T2 | Determinism, deterministic fixture server, same cap, 2 runs | Grades **exactly equal**; clean-crawl real site ±1 | R1 |
| T3 | Cap-independence, site that fits, cap 500 vs 2000 | Grade within **±2**; coverage ≥ 0.9 both | R2 |
| T4 | Large site, cap 500 vs 2000 | Each cap deterministic run-to-run; confidence band reflects coverage; **no ±2 claim asserted** | R3 |
| T5 | URL identity | trailing-slash / tracking-param / `rel=canonical` variants collapse to one node; www/non-www unified | §2 |
| T6 | Politeness vs budget | Honors `Retry-After`/`crawl-delay`; a 600-page slow host stops at 240s budget, marks partial, never exceeds 300s | §5 |
| T7 | Adaptive concurrency | Ramps on healthy host, halves on injected 429; block rate drops vs current build | §5 |
| T8 | Migration & compat | New columns backfill; report renderer/OG/CSV don't crash on deprecated category; minted reports unchanged | §7 |
| T9 | Backtest gate | Diff report generated over ≥30 real audits; every large delta explained; no unexplained swing | §8 |
| T10 | Non-regression | All listed §9 behaviors intact; full existing test suite green | §9 |
| T11 | Live smoke (deployed Vercel) | Passes on a normal static site, a throttling WP site, and a JS/SPA site | DoD |

## 12. Out of scope for Phase 1
Prescriptive fixes (SPEC 02), conversion UX/payment (SPEC 03), live graph + share card (SPEC 04), AI-readiness (SPEC 05),
monitoring (SPEC 06), and any JS rendering or LLM usage (SPEC 00 D2/D3).

---

## 13. Self-assessment (vs. the six stress-test gaps)

| Dimension | v1 | v2 | What changed |
|---|---|---|---|
| Correctness of core fix | 8 | **9.5** | Node-eligibility rule + retired `unreachable_page` + true-orphan definition, fully test-pinned (T1) |
| Reproducibility rigor | 5 | **9** | Replaced naive "±2" with R1 determinism + R2 coverage-gated cap-independence + R3 confidence band; deterministic frontier + PageRank (T2–T4) |
| Migration / backward-compat | 4 | **9** | Additive migrations, enum kept, minted reports immutable, renderer/CSV fallbacks (T8) |
| Rollout / real-world validation | 3 | **9** | Reusable backtest harness over real audits + flag/shadow cutover (T9) |
| Crawl politeness vs infra limits | 5 | **9** | Time budget + adaptive AIMD concurrency reconciled with 300s `maxDuration` (T6–T7) |
| Edge/identity specification | 4 | **9** | Full canonical/redirect/param/internal/noindex/nofollow rules (T5) |
| Non-regression / safety | 6 | **9.5** | Explicit MUST-NOT-CHANGE contract incl. SSRF, RLS, minted reports (T10) |

Every dimension now ≥ 9 with a concrete acceptance test behind it.
