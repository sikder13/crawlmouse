import { CheerioCrawler, Configuration, log, LogLevel } from 'crawlee';
import { validateUrlOrThrow, createSafeLookup } from './ssrf-guard.js';
import { canonicalizeUrl, hashUrl } from './url-canonical.js';
import { extractPage } from './extract.js';
import { isAllowedByRobots, type ParsedRobots } from './robots.js';

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

export async function runCrawl(input: CrawlInput): Promise<CrawlOutput> {
  ensureCrawleeMemoryHint();

  const pages = new Map<string, CrawledPage>();
  const links: CrawledLink[] = [];

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
    input.canonicalScheme ? canonicalizeUrl(u, { forceScheme: input.canonicalScheme }) : canonicalizeUrl(u);

  const crawler = new CheerioCrawler({
    maxRequestsPerCrawl: input.pageCap,
    // The active politeness + parallelism lever. With the per-request stagger sleep
    // removed (see preNavigationHooks), Crawlee's autoscaler ramps the number of
    // in-flight requests up to this ceiling instead of being starved to ~1, so this
    // bound is what now caps load on the target host.
    maxConcurrency: input.perHostConcurrency,
    requestHandlerTimeoutSecs: Math.ceil(input.pageTimeoutMs / 1000),
    // text/html is handled by default; also accept XHTML so HTML5/XML-served
    // sites are crawled rather than silently skipped (which yields an empty graph).
    additionalMimeTypes: ['application/xhtml+xml'],
    preNavigationHooks: [
      async (_ctx, gotOptions) => {
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
    async requestHandler({ request, $, response, enqueueLinks }) {
      // The REAL (reachable) loaded URL — used to resolve relative links and to enqueue,
      // so the crawler fetches the scheme the site actually serves. The stored identity
      // (pageUrl) is pinned to canonicalScheme so http/https versions don't double-count.
      const loadedUrl = canonicalizeUrl(request.loadedUrl ?? request.url);
      const pageUrl = pin(loadedUrl);
      // Single-parse: Crawlee already parsed the response body into `$` (a cheerio
      // root). Pass that object straight to extractPage instead of re-serializing it
      // with `$.html()` and letting extractPage re-run `cheerio.load` — that
      // double-parse roughly doubled the per-page CPU cost for no behavioral gain.
      const extracted = extractPage($, loadedUrl);
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
      await enqueueLinks({ urls: toEnqueue, strategy: 'same-hostname' });
    },
    failedRequestHandler({ request }) {
      const url = pin(request.url);
      if (!pages.has(url)) {
        pages.set(url, { url, urlHash: hashUrl(url), statusCode: 0 });
      }
    },
  }, new Configuration({ persistStorage: false, purgeOnStart: true }));

  await crawler.run(input.startUrls);

  return { pages: Array.from(pages.values()), links };
}
