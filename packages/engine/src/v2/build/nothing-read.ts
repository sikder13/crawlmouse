/**
 * Whether a crawl read no page at all, and why, in the two words a check can fail with. A row with
 * the outcome `fetched` got a response, whatever its status, so a site that answers 403 to everything
 * is not here: that is a response to report.
 *
 * `site_unreachable` says the site is down, so it needs that shown of the site's own address:
 * robots.txt on the homepage's origin got no answer (`network`, the worker's class for a DNS or
 * connection failure and anything else unclassified, or `timeout`), and no other origin answered.
 * A batch stops at the first origin that blocks it (`preload`, worker site-rules.ts), so a dead `www`
 * host in a sitemap can end a crawl of a healthy site: that is `nothing_read`. A failed page row does
 * not say it either: the row does not store its error class.
 */
import type { CrawlBatchResult } from '@crawlmouse/types/v2';

export type NothingRead = 'site_unreachable' | 'nothing_read';

export function nothingReadReason(
  crawl: readonly CrawlBatchResult[],
  homepageUrl: string,
): NothingRead | null {
  if (crawl.some((b) => b.pages.some((p) => p.outcome === 'fetched'))) return null;
  const home = new URL(homepageUrl).origin;
  const homeSilent = crawl.some((b) =>
    b.findings.some(
      (f) =>
        f.kind === 'robots_unreachable' &&
        f.origin === home &&
        (f.why === 'network' || f.why === 'timeout'),
    ),
  );
  const otherAnswered = crawl.some((b) =>
    b.robots.some((r) => r.origin !== home && r.status !== null),
  );
  return homeSilent && !otherAnswered ? 'site_unreachable' : 'nothing_read';
}
