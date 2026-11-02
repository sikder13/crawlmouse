/**
 * The detectors' view of what one request showed about a page (`PageFacts`), read from the contract's
 * `PageResult`. The worker records these fields (packages/worker/src/rows/crawl-page.ts); this module
 * only renames them and drops what a detector must not rely on.
 *
 * - A declared canonical is the resolved URL when there is one, else the href as written, which then
 *   matches no page and reads as unread rather than as "declares none".
 * - An incomplete hreflang list is not read: an annotation left out could be the return a member is
 *   missing.
 * - A redirect chain is its hop count and whether it looped.
 */
import type { PageResult } from '@crawlmouse/types/v2';
import type { PageFacts } from './types.js';

export function pageFacts(p: PageResult): PageFacts {
  const c = p.canonical_declared;
  return {
    url: p.url,
    final_url: p.final_url,
    redirect: p.redirect === null ? null : { hops: p.redirect.hops.length, loop: p.redirect.loop },
    canonical: c === null ? null : { href: c.url ?? c.href },
    links_read: p.links_read,
    simhash: p.content_simhash,
    hreflang:
      p.hreflang === null || !p.hreflang.complete
        ? null
        : p.hreflang.links.map((l) => ({ lang: l.hreflang, href: l.href })),
  };
}
