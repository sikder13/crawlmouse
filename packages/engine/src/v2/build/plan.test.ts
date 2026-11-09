/**
 * The planners on hand-built crawls, one rule each, at the inputs where the rule decides: the stage-1
 * page bound when challenged pages share the homepage's template, each stage-2 trigger and pick, and
 * the crawl planner on a stopped redirect and on seeds of another host. plan.property.test.ts holds the
 * bounds over generated sites.
 */
import { describe, expect, it } from 'vitest';
import type { AccessTest, CrawlPage } from '@crawlmouse/types/v2';
import {
  accessBatch,
  accessRow,
  CHECK,
  crawlBatch,
  crawlRow,
  edge,
  SITE,
} from '../../../fixtures/v2/build/rows.js';
import { canonicalizeUrl } from '../../url-canonical.js';
import { assemble } from './assemble.js';
import { readBatches } from './batches.js';
import { MAX_TEMPLATE_KEY_LENGTH, MAX_URL_LENGTH } from '../batch-bounds.js';
import { nextCrawlBatch, sample, STAGE1_CHALLENGED, STAGE1_MAX_PAGES } from './plan.js';
import type { Seed } from './types.js';

const HOME = 'https://p.test';
const at = (path: string) => `${HOME}${path}`;

/** A crawl whose homepage links every other page, with access rows when given. */
function assembled(
  rows: CrawlPage[],
  tests: AccessTest[] = [],
  homepage = HOME,
  seeds: Seed[] = [],
) {
  const edges = rows.filter((r) => r.url !== HOME).map((r) => edge(HOME, r.url));
  const batches: unknown[] = [crawlBatch(0, rows, edges)];
  if (tests.length) batches.push(accessBatch(1, tests));
  return assemble(
    {
      check: { id: CHECK, site_id: SITE, page_cap: 500 } as never,
      homepage_url: homepage,
      seeds,
      render: null,
    },
    readBatches(batches, { id: CHECK, site_id: SITE }, 'unreleased'),
  );
}

const ok = (path: string) => crawlRow({ url: at(path), outcome: 'fetched', status: 200 });
const challenged = (path: string) =>
  crawlRow({
    url: canonicalizeUrl(at(path)),
    outcome: 'fetched',
    status: 200,
    response: 'challenged',
  });

describe('stage 1', () => {
  it(`holds ${STAGE1_MAX_PAGES} pages when challenged pages share the homepage's template`, () => {
    // A template key leaves the query out, so /?a=1 and /?b=1 are the homepage's template.
    const rows = [
      crawlRow({ url: HOME, outcome: 'fetched', status: 200 }),
      challenged('/?a=1'),
      challenged('/?b=1'),
      challenged('/?c=1'),
      ...Array.from({ length: 30 }, (_, i) => ok(`/t${i}/page-one`)),
    ];
    const s = sample(assembled(rows));
    expect(s.stage1).toHaveLength(STAGE1_MAX_PAGES);
    expect(s.stage1.filter((p) => p.picked_for === 'challenged')).toHaveLength(STAGE1_CHALLENGED);
  });
});

