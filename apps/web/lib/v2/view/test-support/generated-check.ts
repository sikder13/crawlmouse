/**
 * Generated sites for the real-data tests (fast-check): a shape of a crawl, and the BuildInput the
 * engine's builder takes for it, made with the engine's own row helpers
 * (packages/engine/fixtures/v2/build/rows.ts), so each row is one the worker's contract accepts.
 *
 * What a shape varies: how the homepage answered (served, an error, not requested, a redirect to
 * another host); zero to thirty further pages in four URL families, each served, gone, failing,
 * redirected, disallowed, not requested or not HTML, with or without content features (and those
 * client-rendered or not); the links between them; a crawl stopped by its request budget; and the
 * crawler tests: none, or one answer per tested AI crawler (allowed, rate limited, challenged, refused
 * as unverified, payment required) on each sampled page.
 */
import {
  assemble,
  buildCheck,
  readBatches,
  sample,
  type BuildInput,
  type BuiltCheck,
} from '@crawlmouse/engine/v2/pipeline';
import {
  AccessTestSchema,
  CrawlPageSchema,
  type AccessTest,
  type CrawlPage,
} from '@crawlmouse/types/v2';
import fc from 'fast-check';
import {
  accessBatch,
  accessRow,
  CHECK,
  crawlBatch,
  crawlRow,
  edge,
  oneBatchBuild,
} from '../../../../../../packages/engine/fixtures/v2/build/rows';

export const GENERATED_HOME = 'https://generated-site.test';
export const GENERATED_CHECK = CHECK;
export const GENERATED_RECHECK = 'c0000000-0000-4000-8000-00000000b0c2';

const HOME_ANSWERS = ['ok', 'error', 'not_requested', 'offhost'] as const;
const PAGE_ANSWERS = [
  'ok',
  'ok',
  'ok',
  'ok',
  'ok',
  'ok',
  'gone',
  'error',
  'redirect',
  'disallowed',
  'not_requested',
  'not_html',
] as const;
const FEATURES = ['none', 'server', 'client'] as const;
/**
 * The crawlers an access batch must test: the AI crawlers of the engine's registry, read from a
 * check built with no access batch (the builder refuses a batch that leaves one of them out).
 */
export const TESTED_UAS: readonly string[] = buildCheck(
  oneBatchBuild('https://registry-probe.test', [
    crawlRow({ url: 'https://registry-probe.test', outcome: 'fetched', status: 200 }),
  ]),
)
  .check.crawlers.filter((c) => c.group !== 'search_engine')
  .map((c) => c.ua);
/** What a generated crawler test answered: a verdict with the cause and status the contract pairs with it. */
const ANSWERS = {
  allowed: { cause: null, raw_status: 200 },
  rate_limited: { cause: 'rate_limit_429', raw_status: 429 },
  challenged_ua: { cause: 'automation_challenge', raw_status: 403 },
  refused_unverified: { cause: null, raw_status: 403 },
  payment_required: { cause: 'pay_per_crawl_402', raw_status: 402 },
} as const satisfies Partial<
  Record<AccessTest['verdict'], Pick<AccessTest, 'cause' | 'raw_status'>>
>;
const VERDICTS = Object.keys(ANSWERS) as (keyof typeof ANSWERS)[];

export interface SiteShape {
  home: (typeof HOME_ANSWERS)[number];
  pages: {
    family: number;
    answer: (typeof PAGE_ANSWERS)[number];
    features: (typeof FEATURES)[number];
  }[];
  /** Links by index: 0 is the homepage, i + 1 is `pages[i]`. */
  links: [from: number, to: number][];
  /** The crawl batch stopped on its request budget. */
  capped: boolean;
  /** One verdict per tested crawler, the same on each sampled page; null runs no crawler test. */
  access: (typeof VERDICTS)[number][] | null;
}

export const siteShape: fc.Arbitrary<SiteShape> = fc.integer({ min: 0, max: 30 }).chain((n) =>
  fc.record({
    home: fc.constantFrom(...HOME_ANSWERS, 'ok', 'ok', 'ok'),
    pages: fc.array(
      fc.record({
        family: fc.nat(3),
        answer: fc.constantFrom(...PAGE_ANSWERS),
        features: fc.constantFrom(...FEATURES),
      }),
      { minLength: n, maxLength: n },
    ),
    links: fc.array(fc.tuple(fc.nat(n), fc.nat(n)), { maxLength: 90 }),
    capped: fc.boolean(),
    access: fc.option(
      fc.array(fc.constantFrom(...VERDICTS), {
        minLength: TESTED_UAS.length,
        maxLength: TESTED_UAS.length,
      }),
      { nil: null },
    ),
  }),
);

const FAMILY = ['/p/item-', '/blog/post-', '/about-', '/docs/guide/part-'];
const urlOf = (shape: SiteShape, i: number) =>
  i === 0 ? GENERATED_HOME : `${GENERATED_HOME}${FAMILY[shape.pages[i - 1]!.family]}${i}`;

