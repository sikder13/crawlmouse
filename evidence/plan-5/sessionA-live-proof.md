# Session A — live proof of the crawl-correctness fixes (A1/A1b/A2/A3)

Date: 2026-06-06. Stack: local `pnpm --filter @crawlmouse/web dev` (:3000) + `inngest-cli dev` (:8288),
prod Supabase (read/seed only, id-scoped). Commit under test: `385ea3f`.

All audits run through the REAL app path (`POST /api/audits/start` → Inngest `crawlmouse.audit` → engine
`runAudit` → `persistAuditResults` → SSE `/api/audits/[id]/stream`). Evidence JSON saved alongside this file.

## A1 — scheme-downgrade site now crawls deep  ✅
- `quotes.toscrape.com` (anon, audit `26de76b3-cf55-4b2c-a477-fdef2f109f75`) → **completed**, **page_count 214**,
  link_count 5228, grade C / 63.66.
- Before the fix this site stalled at **2 pages** (the same-origin post-redirect strategy skipped every
  https→http deep link). 214 pages confirms `strategy:'same-hostname'` works on the real site.

## A1b — one consistent identity (no scheme split)  ✅
- Same audit: `orphanCount 0`, `avgDepth 2.79` — a fully connected in-degree graph. A scheme split would have
  orphaned the http-downgraded pages; instead every identity is pinned to the homepage scheme (all page URLs https).

## A2 — large result persists, no Inngest step-output failure  ✅
- The 214-page result (~1 MiB) persisted cleanly; **no `"step output size is greater than the limit"`** in the
  Inngest log (the handoff010 MAJOR finding).
- STRONGER at scale: a `books.toscrape.com` crawl reached **1,195 pages** and those 1,195 page rows (+ ~10k link
  rows) were **inserted** — a ~5–6 MiB result that the OLD code would have rejected at the `run-engine`→
  `persist-results` step boundary. No step-output error occurred. (These audits read `crawling` rather than
  `completed` only because the dev process was killed mid-persist before the final status update — precisely the
  partial-write case A2's idempotent persist is designed to re-run cleanly on retry.)

## A3 — thin crawl is capped + flagged  ✅
- `example.com` (audit `8e432a1d-cfb9-429c-90e0-74a7ac004def`) → **page_count 1**, grade **C / score 60**
  (== `LOW_CONFIDENCE_SCORE_CAP`), finding **`incomplete_crawl`**. Before A3 a 1-page crawl scored ~97 "A".

## Findings-cap split, LIVE  ✅  (retires TC-L13 "covered-by-A11")
Pro-owned audit `48471c9b-c172-44fe-81dd-45131c654415` (`quotes.toscrape.com`), same audit viewed two ways:

| Category | Total | Pro owner (`viewerIsPro:true`) | Anon/free (`viewerIsPro:false`) |
| --- | --- | --- | --- |
| deep_page | 35 | shown 35 / hidden 0 | shown 5 / hidden 30 |
| over_optimized_anchor | 169 | shown 169 / hidden 0 | shown 5 / hidden 164 |

`hasUserIdKey:false` on both payloads — `user_id` never crosses the wire (the done payload keys are
id/status/grade/score/page_count/link_count/cms_detected/settings/findingGroups/viewerIsPro/orphanCount/avgDepth).
This is the first time the per-viewer cap was demonstrated on a LIVE audit rather than only by the deterministic A11 backstop.

## ⚠ NEW finding surfaced by the live proof — crawl PERFORMANCE (not a Session-A correctness blocker)
- Observed crawl rate **~1.7–6.5 pages/sec** (variable; the low end was under dev-process contention, the high end
  on a warm clean stack: quotes 214 pages in 33s). `books.toscrape.com` at pageCap 2000 did **not finish in 24 min**
  (process pegged ~88% CPU, single `audit.requested`, no retries/timeouts — genuinely slow, not stuck).
- Likely causes, all tunable / non-architectural:
  1. `crawler.ts` `staggerMs: 250` — a fixed `sleep` before every request that also suppresses Crawlee's
     autoscaler, so effective concurrency stays ~1 instead of the configured `perHostConcurrency`.
  2. Double-parse: `crawler.ts` does `$.html()` then `extractPage()` re-runs `cheerio.load()` on the same HTML.
  3. (dev-only amplifier) the crawl runs inside the Next dev process, starving the web server; in prod the crawl
     runs in an isolated Inngest invocation, so it won't freeze the site — but the raw rate is the same.
- Business impact: async job + SSE + email means users aren't frozen, and most consumer sites are 50–300 pages
  (fine), but 10–20 min for a large catalog hurts the viral share-loop and the ≤18%-MRR cost ceiling. Fix is cheap
  (lower/remove the stagger + let Crawlee autoscale + drop the double-parse → est. 5–10×). → **recommend Session B.**

## Environment notes
- Two Crawlee crawls in ONE dev Node process collide on Crawlee's global storage (`purgeOnStart`) → run audits
  sequentially in dev. Production isolates each Inngest run, so this is dev-only.
- A 12h45m-old zombie `next-server` from a prior crashed IDE session (per handoff010) was holding :3000; cleared.
- The per-IP daily audit bucket is shared across users by IP; after several audits a fresh `x-forwarded-for`
  (server-side driver, no CORS) is needed for more anon audits.