describe('stage 1 bounds', () => {
  // An access batch's template keys are bounded by the worker (invalid_body past it); a crawler trap
  // (/a/b/a/b/…) gives a key per depth, each longer than the last.
  // A row made on a short URL and then given a long one: the fixture's title is `Page <url>`, which a
  // URL this long would push past the title's own bound.
  const longRow = (path: string, challengedRow = false) => ({
    ...(challengedRow ? challenged('/trap') : ok('/trap')),
    url: at(path),
    final_url: at(path),
  });
  /** A path whose template key is `length` characters: `/a` segments, and one `/bb` for an odd length. */
  const keyed = (length: number) =>
    `${'/a'.repeat(Math.floor(length / 2) - (length % 2))}${length % 2 ? '/bb' : ''}`;

  it('samples a page whose template key is at the worker’s limit, and none past it', () => {
    const rows = [ok(''), ok('/plain/page'), longRow(keyed(MAX_TEMPLATE_KEY_LENGTH))];
    const at_limit = assembled(rows);
    const page = at_limit.pages.find((p) => p.url === at(keyed(MAX_TEMPLATE_KEY_LENGTH)))!;
    expect(page.template_key.length).toBe(MAX_TEMPLATE_KEY_LENGTH);
    expect(sample(at_limit).stage1.map((p) => p.url)).toContain(page.url);

    const past = assembled([
      ok(''),
      ok('/plain/page'),
      longRow(keyed(MAX_TEMPLATE_KEY_LENGTH + 1)),
    ]);
    const over = past.pages.find((p) => p.url === at(keyed(MAX_TEMPLATE_KEY_LENGTH + 1)))!;
    expect(over.template_key.length).toBe(MAX_TEMPLATE_KEY_LENGTH + 1);
    expect(sample(past).stage1.map((p) => p.url)).not.toContain(over.url);
    expect(sample(past).stage1.map((p) => p.url)).toContain(at('/plain/page'));
  });

  it('samples no challenged page whose template key is past the worker’s limit', () => {
    const path = keyed(MAX_TEMPLATE_KEY_LENGTH + 1);
    const a = assembled([ok(''), ok('/plain/page'), longRow(path, true)]);
    expect(a.pages.find((p) => p.url === at(path))!.template_key.length).toBe(
      MAX_TEMPLATE_KEY_LENGTH + 1,
    );
    expect(sample(a).stage1.map((p) => p.url)).not.toContain(at(path));
  });
});

