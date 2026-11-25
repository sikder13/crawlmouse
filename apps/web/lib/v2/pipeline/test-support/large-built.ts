/**
 * A built check the size of production's failing one (F-330): `pages` pages from the recorded
 * site's first page, and `edges` link edges spread evenly over them, each to another page of the
 * check, with anchor text a real site writes. The recorded check's access tests, fixes and changes
 * are kept. For the persist tests that need production's shape on a real Postgres
 * (scripts/db/persist-edges.test.ts).
 */
import { buildCheck } from '@crawlmouse/engine/v2/pipeline';
import type { BatchResult, CrawlPage } from '@crawlmouse/types/v2';
import { recordedBuild } from '../../../../../../packages/engine/fixtures/v2/build/recorded';
import { pageVantage } from '../persist';
import type { PersistInput } from '../types';

export function largeBuiltInput(pages: number, edges: number): PersistInput {
  const input = recordedBuild();
  const built = buildCheck(input);
  const crawl = (input.batches as BatchResult[]).flatMap((b) =>
    b.kind === 'crawl' ? b.pages : [],
  ) as CrawlPage[];
  const template = built.page_results[0]!;
  const vantageOf = pageVantage(crawl).get(template.url)!;
  const url = (i: number) => `https://built-site.test/products/item-${i}`;
  const page_results = Array.from({ length: pages }, (_, i) => ({
    ...template,
    url: url(i),
    final_url: url(i),
    template_key: '/products/{slug}',
    title: { text: `Item ${i} – handmade oak furniture | Built Site`, chars: 46, cut: false },
  }));
  const link_edges = Array.from({ length: edges }, (_, n) => {
    const from = n % pages;
    // The k-th edge out of a page goes k + 1 pages on, so no (from, to) pair repeats.
    const k = Math.floor(n / pages);
    return {
      check_id: built.check.id,
      from_url: url(from),
      to_url: url((from + k + 1) % pages),
      anchor_text: `See item ${(from + k + 1) % pages} in solid oak`,
      is_generic_anchor: false,
      js_only: false,
    };
  });
  return {
    built: { ...built, page_results, link_edges },
    vantage: new Map(page_results.map((p) => [p.url, vantageOf] as const)),
    map_path: `anon/${built.check.site_id}/${built.check.id}/map.json.gz`,
    read: [],
  };
}

/** The site and running check `largeBuiltInput`'s check is persisted over. */
export function largeBuiltSeed() {
  const input = recordedBuild();
  return { site: input.site, check: input.check };
}
