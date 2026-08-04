/**
 * Scoring and finding thresholds, centralized so the product's grading contract
 * lives in one place. These literals were previously duplicated across grade.ts,
 * audit.ts and anchor.ts (e.g. the depth-3 cutoff and the 0.2 generic-anchor
 * threshold appeared in two files each), which made tuning error-prone.
 */

/** A page more than this many clicks from the homepage is considered "too deep". */
export const MAX_HEALTHY_DEPTH = 3;

/**
 * Inbound-anchor concentration (Herfindahl–Hirschman Index, 0..1) at or above
 * which a page is flagged for over-optimized / manipulative anchor text.
 */
export const ANCHOR_HHI_ALERT = 0.5;

/**
 * Site-wide fraction of generic ("click here", "read more") anchors above which
 * we both penalize the anchor-diversity score and emit a finding.
 */
export const GENERIC_ANCHOR_ALERT = 0.2;

/** Score penalty applied to anchor diversity once GENERIC_ANCHOR_ALERT is exceeded. */
export const GENERIC_ANCHOR_PENALTY = 0.2;

/** Weight of unreachable pages relative to too-deep pages within the depth score. */
export const UNREACHABLE_DEPTH_WEIGHT = 0.5;

/** Minimum inbound links before a page's anchor HHI is statistically meaningful. */
export const ANCHOR_MIN_SAMPLES = 3;

/**
 * Minimum crawled pages before the structural grade is trustworthy. Below this, a tiny
 * or broken crawl (e.g. a JS-rendered site, a failed crawl, or a 1-2 page brochure) does
 * not have enough of a link graph to certify — so we emit a `incomplete_crawl` finding and
 * cap the grade (A3). An empty/2-page crawl previously scored a confident 97-100 "A".
 */
export const MIN_COVERAGE_PAGES = 5;

/**
 * SPEC 5.1a §5.3 — fewest main-content CHARACTERS a page needs before it is gradeable.
 *
 * CHARACTERS, not bytes, although the spec named bytes. A byte threshold DISCRIMINATES BY SCRIPT: the
 * same article in Japanese costs ~3 bytes per character, so a byte gate would silently mark non-Latin
 * pages thin at a third of the content. The signal it compares against (`mainTextChars`) is a character
 * count too, and mixing units is the defect class this project has paid for repeatedly.
 *
 * CONSERVATIVE BIAS (§5.3): SPEC 05's "readable" gate is 200 chars, but that answers a different
 * question — whether an AI crawler can read the page. This answers whether there is enough of a page to
 * grade its linking, and a real contact page sits well under 200. 80 characters is roughly two
 * sentences; below that there is nothing to link to. When the signal is ambiguous, keep the page.
 */
export const MIN_GRADEABLE_TEXT_CHARS = 80;

/**
 * SPEC 5.1a §6.4 — the FIXED sampling salt. Versioned in its value, because changing it changes the
 * sample on every site and is therefore grade-changing by definition. Never derive it from anything
 * run-specific; the whole mechanism is that the key is a property of the URL, not of the run.
 */
export const FRONTIER_SAMPLING_SALT = 'cm-frontier-v1';

/**
 * §6.3 — the largest share of the crawl budget any ONE template may take. Bounds the E1 failure
 * structurally: no single index page's children can decide the grade.
 */
export const FRONTIER_MAX_TEMPLATE_SHARE = 0.25;

/**
 * Fewest strata before the share cap applies. Without this guard a single-template site — every page
 * under `/p/{slug}` — would cap ITSELF at a quarter of the budget and crawl far less than it is
 * entitled to. That is a worse failure than the one the cap prevents, and it would look exactly like
 * the incomplete-crawl problem this spec exists to fix.
 */
export const FRONTIER_MIN_STRATA_FOR_CAP = 4;

/**
 * §6 — how many URLs the deterministic frontier hands to the crawler in ONE round.
 *
 * WHY A BOUND EXISTS AT ALL. The frontier loop admits a batch — deleting each URL from the pool,
 * marking it visited and charging it against the page cap — and only then fetches it. A wall-clock
 * stop tears the crawler down and returns immediately, so everything still queued in that batch is
 * consumed without ever being read. Unbounded, that is the whole remaining crawl:
 * `evidence/2026-08-03-stage3b-frontier-throughput-blocker.md` measured one 136-URL round running
 * 51.9s and banking ZERO pages, and info.cern.ch falling 123 → 24 pages with `selected=161`. Bounding
 * the round bounds that loss to the round actually interrupted; earlier rounds are already banked.
 *
 * WHY IT IS A CONSTANT AND NOT DERIVED FROM OBSERVED THROUGHPUT. A throughput-derived batch would
 * adapt to a slow host, and it would make batch composition a function of response latency — so
 * timing would decide *when* the budget stops and therefore *which* URLs are eligible in the next
 * round. That is precisely the nondeterminism §6 exists to remove, reintroduced one layer down. A
 * constant keeps every round boundary a pure function of the discovered set (§6.6). Do not make this
 * adaptive.
 *
 * WHY 25. The blocker's per-round instrumentation on a genuinely slow host showed a 23-URL round
 * completing healthily in 7.2s (~3 pages/s) and the next, unbounded, round of 136 banking nothing in
 * 51.9s. 25 sits at the top of the range observed to complete, so a round stays short enough that
 * losing one is cheap, while at the 500-page cap the crawl still costs only ~20 `crawler.run()`
 * restarts (Crawlee rebuilds its autoscaled pool per run, so far smaller rounds would pay that setup
 * repeatedly for no extra safety).
 */
