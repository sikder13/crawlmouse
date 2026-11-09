/**
 * Two worker rows the CC-12b staging smoke met (CC-20 follow-up §2 items 2 and 3), mapped as the
 * worker writes them (packages/worker/src/batch/crawl.ts `crawlPage`):
 *
 * - A URL robots.txt keeps our crawler from carries the robots.txt response as its evidence: status
 *   200, `final_url` the robots.txt, its byte count, not HTML. It is the detectors' `disallowed`, never
 *   a PageResult, where it would read as a page fetched with a 200.
 * - A 404 or 410 HTML page has its links unread (`links_read` false) and no count (`links_out` null).
 *   The PageResult schema needs a number, so the page carries 0 and keeps `links_read` false: "not
 *   read", which every reader of `links_out` checks first (apps/web/__tests__/links-read-guard.test.ts).
 */
import { describe, expect, it } from 'vitest';
import { CrawlPageSchema, type CrawlPage } from '@crawlmouse/types/v2';
import { crawlRow, edge, oneBatchBuild } from '../../../fixtures/v2/build/rows.js';
import { assemble } from './assemble.js';
import { readBatches } from './batches.js';
import { buildCheck } from './build.js';
import type { BuildInput } from './types.js';

const HOME = 'https://rows.test';
const KEPT_OUT = `${HOME}/members/area`;
const GONE = `${HOME}/old-page`;

/** The worker's row for a URL robots.txt disallows for us (and for every search engine). */
const disallowedRow: CrawlPage = CrawlPageSchema.parse({
  ...crawlRow({ url: KEPT_OUT, outcome: 'robots_disallowed' }),
  status_code: 200,
  final_url: `${HOME}/robots.txt`,
  byte_count: 87,
  is_html: false,
  links_read: false,
  links_out: null,
  robots_search: [
    { ua: 'Googlebot', verdict: 'disallowed_by_robots' },
    { ua: 'Bingbot', verdict: 'disallowed_by_robots' },
  ],
});

/** The worker's row for a 404 HTML page: answered, its links not read, no count. */
const goneRow: CrawlPage = CrawlPageSchema.parse({
  ...crawlRow({ url: GONE, outcome: 'fetched', status: 404 }),
  is_html: true,
  links_read: false,
  links_out: null,
});

const input: BuildInput = oneBatchBuild(
  HOME,
  [crawlRow({ url: HOME, outcome: 'fetched', status: 200, links_out: 2 }), disallowedRow, goneRow],
  [edge(HOME, KEPT_OUT), edge(HOME, GONE)],
);
const assembled = assemble(
  input,
  readBatches(input.batches, input.check, input.lineage.worker_release),
);
const built = buildCheck(input);

describe('a robots_disallowed row', () => {
  it('goes to the detectors’ disallowed list, with what robots.txt says to the search engines', () => {
    expect(assembled.disallowed).toEqual([
      { url: KEPT_OUT, robots_search: disallowedRow.robots_search },
    ]);
  });

  it('is never a page, though its row carries a 200', () => {
    expect(disallowedRow.status_code).toBe(200);
    expect(assembled.pages.map((p) => p.url)).not.toContain(KEPT_OUT);
    expect(built.page_results.map((p) => p.url)).not.toContain(KEPT_OUT);
    expect(built.check.coverage!.excluded_by_robots).toBe(1);
  });
});

describe('a 404 HTML row with its links unread', () => {
  it('is a page with links_read false and links_out 0, which the contract accepts', () => {
    expect(goneRow.links_out).toBeNull();
    expect(built.page_results.find((p) => p.url === GONE)).toMatchObject({
      status_code: 404,
      is_html: true,
      links_read: false,
      links_out: 0,
    });
  });
});