describe('stage 2', () => {
  const site = [
    crawlRow({ url: HOME, outcome: 'fetched', status: 200 }),
    ...Array.from({ length: 8 }, (_, i) => ok(`/a/page-${i}`)),
  ];
  let id = 0;
  const rowsFor = (
    urls: string[],
    control: (u: string) => AccessTest['verdict'],
    crawler: (u: string) => AccessTest['verdict'],
  ) =>
    urls.flatMap((u) => [
      accessRow(++id, u, null, control(u), 'control'),
      accessRow(++id, u, 'OAI-SearchBot', crawler(u)),
    ]);
  const stage1 = sample(assembled(site)).stage1.map((p) => p.url);

  it('is not needed when every stage-1 verdict matches the homepage and every control is served', () => {
    const s = sample(
      assembled(
        site,
        rowsFor(
          stage1,
          () => 'allowed',
          () => 'allowed',
        ),
      ),
    );
    expect(s.stage2_needed).toBe(false);
  });

  it('is needed when a browser control was not served on a stage-1 page', () => {
    const refused = stage1.find((u) => u !== HOME)!;
    const s = sample(
      assembled(
        site,
        rowsFor(
          stage1,
          (u) => (u === refused ? 'rate_limited' : 'allowed'),
          () => 'allowed',
        ),
      ),
    );
    expect(s.stage2_needed).toBe(true);
  });

  // No homepage among the pages, and four templates, so stage 1 holds four pages.
  const noHome = ['/a/page-one', '/b/page-one', '/c/page-one', '/d/page-one'].map(ok);
  const noHomeStage1 = sample(assembled(noHome)).stage1.map((p) => p.url);

  it('compares with the first stage-1 page when the homepage is not in the sample', () => {
    expect(noHomeStage1).toHaveLength(4);
    expect(noHomeStage1).not.toContain(HOME);
    // Only the last page differs from the first, so the first is what it is compared with.
    const last = noHomeStage1[3]!;
    const s = sample(
      assembled(
        noHome,
        rowsFor(
          noHomeStage1,
          () => 'allowed',
          (u) => (u === last ? 'rate_limited' : 'allowed'),
        ),
      ),
    );
    expect(s.stage2_needed).toBe(true);
  });

  it('compares with the reference page only: one with no verdict for a crawler gives nothing to compare', () => {
    // The reference (the first stage-1 page) has a control row only; the second page differs from
    // the others, which a comparison with any of them would find.
    const tests = noHomeStage1.flatMap((u, k) => [
      accessRow(++id, u, null, 'allowed', 'control'),
      ...(k === 0
        ? []
        : [accessRow(++id, u, 'OAI-SearchBot', k === 1 ? 'rate_limited' : 'allowed')]),
    ]);
    expect(sample(assembled(noHome, tests)).stage2_needed).toBe(false);
  });

  it('picks the hubs by PageRank, then the deepest, then the newest by lastmod', () => {
    // A chain /d/deep-1 -> ... -> /d/deep-5 hangs from the homepage; /n/* carry sitemap dates.
    const deep = Array.from({ length: 12 }, (_, i) => `/d/deep-${i + 1}`);
    const dated = Array.from({ length: 8 }, (_, i) => `/n/news-${i + 1}`);
    const rows = [
      crawlRow({ url: HOME, outcome: 'fetched', status: 200 }),
      ...[...deep, ...dated].map(ok),
    ];
    const edges = [
      edge(HOME, at(deep[0]!)),
      ...deep.slice(1).map((p, i) => edge(at(deep[i]!), at(p))),
      ...dated.map((p) => edge(HOME, at(p))),
    ];
    // Dates out of URL order, so newest-first differs from listing order.
    const seeds: Seed[] = dated.map((p, i) => ({
      url: at(p),
      source: 'sitemap',
      lastmod: `2026-0${1 + ((i * 5) % 8)}-01`,
    }));
    const build = (tests: AccessTest[]) =>
      assemble(
        {
          check: { id: CHECK, site_id: SITE, page_cap: 500 } as never,
          homepage_url: HOME,
          seeds,
          render: null,
        },
        readBatches(
          [crawlBatch(0, rows, edges), ...(tests.length ? [accessBatch(1, tests)] : [])],
          { id: CHECK, site_id: SITE },
          'unreleased',
        ),
      );
    const s1 = sample(build([])).stage1.map((p) => p.url);
    const a = build(
      rowsFor(
        s1,
        () => 'allowed',
        (u) => (u === s1[1] ? 'rate_limited' : 'allowed'),
      ),
    );
    const s = sample(a);
    const why = (reason: string) =>
      s.stage2.filter((p) => p.picked_for === reason).map((p) => p.url);
    const depth = new Map(a.pages.map((p) => [p.url, p.depth]));
    const deepest = why('deepest').map((u) => depth.get(u)!);
    expect(deepest).toEqual([...deepest].sort((x, y) => y - x));
    // Every page picked after them was still there to pick, so none is deeper than the deepest picks.
    const later = s.stage2
      .slice(s.stage2.findIndex((p) => p.picked_for === 'newest'))
      .map((p) => depth.get(p.url) ?? -1);
    expect(Math.min(...deepest)).toBeGreaterThanOrEqual(Math.max(...later));
    const lastmod = new Map(a.pages.map((p) => [p.url, p.sitemap_lastmod]));
    const newest = why('newest').map((u) => lastmod.get(u)!);
    expect(newest).toEqual([...newest].sort().reverse());
    expect(why('deepest').length).toBeGreaterThan(1);
    expect(why('newest').length).toBeGreaterThan(1);
    const rank = new Map(a.pages.map((p) => [p.url, p.pagerank_share ?? -1]));
    const hubs = why('hub').map((u) => rank.get(u)!);
    expect(hubs).toEqual([...hubs].sort((x, y) => y - x));
    // The hubs are the highest-ranked pages left: every page picked after them ranks no higher.
    const afterHubs = s.stage2.filter((p) => p.picked_for !== 'hub').map((p) => rank.get(p.url)!);
    expect(Math.min(...hubs)).toBeGreaterThanOrEqual(Math.max(...afterHubs));
    expect(s.stage2.length).toBeGreaterThan(0);
  });
});

