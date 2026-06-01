import { CheerioCrawler, Configuration, log, LogLevel } from 'crawlee';
import { validateUrlOrThrow, createSafeLookup } from './ssrf-guard.js';
import { canonicalizeUrl, hashUrl } from './url-canonical.js';
import { extractPage } from './extract.js';

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

export async function runCrawl(input: CrawlInput): Promise<CrawlOutput> {
  const pages = new Map<string, CrawledPage>();
  const links: CrawledLink[] = [];

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
          // an internal one. A validating `lookup` connects only to addresses it
          // just checked, closing that window. (got v11 forwards `lookup` to
          // https.request.) Raw IP-literal targets bypass `lookup`, so the redirect
          // hook still re-validates each hop's URL.
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (gotOptions as any).lookup = createSafeLookup();

          // SECURITY: re-validate the redirect target on every HTTP 3xx, NOT just
          // the initial URL — an attacker submits https://attacker.com which 302s to
          // http://169.254.169.254 (a raw IP literal `lookup` won't see).
          gotOptions.hooks ??= {};
          gotOptions.hooks.beforeRedirect ??= [];
          // Register the validator once per options object (preNavigationHooks can
          // run per request; pushing each time would leak duplicate closures).
          const guard = gotOptions as { __cmRedirectGuard?: boolean };
          if (!guard.__cmRedirectGuard) {
            guard.__cmRedirectGuard = true;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            gotOptions.hooks.beforeRedirect.push(async (options: any, response: any) => {
              const locationHeader = response.headers.location;
              if (!locationHeader) return;
              const locationValue = Array.isArray(locationHeader) ? locationHeader[0] : locationHeader;
              if (!locationValue) return;
              const baseUrl = typeof options.url === 'string' ? options.url : options.url.toString();
              const redirectUrl = new URL(locationValue, baseUrl);
              await validateUrlOrThrow(redirectUrl.toString());
            });
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

      // Enqueue same-origin links
      const origin = new URL(url).origin;
      const sameOrigin = extracted.links.filter((l) => l.toUrl.startsWith(origin)).map((l) => l.toUrl);
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
