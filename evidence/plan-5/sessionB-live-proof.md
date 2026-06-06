# Session B — live proof (A4/A5/A6/A7 + crawl perf)

Date: 2026-06-06. Commit under test: `fc452c8` (pushed to main). Dev + Inngest dev running locally;
crawls run in the Next dev process (prod isolates each in an Inngest invocation). All DB asserts via
read-only Supabase MCP against `crawlmouse-prod` (`ezspnfeyzwsisymytssm`). Sequential audits only
(one Crawlee crawl per dev process). `.env.local` byte-identical to backup throughout (sha `f2475ee6…`).

## Pipeline + A3 (coverage cap) — LIVE
- `https://example.com` (anon) → **completed**, grade **C / 60.00**, page_count **1**, finding
  **incomplete_crawl:1**. The A3 ceiling caps a 1-page crawl at C/60 with an honest finding, and the
  detector did NOT mis-fire `js_rendered` (example.com is static with content). Audit id `23d1d9c8`.

## A5 (structure score — concentration-rewarding) — LIVE + SANE
The old `structureScore = 1 - pageRankGini` rewarded a flat/fragmented graph; the new
`0.6*hubConcentration + 0.4*hubReachability` rewards concentrated, reachable authority. Live grades:
- `quotes.toscrape.com` (214 pg) → **B / 76.09** (was C/63.66 in handoff011 under the old metric).
  Well-structured demo (tag/author/pagination hubs) → a sane B.
- `books.toscrape.com` (496 pg) → **A / 90.61**. Clean, well-linked category→product catalog → a sane A.
Grades are higher than under the sign-inverted metric, which is the intended correction (these are
genuinely well-structured sites). Findings unaffected by A5/A4: quotes still
`over_optimized_anchor:169, deep_page:35`; books `over_optimized_anchor:52`; no false orphans.

## HEADLINE — large site audits end-to-end to COMPLETED
- `books.toscrape.com` (anon, free pageCap 500) → **status completed, 496 pages, grade A/90.61**,
  full pipeline wall-clock **110s** (start → Inngest → crawl-and-persist → completed). Audit id `68821096`.
- This is the exact case that in handoff011 (pageCap 2000) reached 1195 pages but **did NOT finish in
  24 min** (~0.83 pg/s, crawl-bound under the old stagger). The core feature now works on a large site.

## Crawl performance — controlled A/B (direct `runAudit`, no Inngest/persist) + headline
Measured with the standalone `pnpm smoke` harness (times `runAudit` only — isolates crawl+analysis
from Inngest pickup + DB persist). Same site, same params (`perHostConcurrency:4`, `pageCap:250`),
same machine + session, `tsx` recompiles each run:

| run | quotes.toscrape (214 pg) | rate |
|-----|--------------------------|------|
| BEFORE — blocking `staggerMs` sleep re-added | **24.6s** | ~8.7 pg/s |
| AFTER  — perf fix (stagger removed)          | **9.9s**  | ~21.6 pg/s |

- **2.5× from removing the in-hook stagger alone** (it starved Crawlee's autoscaler to ~1 in-flight).
  The single-parse fix (`extractPage($)` vs `$.html()`→re-`cheerio.load`) adds further per-page CPU
  savings (proven by the `extract.test.ts` string≡root parity test; more impactful on large CPU-bound
  crawls like books than on network-latency-bound quotes).
- The full-pipeline wall-clock (45–110s for 214–496 pg) is now dominated by **persist** (thousands of
  link rows) + Inngest event pickup, NOT the crawl (which is ~10s for 214 pg). Persist throughput is a
  separate, post-launch optimization target — it is not the launch blocker the crawl rate was.
- crawler.ts restored byte-identical to `fc452c8` after the A/B (TEMP-BENCH marker removed; `git status` clean).

## A4 (JS/SPA false-orphan floor) — conservative, no false positives on real sites
- None of the three real, server-rendered sites (example.com, quotes, books) was flagged `js_rendered`
  — the detector did not suppress orphan scoring on any legitimate static/SSR site (the trust-critical
  property; the round-1 review blocker was exactly a false-positive on static pages, since fixed).
- The full audit.ts wiring (detect → `js_rendered` banner finding → suppress orphan/unreachable →
  `orphanRatio=0` → `isOrphan=false` site-wide) is proven end-to-end by the hermetic loopback-SPA
  integration test in `packages/engine/src/audit.test.ts`, plus 15 mutation-resistant unit cases in
  `js-detect.test.ts`. A live public-CSR-SPA demo was not run (major consumer sites server-render their
  nav; a deliberately CSR target is what the hermetic fixture provides).

## A6 (global cost ceiling fails CLOSED) + A7 (reconcile instant-compare)
- Verified by unit tests (mutation-resistant) + the round-2 adversarial review; no live RPC-outage was
  induced against prod. A6: only `global:audits:day` opts into `failClosed:true`; per-IP/domain stay
  fail-open. A7: `sameInstant` wired into both reconcile paths.

## Findings-cap split (security-critical direction) — LIVE
Anon stream of the Pro-eligible multi-finding quotes audit (`643ed36b`):
`viewerIsPro:false`, `hasUserIdKey:false`, groups `deep_page 5/35 (30 hidden)`,
`over_optimized_anchor 5/169 (164 hidden)`. Gated rows never leave the API for a non-Pro viewer and no
`user_id` leaks on the wire. The Pro-full (uncapped) direction was proven live in handoff011 and is
unit-tested (`groupAndCapFindings`); the cap logic is server-side and unchanged by the A4 FindingsPanel
presentation tweak.

## Test audits created (cleaned up id-scoped in §C)
`23d1d9c8` example.com · `643ed36b` quotes (cold) · `68821096` books · `399c5ce6` quotes (warm).