describe('nextCrawlBatch', () => {
  it("plans a stopped redirect's target, which the batch never requested", () => {
    const stopped = crawlRow({
      url: at('/a/moved-page'),
      outcome: 'fetched',
      status: 301,
      final_url: at('/b/target-page'),
    });
    const batch = crawlBatch(
      0,
      [crawlRow({ url: HOME, outcome: 'fetched', status: 200 }), stopped],
      [],
      [at('/b/target-page')],
    );
    expect(
      nextCrawlBatch([{ url: HOME, source: 'homepage', lastmod: null }], [batch], 500),
    ).toEqual([at('/b/target-page')]);
  });

  it('crawls no sitemap seed of another host, and coverage does not count one as discovered', () => {
    const seeds: Seed[] = [
      { url: HOME, source: 'homepage', lastmod: null },
      { url: 'https://www.p.test/x/elsewhere', source: 'sitemap', lastmod: null },
    ];
    const a = assembled(
      [crawlRow({ url: HOME, outcome: 'fetched', status: 200 })],
      [],
      HOME,
      seeds,
    );
    expect(a.coverage.pages_discovered).toBe(1);
    expect(
      nextCrawlBatch(
        seeds,
        [crawlBatch(0, [crawlRow({ url: HOME, outcome: 'fetched', status: 200 })])],
        500,
      ),
    ).toBeNull();
  });

  // The worker refuses a whole batch holding one URL off the site's default port (jwt_scope,
  // packages/worker/src/server.ts), so a crawled link such as a leftover dev link must not be planned.
  it('plans no discovered link on another port, nor the www twin’s, and coverage does not count one', () => {
    const ported = [
      'https://p.test:8443/admin',
      'http://www.p.test:8080/',
      'https://p.test:443/kept',
    ];
    const batch = crawlBatch(
      0,
      [crawlRow({ url: HOME, outcome: 'fetched', status: 200 })],
      [],
      [...ported, at('/ok')],
    );
    const seeds: Seed[] = [{ url: HOME, source: 'homepage', lastmod: null }];
    // https://p.test:443/kept is the default port written out: the URL parser drops it.
    expect(nextCrawlBatch(seeds, [batch], 500)).toEqual([at('/kept'), at('/ok')]);
    const a = assemble(
      {
        check: { id: CHECK, site_id: SITE, page_cap: 500 } as never,
        homepage_url: HOME,
        seeds,
        render: null,
      },
      readBatches([batch], { id: CHECK, site_id: SITE }, 'unreleased'),
    );
    expect(a.coverage.pages_discovered).toBe(3);
  });

  // The worker refuses a whole batch holding a URL over its request limit (invalid_body), and a
  // sitemap's <loc> can be any length.
  it('plans a URL at the worker’s URL limit, and none past it, from a sitemap or a link', () => {
    // HOME is 14 characters and the path's slash one more.
    const of = (length: number, tail: string) =>
      at(`/${tail}${'x'.repeat(length - HOME.length - 1 - tail.length)}`);
    const seedAt = of(MAX_URL_LENGTH, 's');
    const seedPast = of(MAX_URL_LENGTH + 1, 's');
    const linkAt = of(MAX_URL_LENGTH, 'l');
    const linkPast = of(MAX_URL_LENGTH + 1, 'l');
    for (const [u, n] of [
      [seedAt, MAX_URL_LENGTH],
      [seedPast, MAX_URL_LENGTH + 1],
      [linkAt, MAX_URL_LENGTH],
      [linkPast, MAX_URL_LENGTH + 1],
    ] as const)
      expect(canonicalizeUrl(u).length).toBe(n);
    const seeds: Seed[] = [
      { url: HOME, source: 'homepage', lastmod: null },
      { url: seedAt, source: 'sitemap', lastmod: null },
      { url: seedPast, source: 'sitemap', lastmod: null },
    ];
    const batch = crawlBatch(
      0,
      [crawlRow({ url: HOME, outcome: 'fetched', status: 200 })],
      [],
      [linkAt, linkPast],
    );
    expect(nextCrawlBatch(seeds, [batch], 500)).toEqual([seedAt, linkAt]);
  });

  it('crawls no sitemap seed on another port', () => {
    const seeds: Seed[] = [
      { url: HOME, source: 'homepage', lastmod: null },
      { url: 'https://p.test:8443/x/ported', source: 'sitemap', lastmod: null },
    ];
    expect(nextCrawlBatch(seeds, [], 500)).toEqual([HOME]);
  });
});