const featuresOf = (clientRendered: boolean) => ({
  has_h1: true,
  words_after_h1: 60,
  opening: [],
  headings: { count: 3, questions: 1, section_questions: 1 },
  json_ld: [],
  byline: {
    meta_author: false,
    published_time: false,
    rel_author: false,
    itemprop_author: false,
    itemprop_date: false,
    time_datetime: false,
  },
  specs: { structured: 0, label_value_lines: 0, spec_images: 0 },
  client_rendered: clientRendered,
});

function rowOf(shape: SiteShape, i: number, linksOut: number): CrawlPage {
  const url = urlOf(shape, i);
  if (i === 0) {
    if (shape.home === 'not_requested') return crawlRow({ url, outcome: 'not_requested' });
    if (shape.home === 'error') return crawlRow({ url, outcome: 'fetched', status: 503 });
    if (shape.home === 'offhost')
      return crawlRow({
        url,
        outcome: 'fetched',
        status: 200,
        final_url: 'https://elsewhere.test/',
        links_out: 0,
      });
    return crawlRow({ url, outcome: 'fetched', status: 200, links_out: linksOut });
  }
  const page = shape.pages[i - 1]!;
  switch (page.answer) {
    case 'gone':
      return crawlRow({ url, outcome: 'fetched', status: 404 });
    case 'error':
      return crawlRow({ url, outcome: 'fetched', status: 500 });
    case 'disallowed':
      return crawlRow({ url, outcome: 'robots_disallowed' });
    case 'not_requested':
      return crawlRow({ url, outcome: 'not_requested' });
    case 'not_html':
      return crawlRow({ url, outcome: 'fetched', status: 200, html: false });
    case 'redirect':
      return crawlRow({
        url,
        outcome: 'fetched',
        status: 200,
        final_url: `${GENERATED_HOME}/landed/from-${i}`,
        links_out: 0,
      });
    case 'ok': {
      const row = crawlRow({ url, outcome: 'fetched', status: 200, links_out: linksOut });
      return page.features === 'none'
        ? row
        : CrawlPageSchema.parse({
            ...row,
            content_features: featuresOf(page.features === 'client'),
          });
    }
  }
}

/** Whether the row at `i` is a served HTML page at its own URL, whose links the worker records. */
const servesLinks = (shape: SiteShape, i: number) =>
  i === 0 ? shape.home === 'ok' : shape.pages[i - 1]!.answer === 'ok';

/** The BuildInput of `shape`: one crawl batch, and an access batch over the builder's own sample. */
export function inputOf(shape: SiteShape): BuildInput {
  const n = shape.pages.length + 1;
  const pairs = new Map<string, [number, number]>();
  for (const [from, to] of shape.links) {
    if (from !== to && from < n && to < n && servesLinks(shape, from))
      pairs.set(`${from}>${to}`, [from, to]);
  }
  const edges = [...pairs.values()].map(([from, to]) => edge(urlOf(shape, from), urlOf(shape, to)));
  const linksOut = (i: number) => edges.filter((e) => e.from_url === urlOf(shape, i)).length;
  const rows = Array.from({ length: n }, (_, i) => rowOf(shape, i, linksOut(i)));
  const base = oneBatchBuild(GENERATED_HOME, rows, edges);
  const crawl = crawlBatch(
    0,
    rows,
    edges,
    [],
    shape.capped ? { reasons: ['budget_requests'] } : null,
  );
  const batches: unknown[] = [crawl];
  if (shape.access) {
    const planned = sample(
      assemble({ ...base, batches } as BuildInput, readBatches(batches, base.check, 'unreleased')),
    );
    let id = 0;
    const tests = planned.stage1.flatMap((p) => [
      accessRow(++id, p.url, null, 'allowed', 'control'),
      ...TESTED_UAS.map((ua, k) => {
        const verdict = shape.access![k]!;
        return AccessTestSchema.parse({
          ...accessRow(++id, p.url, ua, verdict),
          ...ANSWERS[verdict],
        });
      }),
    ]);
    if (tests.length) batches.push(accessBatch(1, tests));
  }
  return { ...base, batches };
}

/** `shape` crawled again as the site's next check, after `first`. */
export function recheckInputOf(shape: SiteShape, first: BuiltCheck): BuildInput {
  const input = inputOf(shape);
  return {
    ...input,
    check: {
      ...input.check,
      id: GENERATED_RECHECK,
      previous_check_id: first.check.id,
      trigger: 'scheduled',
      queued_at: '2026-11-06T10:00:00Z',
      started_at: '2026-11-06T10:00:02Z',
      finished_at: '2026-11-06T10:11:00Z',
    },
    previous: { check: first.check, ...first.diff_inputs },
    fixes: first.fixes,
    events: first.fix_events,
    batches: JSON.parse(
      JSON.stringify(input.batches).replaceAll(GENERATED_CHECK, GENERATED_RECHECK),
    ) as unknown[],
    now: '2026-11-06T10:11:00Z',
  };
}
