import { CheerioCrawler, Configuration, log, LogLevel, type CheerioCrawlerOptions } from 'crawlee';
import { validateUrlOrThrow, createSafeLookup } from './ssrf-guard.js';
import { canonicalizeUrl, hashUrl } from './url-canonical.js';
import { extractPage } from './extract.js';
import { isAllowedByRobots, getCrawlDelay, type ParsedRobots } from './robots.js';
import {
  parseRetryAfter,
  fullJitterBackoffMs,
  capDelayMs,
  isThrottleStatus,
  politeAutoscaledPoolOptions,
  AimdController,
  type ConcurrencyPool,
  type AimdTelemetry,
} from './crawl-politeness.js';
import {
  AIMD_START_CONCURRENCY,
  AIMD_MIN_CONCURRENCY,
  AIMD_CEILING_CONCURRENCY,
  AIMD_SUCCESS_STEP,
  MAX_REQUEST_RETRIES,
  BLOCKED_RETRY_STATUS_CODES,
  BACKOFF_BASE_MS,
  BACKOFF_BUDGET_SLACK_MS,
} from './constants.js';

log.setLevel(LogLevel.OFF);

export interface CrawlInput {
  startUrls: string[];
  pageCap: number;
  perHostConcurrency: number;
  /**
   * Legacy politeness knob. It NO LONGER gates per-request timing: the old in-hook
   * `setTimeout(staggerMs)` blocked the navigation hook and pinned effective
   * concurrency to ~1 (suppressing Crawlee's autoscaler). Politeness is now enforced
   * by bounded concurrency (`perHostConcurrency` -> `maxConcurrency`). The field is
   * retained for API stability (audit.ts and the inngest layer still pass it) and as
   * the obvious home for a future Crawlee `maxRequestsPerMinute` rate cap.
   */
  staggerMs: number;
  pageTimeoutMs: number;
  userAgent?: string;
  basicAuth?: { username: string; password: string };
  extraHeaders?: Record<string, string>;
  allowPrivateIpsForTesting?: boolean;
  /** Parsed robots.txt. When present, disallowed links are not enqueued. */
  robots?: ParsedRobots;
  /**
   * Scheme ('http:'/'https:') to pin every stored page + link IDENTITY to (A1b).
   * The crawler still fetches the real URLs; only the identity used for dedupe and
   * the in-degree graph is normalized, so a site that downgrades https->http on deep
   * paths does not split one page into two identities. Omit to keep each URL's own
   * scheme (legacy behavior).
   */
  canonicalScheme?: string;
  /**
   * Strip tracking query params (utm_*, gclid, fbclid, mc_*, ref, …) from stored page + link
   * IDENTITIES (§2), so campaign-tagged URLs collapse to one node instead of inflating the graph.
   * The crawler still fetches the real URL; only the dedupe/in-degree identity is normalized. Omit
   * to keep every param (legacy v1 behavior).
   */
  stripTrackingParams?: boolean;
  /**
   * Unify www vs non-www in stored identities (§2) to this host (the homepage's resolved host), so
   * `www.x` and `x` pages collapse to one node. Omit to keep each URL's own host (legacy).
   */
  unifyHost?: string;
  /**
   * Respect `<link rel="canonical">` (§2): a same-host page that declares a different canonical is
   * stored under that canonical identity (not as a separate node). Omit to ignore rel=canonical.
   */
  respectRelCanonical?: boolean;
  /**
   * Hard wall-clock budget (ms) for the ENTIRE crawl. When set and exceeded, the crawler is torn
   * down. On the legacy path runCrawl throws a timeout-classified error (Issue 2b); under
   * `politeCrawl` it instead stops GRACEFULLY and returns the pages crawled so far with
   * `budgetExhausted: true` (§5 — partial is a surfaced state, not an error). Omit or a non-positive
   * value = no budget.
   */
  maxCrawlMs?: number;
  /**
   * Polite, adaptive crawl (SPEC 01 §5, ENGINE_V2). When set, the crawler: honors robots
   * `crawl-delay` + `Retry-After` as floors, retries `blocked` (403/429/503) status codes with
   * exponential-full-jitter backoff, drives concurrency with AIMD (start 2 → ceiling `min(5,
   * perHostConcurrency)`, halve on a throttle), and stops gracefully (partial) on the wall-clock
   * budget. Omit for the legacy v1 crawl (static `maxConcurrency = perHostConcurrency`, no backoff,
   * throw-on-budget) — construction is byte-identical to before this flag existed.
   */
  politeCrawl?: boolean;
  /**
   * Deterministic (depth ASC, canonicalUrl ASC) crawl frontier (SPEC 01 §3 / T4). When set, the
   * link-discovered crawl is driven LEVEL BY LEVEL: a whole BFS level is fetched, then its children
   * are deduped + sorted by canonical URL and the page cap is applied to that sorted frontier — so a
   * site larger than the cap yields the SAME subset run-to-run. Omit for the legacy FIFO auto-crawl
   * (enqueueLinks), whose truncated subset is non-deterministic under concurrency.
   */
  deterministicFrontier?: boolean;
}