export const FRONTIER_BATCH_SIZE = 25;

/**
 * §6 — the longest ONE round of the deterministic frontier may run before the loop moves on.
 *
 * WHY A ROUND CLOCK EXISTS, when a batch bound already exists. The two bound different things and
 * neither can bound the other. `FRONTIER_BATCH_SIZE` bounds how many URLs a round may CONSUME; this
 * bounds how much TIME a round may SPEND. The cost of a stalled URL is per URL, not per batch — a
 * measured round of 25 dead paths ran 112.1s of a 120s budget and returned four pages, all of them
 * dead. Shrinking the batch cannot fix that: capping a round near 30s at concurrency 2 would need a
 * batch of about 2, i.e. ~250 `crawler.run()` restarts at the 500-page cap. Only a clock decouples
 * round SIZE from round TIME.
 *
 * WHY IT IS A CONSTANT, for the same reason `FRONTIER_BATCH_SIZE` is. A round budget derived from
 * observed throughput would make round boundaries a function of latency, and round boundaries decide
 * which URLs are offered to the next round. That is the §6 nondeterminism arriving one layer down.
 * Do not make this adaptive.
 *
 * WHY 30s. It is one `NAVIGATION_TIMEOUT_SECS`, so a round may absorb a single full stall and still
 * end — while a genuinely slow but healthy round measured 23 pages in 7.2s on a 1990s server, four
 * times inside it. Against the 240s production budget it guarantees at least eight rounds, so no
 * single unlucky draw of slow URLs can end a crawl.
 *
 * IT IS NOT THE CRAWL DEADLINE. A round expiry moves the loop to the next round; the crawl still ends
 * only on the global wall clock.
 */
export const FRONTIER_ROUND_BUDGET_MS = 30_000;

/**
 * Ceiling applied to the score when coverage is below MIN_COVERAGE_PAGES. A ceiling, not a
 * floor: a thin crawl that also scores badly stays bad. 60 maps to "C" — "incomplete, can't
 * be certified higher" — and the accompanying finding explains why.
 */
export const LOW_CONFIDENCE_SCORE_CAP = 60;

/** Grade dimension weights. Must sum to 100. */
export const GRADE_WEIGHTS = {
  orphanRatio: 40,
  depth: 20,
  anchorDiversity: 20,
  structure: 20,
} as const;

/**
 * Crawl-health confidence thresholds (§6). Confidence is `low` when the crawl was too blocked or
 * reached too little of the discovered site to certify a grade; `medium` when it's borderline;
 * `high` otherwise. A `low`-confidence audit must never present as a confident verdict — that is
 * the "we crawled 412/500 — confidence: high" trust signal. block_rate = blocked / attempted;
 * coverage_pct = fetched_ok / discovered (both 0..1). The comparisons are strict `>` / `<`, so the
 * exact threshold value sits in the better bucket.
 */
export const BLOCK_RATE_LOW_CONFIDENCE = 0.15;
export const BLOCK_RATE_MEDIUM_CONFIDENCE = 0.05;
export const COVERAGE_LOW_CONFIDENCE = 0.7;
export const COVERAGE_MEDIUM_CONFIDENCE = 0.9;

/**
 * §2 confidence-band half-widths (± points on the 0..100 scale), keyed by crawl-health confidence.
 * They REPLACE the blunt `LOW_CONFIDENCE_SCORE_CAP` for low-confidence-but-substantial crawls: the
 * point estimate stays the real computed score and the band communicates uncertainty instead of
 * slamming a well-structured large site to C/60 (the §2 nginx A/91→C/60 evidence). high ±2 (coverage
 * ≥0.9, block ≤0.05 — measurement noise, reads as a verdict); medium ±5 (one sub-grade band —
 * `scoreToLetter`'s letter buckets are 5 pts wide); low ±12 (coverage <0.7 or block >0.15 — the
 * unseen ≥30% could genuinely move the grade, rendered "estimate, re-crawl recommended"). Bounds are
 * clamped to [0, 100]. The <5-page thin-crawl floor (A3) is unaffected — that cap stays in grade.ts.
 */
