/**
 * Whether a crawl read no page at all, and why, in the two words a check can fail with. A row with
 * the outcome `fetched` got a response, whatever its status, so a site that answers 403 to everything
 * is not here: that is a response to report.
 *
 * `site_unreachable` needs robots.txt, the first request to the host, to have had no answer
 * (`network` holds a DNS, TLS or connection failure; readRobots in the worker). A failed page row
 * alone does not say it: the row does not store its error class, and its failure can be a response
 * cut at the size cap or an address the SSRF guard refused.
 */
import type { CrawlBatchResult } from '@crawlmouse/types/v2';

export type NothingRead = 'site_unreachable' | 'nothing_read';

export function nothingReadReason(crawl: readonly CrawlBatchResult[]): NothingRead | null {
  if (crawl.some((b) => b.pages.some((p) => p.outcome === 'fetched'))) return null;
  const noAnswer = crawl.some((b) =>
    b.findings.some(
      (f) => f.kind === 'robots_unreachable' && (f.why === 'network' || f.why === 'timeout'),
    ),
  );
  return noAnswer ? 'site_unreachable' : 'nothing_read';
}