export interface CrawledPage {
  url: string;
  urlHash: string;
  title?: string;
  statusCode: number;
}

export interface CrawledLink {
  fromUrl: string;
  toUrl: string;
  anchorText: string;
  isGenericAnchor: boolean;
}

export interface CrawlOutput {
  pages: CrawledPage[];
  links: CrawledLink[];
  /** §5: true when the wall-clock budget cut the crawl short (politeCrawl only — graceful partial). */
  budgetExhausted?: boolean;
  /** §5/T7 adaptive-concurrency telemetry (politeCrawl only). */
  aimd?: AimdTelemetry;
}

const DEFAULT_UA = 'CrawlmouseBot/1.0 (+https://crawlmouse.com/bot)';
/** Product token matched against robots.txt user-agent groups. */
const ROBOTS_UA = 'CrawlmouseBot';

/**
 * got `beforeRedirect` hook: re-validate each 3xx target so a public start URL
 * cannot 302 to an internal host (a raw-IP literal that dnsLookup pinning won't
 * see). Defined once at module scope so it can be deduped by reference in the
 * hooks array — got 14 rejects any unknown property on the options object, so we
 * cannot tag options to track registration.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function revalidateRedirectTarget(options: any, response: any): Promise<void> {
  const locationHeader = response.headers.location;
  if (!locationHeader) return;
  const locationValue = Array.isArray(locationHeader) ? locationHeader[0] : locationHeader;
  if (!locationValue) return;
  const baseUrl = typeof options.url === 'string' ? options.url : options.url.toString();
  await validateUrlOrThrow(new URL(locationValue, baseUrl).toString());
}

/**
 * Crawlee's autoscaler measures memory by spawning `ps` UNLESS it detects AWS Lambda via
 * `process.env.AWS_LAMBDA_FUNCTION_MEMORY_SIZE`. `ps` does not exist in the Vercel serverless
 * runtime, so without the hint the very first `systemInfo` snapshot (fired synchronously at the
 * start of `crawler.run()`) throws `spawn ps ENOENT` and the audit fails. Vercel runs ON AWS Lambda
 * but strips the Lambda-injected `AWS_*` env, and rejects setting that var as a project env var.
 * (crawlee 3.16 defaults `systemInfoV2: true`, whose `isLambda()` gates on this var; the legacy V1
 * `getMemoryInfo` path also checks it — both are covered.)
 *
 * Gated on Linux: V2's `isLambda()` has no `process.platform` check, so on a non-Linux dev box
 * (a future CLI/worker or local run on macOS/Windows) setting the var would route Crawlee to its
 * `cat /proc/meminfo` branch, which doesn't exist there. Restricting to Linux keeps Vercel correct
 * and lets a non-Linux host use Crawlee's own (working) `ps` path instead.
 *
 * On Linux we set it on the REAL process.env that the externalized (non-bundled) `crawlee` reads.
 * In a Next.js server bundle the local `process.env` reference can be a shim that doesn't propagate
 * writes to the real Node global, so we write through `globalThis.process.env` as well. Called
 * in-stack at the very start of every crawl, before Crawlee's first memory snapshot. Never
 * overrides a value a real Lambda/host already set. The value only sizes the autoscaler's memory
 * budget (concurrency is independently capped by `maxConcurrency`), so it cannot over-scale.
 */
