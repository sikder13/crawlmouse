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
  staggerMs: number;
  pageTimeoutMs: number;
  userAgent?: string;
  basicAuth?: { username: string; password: string };
  extraHeaders?: Record<string, string>;
  allowPrivateIpsForTesting?: boolean;
  /** Parsed robots.txt. When present, disallowed links are not enqueued. */
  robots?: ParsedRobots;
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

export async function runCrawl(input: CrawlInput): Promise<CrawlOutput> {
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

  const crawler = new CheerioCrawler({
    maxRequestsPerCrawl: input.pageCap,
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
        // Politeness stagger
        await new Promise((r) => setTimeout(r, input.staggerMs));

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
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (gotOptions as any).dnsLookup = createSafeLookup();

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
      const url = canonicalizeUrl(request.loadedUrl ?? request.url);
      const html = $.html();
      const extracted = extractPage(html, url);
      const statusCode = response.statusCode ?? 0;

      pages.set(url, {
        url,
        urlHash: hashUrl(url),
        title: extracted.title,
        statusCode,
      });

      for (const link of extracted.links) {
        links.push({ fromUrl: url, toUrl: link.toUrl, anchorText: link.anchorText, isGenericAnchor: link.isGenericAnchor });
      }

      // Enqueue same-origin links the site's robots.txt does not disallow.
      const origin = new URL(url).origin;
      const sameOrigin = extracted.links
        .filter((l) => l.toUrl.startsWith(origin))
        .map((l) => l.toUrl)
        .filter(isLinkAllowed);
      await enqueueLinks({ urls: sameOrigin, strategy: 'same-origin' });
    },
    failedRequestHandler({ request }) {
      const url = canonicalizeUrl(request.url);
      if (!pages.has(url)) {
        pages.set(url, { url, urlHash: hashUrl(url), statusCode: 0 });
      }
    },
  }, new Configuration({ persistStorage: false, purgeOnStart: true }));

  await crawler.run(input.startUrls);

  return { pages: Array.from(pages.values()), links };
}