export const CONFIDENCE_BAND_HIGH = 2;
export const CONFIDENCE_BAND_MEDIUM = 5;
export const CONFIDENCE_BAND_LOW = 12;

/**
 * §3–§5 projected-grade ledger. `FREE_FIX_COUNT` = how many complete cures are revealed free (default
 * 1; parameterized so we can A/B 1-vs-2-3 later without a rewrite — the count is a WE'RE-BETTING lever).
 * `LEDGER_LINKS_PER_FIX` = suggested inbound links per fix. `LEDGER_MAX_FIXES` bounds how many fixes are
 * SIMULATED for a per-fix marginal delta (each is a graph clone + re-grade), a backstop on huge sites.
 */
export const FREE_FIX_COUNT = 1;
export const LEDGER_LINKS_PER_FIX = 3;
export const LEDGER_MAX_FIXES = 50;

/**
 * Polite, adaptive crawl (SPEC 01 §5, ENGINE_V2). AIMD = additive-increase /
 * multiplicative-decrease concurrency. Start gentle (2), ramp by 1 after a streak of clean
 * 200s, halve on any throttle (429/5xx). The ceiling is clamped to the caller's tier
 * `perHostConcurrency` so free crawls stay sequential (cost control #5) — see crawler.ts.
 */
export const AIMD_START_CONCURRENCY = 2; // initial parallelism
export const AIMD_MIN_CONCURRENCY = 1; // pool floor + halving floor (a fragile host → serial)
export const AIMD_CEILING_CONCURRENCY = 5; // ceiling before the tier clamp
export const AIMD_SUCCESS_STEP = 5; // consecutive 200s before a +1 step up

/** Crawlee retry budget for blocked requests (SPEC 01 §5 "3–4"). */
export const MAX_REQUEST_RETRIES = 4;
/**
 * Status codes treated as `blocked` → made retryable (Crawlee `additionalHttpErrorStatusCodes`,
 * which forces these to throw so they enter the retry+backoff path). 404/410 stay `dead`
 * (non-throwing, no block-retry); 5xx and network/timeout already throw by default.
 */
export const BLOCKED_RETRY_STATUS_CODES = [403, 429, 503] as const;

/**
 * Reactive backoff base (ms) for exponential full jitter on a throttle: delay = rand(0, base·2^n).
 * This is the §5 "750ms" — applied ONLY after a host pushes back, never as a steady-state
 * per-request delay (that would re-collapse single-host throughput and blow the crawl budget;
 * a healthy crawl runs with zero added delay). Robots `crawl-delay` and `Retry-After` are honored
 * as hard minimums on top of this.
 */
export const BACKOFF_BASE_MS = 750;
/** Absolute cap on any single backoff delay, so a hostile `Retry-After: 3600` can't stall a slot. */
export const MAX_BACKOFF_MS = 30_000;
/** Never delay to within this of the wall-clock deadline — the crawl stops gracefully instead. */
export const BACKOFF_BUDGET_SLACK_MS = 2_000;

/**
 * No-budget settlement floor (ms) for the v2 polite/deterministic crawl (SPEC 01 §5). The
 * deterministic-frontier path re-invokes `crawler.run()` per BFS level; with no usable wall-clock
 * budget it would take `runWithWallClock`'s no-deadline branch (no timer), so a single stalled upstream
 * socket (an origin that accepts but never responds) could leave a per-level `run()` pending forever and
 * the whole crawl never settles (Node exit 13 offline / a hung serverless function past maxDuration).
 * `runCrawl` clamps a non-positive/missing `maxCrawlMs` UP to this floor on the v2 path so `crawlDeadline`
 * is always finite and the per-level timer always arms. Mirrors `MIN_CRAWL_WALL_CLOCK_MS` (audit-config).
 * Prod always passes `crawlWallClockMs()` (≥30s) explicitly, so this is a safety net for tests / future
 * no-budget callers (e.g. the v1.2 CLI), never the prod path; a positive caller budget — even sub-floor —
 * is honored unchanged.
 */
export const V2_NO_BUDGET_FLOOR_MS = 30_000;

/**
 * Per-request navigation (fetch) timeout (secs), pinned EXPLICITLY to crawlee 3.16's own default so a
 * single stalled upstream socket is aborted instead of stalling a crawl level. Set symmetrically on the
 * v1 and v2 crawler configs. 30s is the value crawlee already used implicitly, so pinning it changes NO
 * page on any site (grade-neutral / v1 byte-identical) — its only effect is making the bound explicit so
 * a crawlee minor bump can't silently change it (PROJECT_OVERVIEW §11: crawlee is caret-pinned). 30s is
 * well above a normal page response and the ~10s per-page handler budget, so it clips only genuine
 * stalls, never a slow-but-completing page.
 */
export const NAVIGATION_TIMEOUT_SECS = 30;