export function ensureCrawleeMemoryHint(platform: string = process.platform): void {
  if (platform !== 'linux') return;
  // globalThis.process.env is the real Node env the externalized crawlee reads (proven live: writing
  // only the bundle-local process.env did NOT stop the `ps` spawn; writing through globalThis did).
  const realEnv = (globalThis as typeof globalThis & { process?: { env?: Record<string, string | undefined> } })
    .process?.env;
  if (realEnv && !realEnv.AWS_LAMBDA_FUNCTION_MEMORY_SIZE) realEnv.AWS_LAMBDA_FUNCTION_MEMORY_SIZE = '3008';
  if (!process.env.AWS_LAMBDA_FUNCTION_MEMORY_SIZE) process.env.AWS_LAMBDA_FUNCTION_MEMORY_SIZE = '3008';
}

/**
 * Run the crawler with an optional hard wall-clock budget. Returns whether the budget was hit.
 * Without a budget it simply awaits the crawl (returns false). With one, it races the crawl against
 * a deadline: if the deadline wins, the crawler is torn down immediately (a HARD ceiling). What
 * happens then depends on `gracefulPartial`:
 *  - `false` (legacy/v1): REJECT with a message that classifies as a `timeout` failure (Issue 2b).
 *  - `true` (politeCrawl/v2): RESOLVE `true`, so runCrawl returns the pages gathered so far as a
 *    partial result (§5 — partial is a surfaced state, not an error).
 * The abandoned run promise is caught so a late rejection after teardown can never surface as an
 * unhandled rejection.
 */
async function runWithWallClock(
  crawler: CheerioCrawler,
  startUrls: string[],
  maxCrawlMs?: number,
  gracefulPartial?: boolean,
): Promise<boolean> {
  if (!maxCrawlMs || maxCrawlMs <= 0) {
    await crawler.run(startUrls);
    return false;
  }
  const run = crawler.run(startUrls);
  run.catch(() => {}); // once we tear down on timeout, swallow the abandoned run's late rejection
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      run.then(() => false),
      new Promise<boolean>((resolve, reject) => {
        timer = setTimeout(() => {
          void crawler.teardown().catch(() => {});
          if (gracefulPartial) resolve(true);
          else reject(new Error(`Crawl timed out after ${maxCrawlMs}ms (wall-clock budget)`));
        }, maxCrawlMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function runCrawl(input: CrawlInput): Promise<CrawlOutput> {
  ensureCrawleeMemoryHint();

  const pages = new Map<string, CrawledPage>();
  const links: CrawledLink[] = [];
  // T4 deterministic-frontier buffer: under input.deterministicFrontier the requestHandler pushes this
  // page's robots-allowed, same-host children here (real URLs) instead of auto-enqueuing;
  // runDeterministicLevels drains + dedupes + sorts + caps it per BFS level. Never written on the
  // legacy (flag-off) path, so it is inert there.
  const frontierBuffer: string[] = [];

  // Honor robots.txt Disallow when enqueuing links (the parsed rules are absent in
  // test mode and when the site has no robots.txt, in which case nothing is filtered).
  const robots = input.robots;
  const isLinkAllowed = (u: string): boolean => {
    if (!robots) return true;
    try {
      const { pathname, search } = new URL(u);
      return isAllowedByRobots(robots, ROBOTS_UA, pathname + search);
    } catch {
      return true;
    }
  };

  // Pre-validate every start URL (unless test mode bypasses for loopback testing)
  if (!input.allowPrivateIpsForTesting) {
    for (const u of input.startUrls) await validateUrlOrThrow(u);
  }

  // Pin a stored URL's IDENTITY to the canonical scheme when one is supplied (A1b);
  // otherwise keep the URL's own scheme. Always canonicalizes for stable dedupe.
  const pin = (u: string): string =>
    canonicalizeUrl(u, {
      forceScheme: input.canonicalScheme,
      stripTrackingParams: input.stripTrackingParams,
      unifyHost: input.unifyHost,
    });

  // ── §5 polite, adaptive crawl (politeCrawl / ENGINE_V2). All of this is inert on the v1 path. ──
  // AIMD bounds, CLAMPED to the caller's tier ceiling so a free crawl (perHostConcurrency=1) stays
  // sequential — preserving cost control #5 — while Pro (8) caps at the §5 ceiling of 5.
  const crawlDelaySec = input.robots ? getCrawlDelay(input.robots, ROBOTS_UA) : undefined;
  // A declared robots crawl-delay means "crawl me serially with this gap": honor it as a floor
  // (cap 1 + sameDomainDelaySecs) instead of running the adaptive ramp.
  const honorCrawlDelay = input.politeCrawl === true && typeof crawlDelaySec === 'number' && crawlDelaySec > 0;
  const aimdCeiling = honorCrawlDelay ? 1 : Math.min(AIMD_CEILING_CONCURRENCY, input.perHostConcurrency);
  const aimdStart = Math.min(AIMD_START_CONCURRENCY, aimdCeiling);
  const aimdFloor = Math.min(AIMD_MIN_CONCURRENCY, aimdCeiling);
  // Honor a declared crawl-delay as a minimum inter-request gap, enforced in the preNavigationHook
  // (NOT Crawlee's sameDomainDelaySecs, which silently no-ops for IP/loopback hosts — `getDomain`
  // returns null). 0 = no gap, so the healthy-crawl path stays sleep-free. `nextAllowedStart` tracks
  // the earliest the next request may begin; with the crawl serialized to cap 1 (aimdCeiling above)
  // this yields clean ~crawlDelay spacing on ANY host.
  const crawlDelayMs = honorCrawlDelay && crawlDelaySec ? crawlDelaySec * 1000 : 0;
  let nextAllowedStart = 0;
  // The crawl deadline bounds every backoff (a hostile Retry-After can't hang a slot) and is the
  // point the crawl stops gracefully under politeCrawl.
  const crawlDeadline = input.maxCrawlMs && input.maxCrawlMs > 0 ? Date.now() + input.maxCrawlMs : Infinity;
  // AIMD controller, created lazily once Crawlee's autoscaled pool exists (after run() starts). Under
  // the deterministic frontier (T4) the crawl re-runs once PER LEVEL and Crawlee recreates the pool on
  // each run(), so re-bind the controller to the live pool whenever it changes. On the legacy single-run
  // path the pool is created exactly once, so this still binds the controller once — behavior unchanged.
  let aimd: AimdController | undefined;
  let aimdPool: ConcurrencyPool | undefined;
  const ensureAimd = (c: { autoscaledPool?: ConcurrencyPool }): void => {
    if (!input.politeCrawl) return;
    const pool = c.autoscaledPool;
    if (!pool || pool === aimdPool) return;
    aimd = new AimdController(pool, { start: aimdStart, ceiling: aimdCeiling, floor: aimdFloor, successStep: AIMD_SUCCESS_STEP });
    aimdPool = pool;
  };

  // v1 construction is byte-identical to before (only `maxConcurrency`, set in the else below). The
  // polite options are layered on AFTER, only under `politeCrawl`, so with the flag off the options
  // object is unchanged from HEAD — the polite keys are absent, not present-as-undefined.
  const crawlerOptions: CheerioCrawlerOptions = {
    maxRequestsPerCrawl: input.pageCap,
    requestHandlerTimeoutSecs: Math.ceil(input.pageTimeoutMs / 1000),
    // text/html is handled by default; also accept XHTML so HTML5/XML-served
    // sites are crawled rather than silently skipped (which yields an empty graph).
    additionalMimeTypes: ['application/xhtml+xml'],
    preNavigationHooks: [
      async (_ctx, gotOptions) => {
        // §5 crawl-delay floor. The ONLY per-request wait reintroduced after the throughput fix, and
        // strictly gated on a SITE-DECLARED robots crawl-delay (crawlDelayMs>0), under which the crawl
        // is already serialized to cap 1 — so it adds the spacing the site asked for without starving
        // any intended concurrency (a healthy crawl has crawlDelayMs=0 and never enters this branch).
        // Bounded by the wall-clock budget: a crawl-delay too large for the budget truncates to a
        // partial crawl rather than hanging (§5 "crawl what fits in budget, never hang").
        if (crawlDelayMs > 0) {
          const now = Date.now();
          const budgetRemaining =
            crawlDeadline === Infinity ? Infinity : Math.max(0, crawlDeadline - now - BACKOFF_BUDGET_SLACK_MS);
          const wait = Math.min(Math.max(0, nextAllowedStart - now), budgetRemaining);
          nextAllowedStart = now + wait + crawlDelayMs;
          if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
        }
        gotOptions.headers = {
          'User-Agent': input.userAgent ?? DEFAULT_UA,
          ...(input.extraHeaders ?? {}),
        };
        if (input.basicAuth) {
          const token = Buffer.from(`${input.basicAuth.username}:${input.basicAuth.password}`).toString('base64');
          gotOptions.headers['Authorization'] = `Basic ${token}`;
        }
        // Politeness is now enforced by BOUNDED CONCURRENCY (maxConcurrency below),
        // not a per-request sleep. The old `await setTimeout(input.staggerMs)` blocked
        // INSIDE this navigation hook, so Crawlee's autoscaler never saw idle headroom
        // and effective concurrency collapsed to ~1 request at a time (throughput fell
        // to ~1-6 pages/s). Removing the in-hook delay lets the autoscaler ramp up to
        // maxConcurrency, which is the real, parallelism-respecting politeness lever.

        if (!input.allowPrivateIpsForTesting) {
          // SECURITY: pin every connection to a validated IP. The pre-validation of
          // start URLs and the redirect re-check below both resolve-then-connect,
          // leaving a DNS-rebinding window where a checked public IP is swapped for
          // an internal one. A validating DNS lookup connects only to addresses it
          // just checked, closing that window. crawlee 3.16 ships got 14 (via
          // got-scraping), whose option is `dnsLookup` (the older `lookup` key is
          // rejected with "Unexpected option" and would break every crawl).
          // Raw IP-literal targets skip dnsLookup, so the redirect hook below still
          // re-validates each hop's URL.
          gotOptions.dnsLookup = createSafeLookup();

          // SECURITY: re-validate the redirect target on every HTTP 3xx, NOT just
          // the initial URL. Dedupe by function reference (the hook may run more
          // than once for the same options object) without tagging options, which
          // got 14 would reject.
          gotOptions.hooks ??= {};
          gotOptions.hooks.beforeRedirect ??= [];
          if (!gotOptions.hooks.beforeRedirect.includes(revalidateRedirectTarget)) {
            gotOptions.hooks.beforeRedirect.push(revalidateRedirectTarget);
          }
        }
      },
    ],
    async requestHandler({ request, $, response, enqueueLinks, crawler }) {
      // The REAL (reachable) loaded URL — used to resolve relative links and to enqueue,
      // so the crawler fetches the scheme the site actually serves. The stored identity
      // (pageUrl) is pinned to canonicalScheme so http/https versions don't double-count.
      const loadedUrl = canonicalizeUrl(request.loadedUrl ?? request.url);
      // Single-parse: Crawlee already parsed the response body into `$` (a cheerio
      // root). Pass that object straight to extractPage instead of re-serializing it
      // with `$.html()` and letting extractPage re-run `cheerio.load` — that
      // double-parse roughly doubled the per-page CPU cost for no behavioral gain.
      const extracted = extractPage($, loadedUrl);
      // §2 rel=canonical (v2): store a canonicalised-away page under its declared canonical identity
      // (same-host only — enforced in extractPage) so it is not counted as a separate node. v1 and
      // self-canonical pages keep their own loaded URL as the identity.
      const identitySource = input.respectRelCanonical && extracted.canonicalUrl ? extracted.canonicalUrl : loadedUrl;
      const pageUrl = pin(identitySource);
      const statusCode = response.statusCode ?? 0;

      pages.set(pageUrl, {
        url: pageUrl,
        urlHash: hashUrl(pageUrl),
        title: extracted.title,
        statusCode,
      });

      for (const link of extracted.links) {
        links.push({ fromUrl: pageUrl, toUrl: pin(link.toUrl), anchorText: link.anchorText, isGenericAnchor: link.isGenericAnchor });
      }

      // Enqueue links the site's robots.txt does not disallow. extractPage has already
      // restricted these to the same host (ignoring www) and to http(s); enqueue the
      // REAL-scheme URLs so a deep path that 30x-downgrades https->http is still followed.
      // strategy 'same-hostname' is scheme-agnostic (the old 'same-origin' rejected the
      // downgraded hop post-navigation and stalled the crawl — A1).
      const toEnqueue = extracted.links.map((l) => l.toUrl).filter(isLinkAllowed);
      if (input.deterministicFrontier) {
        // T4: buffer children for deterministic level-ordering instead of FIFO auto-enqueue. These are
        // already same-host (extractPage) + robots-allowed (isLinkAllowed) — the exact set enqueueLinks
        // would take; runDeterministicLevels dedupes by canonical identity, sorts, and applies the cap.
        for (const u of toEnqueue) frontierBuffer.push(u);
      } else {
        await enqueueLinks({ urls: toEnqueue, strategy: 'same-hostname' });
      }

      // §5 AIMD additive-increase: capture the pool on first use, then count this clean 200 toward
      // the next concurrency step-up. Inert on the v1 path.
      if (input.politeCrawl) {
        ensureAimd(crawler);
        if (statusCode === 200) aimd?.onSuccess();
      }
    },
    failedRequestHandler({ request }) {
      const url = pin(request.url);
      if (!pages.has(url)) {
        pages.set(url, { url, urlHash: hashUrl(url), statusCode: 0 });
      }
    },
  };

  if (input.politeCrawl) {
    // §5: retry `blocked` codes (403/429/503) — additionalHttpErrorStatusCodes forces them to throw
    // so they enter the retry+backoff path; 404/410 stay non-throwing `dead` (no retry). 5xx and
    // network/timeout already throw by default.
    crawlerOptions.maxRequestRetries = MAX_REQUEST_RETRIES;
    crawlerOptions.additionalHttpErrorStatusCodes = [...BLOCKED_RETRY_STATUS_CODES];
    // AIMD-driven concurrency: start at `aimdStart`; the controller raises the cap toward the
    // (tier-clamped) ceiling and halves it on a throttle. Replaces the static v1 maxConcurrency.
    crawlerOptions.autoscaledPoolOptions = politeAutoscaledPoolOptions({ start: aimdStart, floor: aimdFloor });
    // (A declared robots crawl-delay is honored as a serialized inter-request gap in the
    // preNavigationHook above — not via Crawlee's IP-skipping sameDomainDelaySecs.)
    // Reactive backoff lives ONLY here — off the navigation hot path, throttle-only — so it never
    // re-introduces the per-request stagger the throughput fix removed. Crawlee awaits this BEFORE
    // re-enqueuing the failed request, so the delay throttles exactly the retry.
    crawlerOptions.errorHandler = async (ctx) => {
      const status = ctx.response?.statusCode ?? 0;
      if (!isThrottleStatus(status)) return;
      ensureAimd(ctx.crawler);
      aimd?.onThrottle();
      const want = Math.max(
        fullJitterBackoffMs(ctx.request.retryCount, BACKOFF_BASE_MS),
        parseRetryAfter(ctx.response?.headers?.['retry-after']),
      );
      const delayMs = capDelayMs(want, crawlDeadline, Date.now());
      if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
    };
  } else {
    // The active politeness + parallelism lever on the v1 path. With the per-request stagger sleep
    // removed (see preNavigationHooks), Crawlee's autoscaler ramps in-flight requests up to this
    // ceiling instead of being starved to ~1, so this bound caps load on the target host.
    crawlerOptions.maxConcurrency = input.perHostConcurrency;
  }

  const crawler = new CheerioCrawler(crawlerOptions, new Configuration({ persistStorage: false, purgeOnStart: true }));

  // T4 deterministic frontier (v2): drain the crawl in strict (depth ASC, canonicalUrl ASC) order by
  // fetching one BFS level at a time, so the page cap always selects the same subset run-to-run. Each
  // level re-runs the SAME crawler (run() is re-entrant), reusing the SSRF-pinned got options, the
  // robots/crawl-delay preNavigationHook and the politeCrawl retry/backoff unchanged. The cap is
  // enforced here by `admitted`, so each per-level run() processes EXACTLY its (already-capped) batch.
  async function runDeterministicLevels(): Promise<boolean> {
    const visited = new Set<string>();
    // Dedupe a list of real URLs by canonical identity and order them canonicalUrl ASC (the §3 key),
    // returning one real URL per identity (Crawlee fetches the real URL; dedup/sort use the identity).
    const sortFrontier = (urls: string[]): string[] => {
      const byId = new Map<string, string>();
      for (const u of urls) {
        const id = pin(u);
        if (!byId.has(id)) byId.set(id, u);
      }
      return [...byId.keys()].sort().map((id) => byId.get(id)!);
    };
    let frontier = sortFrontier(input.startUrls);
    for (const u of frontier) visited.add(pin(u));
    let admitted = 0;
    while (frontier.length > 0 && admitted < input.pageCap) {
      const levelBatch = frontier.slice(0, input.pageCap - admitted); // deterministic truncation point
      admitted += levelBatch.length;
      frontierBuffer.length = 0; // the requestHandler fills this with THIS level's children
      const remaining = crawlDeadline === Infinity ? undefined : crawlDeadline - Date.now();
      if (remaining !== undefined && remaining <= 0) return true; // budget exhausted between levels
      const hitBudget = await runWithWallClock(crawler, levelBatch, remaining, input.politeCrawl);
      if (hitBudget) return true; // graceful partial (v2) on the wall-clock budget
      const next: string[] = [];
      for (const child of frontierBuffer) {
        const id = pin(child);
        if (!visited.has(id)) {
          visited.add(id);
          next.push(child);
        }
      }
      frontier = sortFrontier(next);
    }
    return false;
  }

  // politeCrawl → stop gracefully (partial) on budget exhaustion; v1 → throw (Issue 2b). The
  // deterministic frontier drives the crawl level-by-level (above); the legacy path is one auto-crawl.
  const budgetExhausted = input.deterministicFrontier
    ? await runDeterministicLevels()
    : await runWithWallClock(crawler, input.startUrls, input.maxCrawlMs, input.politeCrawl);

  // Snapshot the pages map. On a graceful-partial teardown an in-flight handler may resolve and
  // pages.set(...) just after this line; that late write lands on the already-snapshotted Map (it can
  // only nudge the partial boundary by a page — never corrupt or crash, as JS is single-threaded).
  const out: CrawlOutput = { pages: Array.from(pages.values()), links };
  if (input.politeCrawl) {
    out.budgetExhausted = budgetExhausted;
    if (aimd) out.aimd = aimd.telemetry;
  }
  return out;
}
