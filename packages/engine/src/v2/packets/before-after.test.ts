import { BeforeAfterSchema, FixTypeSchema, type CrawlerRegistryEntry } from '@crawlmouse/types/v2';
import { describe, expect, it } from 'vitest';
import { CRAWLER_REGISTRY_V2 } from '../crawler-registry.js';
import { allPassing, applyFix, servedAll, type FixRecord } from '../grade/effects.js';
import type { CrawlerTally } from '../grade/access.js';
import { BEFORE_AFTER_RULES, beforeAfterOf, renderedBeforeAfter } from './before-after.js';
import { NO_STACK } from './test-support/facts.js';
import {
  accessRecord,
  contentRecord,
  renderedRecord,
  structureRecord,
} from './test-support/records.js';
import type { PacketFacts } from './types.js';

type Verdict = PacketFacts['crawlers'][number]['verdict'];

/** Facts in which each crawler named has the verdict given, and each other registry crawler is allowed. */
const factsWith = (verdicts: Record<string, Verdict> = {}): PacketFacts => ({
  homepage_url: 'https://a.test',
  stack: NO_STACK,
  crawlers: CRAWLER_REGISTRY_V2.map((e) => ({
    ua: e.token,
    verdict: verdicts[e.token] ?? 'allowed',
  })),
  pages: new Map(),
  edges: [],
  access_tests: [],
});

const AI = CRAWLER_REGISTRY_V2.filter((e) => e.group !== 'search_engine').map((e) => e.token);
const edge = (crawler: string, extent = { matching: 4, of: 4 }): FixRecord => ({
  family: 'access',
  record: accessRecord(crawler, extent),
});

describe('BEFORE_AFTER_RULES', () => {
  it('has a rule for each fix type, and for nothing else', () => {
    expect(Object.keys(BEFORE_AFTER_RULES).sort()).toEqual([...FixTypeSchema.options].sort());
    for (const type of FixTypeSchema.options) {
      expect(BEFORE_AFTER_RULES[type].rule.length, type).toBeGreaterThan(20);
    }
  });

  it('names measures for three types, counted by hand, and none for the rest', () => {
    const withRows = FixTypeSchema.options.filter((t) => BEFORE_AFTER_RULES[t].measures.length > 0);
    expect(withRows.sort()).toEqual([
      'client_rendered_template',
      'edge_rule_blocks_crawler',
      'quotable_opening',
    ]);
  });
});

describe('beforeAfterOf: an edge rule that blocks a crawler', () => {
  it('the registry has six AI crawlers, the count the fix page prints the row against', () => {
    expect(AI).toHaveLength(6);
  });

  it('today counts the AI crawlers whose site verdict is allowed; after adds the one the rule blocks', () => {
    const facts = factsWith({ GPTBot: 'blocked_by_ua_rule', ClaudeBot: 'allowed_thin' });
    // Six AI crawlers; GPTBot is blocked and ClaudeBot is let in without its text: four read the text.
    expect(beforeAfterOf(edge('GPTBot'), facts)).toEqual([
      {
        measure: 'crawlers_reading_text',
        today: 4,
        after: 5,
        after_bound: 'approx',
        after_is_estimate: true,
      },
    ]);
  });

  it('does not count a search engine, which is read from robots.txt and not requested as', () => {
    const search = CRAWLER_REGISTRY_V2.filter((e) => e.group === 'search_engine');
    expect(search.length).toBeGreaterThan(0);
    const blockedSearch = Object.fromEntries(
      search.map((e) => [e.token, 'disallowed_by_robots' as const]),
    );
    const [row] = beforeAfterOf(edge('GPTBot'), factsWith({ GPTBot: 'blocked_by_ua_rule' }));
    const [same] = beforeAfterOf(
      edge('GPTBot'),
      factsWith({ GPTBot: 'blocked_by_ua_rule', ...blockedSearch }),
    );
    expect(row).toMatchObject({ today: 5, after: 6 });
    expect(same).toEqual(row);
  });

  it('counts a crawler let in without its text as not reading it, today', () => {
    const [row] = beforeAfterOf(
      edge('GPTBot'),
      factsWith({
        GPTBot: 'blocked_by_ua_rule',
        PerplexityBot: 'allowed_thin',
        ClaudeBot: 'challenged_ua',
      }),
    );
    expect(row).toMatchObject({ today: 3, after: 4 });
  });

  it('adds nothing, exactly, when the crawler already reads the text on most pages', () => {
    // A rule on half its pages is detected while the site verdict stays allowed.
    const [row] = beforeAfterOf(edge('GPTBot', { matching: 2, of: 4 }), factsWith());
    expect(row).toEqual({
      measure: 'crawlers_reading_text',
      today: 6,
      after: 6,
      after_bound: 'exact',
      after_is_estimate: true,
    });
  });

  it('takes `after` from the counterfactual the effect is computed with (servedAll), not a second rule', () => {
    const record = accessRecord('GPTBot', { matching: 4, of: 4 });
    const facts = factsWith({ GPTBot: 'blocked_by_ua_rule' });
    const [row] = beforeAfterOf({ family: 'access', record }, facts);
    // The same tally through the function applyFix applies: the blocked pages are served, allowed.
    const tally: CrawlerTally = {
      ua: 'GPTBot',
      scored: false,
      counts: { blocked_by_ua_rule: 4 },
      extent: { robots: { disallowed: 0, read: 4 }, edge: { blocked: 4, served: 0, answered: 4 } },
    };
    const served = servedAll(tally);
    expect(served.counts).toEqual({ blocked_by_ua_rule: 0, allowed: 4 });
    const applied = applyFix(
      {
        seo: undefined as never,
        ai: {
          crawlers: [tally],
          readable: undefined as never,
          quotable: { checks: {} },
          signals: undefined as never,
        },
      },
      { family: 'access', record },
    );
    expect(applied.ai.crawlers[0]).toEqual(served);
    const reads = (served.counts.allowed ?? 0) > 0 && (served.counts.blocked_by_ua_rule ?? 0) === 0;
    expect(row!.after).toBe(Number(row!.today) + (reads ? 1 : 0));
    // Independently: five of the six AI crawlers read the text today, and GPTBot makes six.
    expect([row!.today, row!.after]).toEqual([5, 6]);
  });

  it('writes no row for a record with no judged pages', () => {
    expect(beforeAfterOf(edge('GPTBot', null as never), factsWith())).toEqual([]);
  });

  it('writes no row for a crawler outside the AI groups', () => {
    const facts = factsWith({ Googlebot: 'blocked_by_ua_rule' });
    expect(beforeAfterOf(edge('Googlebot'), facts)).toEqual([]);
  });

  it('reads the registry it is given: a crawler it does not list is not counted', () => {
    const registry: CrawlerRegistryEntry[] = CRAWLER_REGISTRY_V2.filter(
      (e) => e.token !== 'ClaudeBot',
    );
    const [row] = beforeAfterOf(
      edge('GPTBot'),
      factsWith({ GPTBot: 'blocked_by_ua_rule' }),
      registry,
    );
    expect(row).toMatchObject({ today: 4, after: 5 });
  });
});

describe('beforeAfterOf: a template whose opening is not quotable', () => {
  const fix = (extent = { failing: 3, of: 10, unread: 0 }): FixRecord => ({
    family: 'content',
    record: contentRecord('direct_answer_150', extent),
  });

  it('a page the fix names has no quotable opening today, and has one after', () => {
    expect(beforeAfterOf(fix(), factsWith())).toEqual([
      {
        measure: 'quotable_opening',
        today: false,
        after: true,
        after_bound: 'exact',
        after_is_estimate: true,
      },
    ]);
  });

  it('takes `after` from the counterfactual the effect is computed with (allPassing)', () => {
    const f = fix({ failing: 3, of: 10, unread: 2 });
    if (f.family !== 'content') throw new Error(f.family);
    const tally = { passing: 7, decided: 10, unread: 2 };
    // applyFix on the same tally, with the check counted: each failing page passes.
    const applied = applyFix(
      {
        seo: undefined as never,
        ai: {
          crawlers: [],
          readable: undefined as never,
          quotable: { checks: { direct_answer_150: tally } },
          signals: undefined as never,
        },
      },
      f,
      new Set(['direct_answer_150']),
    );
    expect(applied.ai.quotable.checks.direct_answer_150).toEqual(allPassing(tally, 3));
    // Independently: 7 passing and 3 failing make 10 of 10 decided pages.
    expect(allPassing(tally, 3)).toEqual({ passing: 10, decided: 10, unread: 2 });
    expect(beforeAfterOf(f, factsWith())[0]!.after).toBe(allPassing(tally, 3).passing === 10);
  });

  it('writes no row when no page fails', () => {
    expect(beforeAfterOf(fix({ failing: 0, of: 10, unread: 0 }), factsWith())).toEqual([]);
  });

  it('writes no row for the other content checks: no measure of the contract is theirs', () => {
    for (const check of [
      'question_headings',
      'schema_with_description',
      'author_and_date',
      'specs_as_text',
    ] as const) {
      const record = contentRecord(check);
      expect(beforeAfterOf({ family: 'content', record }, factsWith()), check).toEqual([]);
      expect(BEFORE_AFTER_RULES[record.type].measures, check).toEqual([]);
    }
  });
});

describe('beforeAfterOf: the structure fixes', () => {
  it('writes no row: the contract has no measure for a link, a redirect or an annotation', () => {
    for (const type of [
      'orphan_pages',
      'deep_pages',
      'generic_anchor_text',
      'redirect_chain',
      'duplicate_pagination',
      'canonical_mismatch',
      'hreflang_gap',
    ] as const) {
      expect(
        beforeAfterOf({ family: 'structure', record: structureRecord(type) }, factsWith()),
        type,
      ).toEqual([]);
      expect(BEFORE_AFTER_RULES[type].measures, type).toEqual([]);
    }
  });
});

describe('renderedBeforeAfter: a client-rendered template', () => {
  const pages = [
    { url: 'https://a.test/products/a', raw_words: 120, rendered_words: 1000, text_share: 0.12 },
    { url: 'https://a.test/products/b', raw_words: 134, rendered_words: 1120, text_share: 0.1196 },
    { url: 'https://a.test/products/c', raw_words: 150, rendered_words: 1300, text_share: 0.1154 },
  ];

  it('words: the median without JavaScript today, the median rendered after, approximately', () => {
    const [words] = renderedBeforeAfter(renderedRecord(pages, 0.1196));
    expect(words).toEqual({
      measure: 'words_without_js',
      today: 134,
      after: 1120,
      after_bound: 'approx',
      after_is_estimate: true,
    });
  });

  it('a rendered fix carries those rows, and its share after is the one the effect is computed with', () => {
    const record = renderedRecord(pages, 0.1196);
    const fix: FixRecord = { family: 'rendered', record };
    const rows = beforeAfterOf(fix, factsWith());
    expect(rows).toEqual(renderedBeforeAfter(record));
    const readable = [{ template_key: record.template_key, text_share: 0.1196 }];
    const after = applyFix(
      {
        seo: undefined as never,
        ai: { crawlers: [], readable, quotable: { checks: {} }, signals: undefined as never },
      },
      fix,
    );
    expect(rows[1]!.after).toBe(after.ai.readable[0]!.text_share);
  });

  it('text share: the record’s measured share today, the whole text after, approximately', () => {
    const [, share] = renderedBeforeAfter(renderedRecord(pages, 0.1196));
    expect(share).toEqual({
      measure: 'text_share',
      today: 0.1196,
      after: 1,
      after_bound: 'approx',
      after_is_estimate: true,
    });
  });

  it('takes the mean of the middle two of an even number of pages, as the grade’s median does', () => {
    const [words] = renderedBeforeAfter(renderedRecord([pages[0]!, pages[1]!], 0.12));
    expect([words!.today, words!.after]).toEqual([127, 1060]);
  });

  it('writes the rows its rule names, in that order, and no crawler row', () => {
    const rows = renderedBeforeAfter(renderedRecord(pages, 0.1196));
    expect(rows.map((r) => r.measure)).toEqual(
      BEFORE_AFTER_RULES.client_rendered_template.measures,
    );
    expect(rows.map((r) => r.measure)).not.toContain('crawlers_reading_text');
  });

  it('writes no row without a rendered page, or without a measured share', () => {
    expect(renderedBeforeAfter(renderedRecord([], null))).toEqual([]);
    expect(renderedBeforeAfter(renderedRecord(pages, null))).toEqual([]);
  });
});

describe('every row written', () => {
  it('is one the contract accepts, of a measure its type’s rule names', () => {
    const cases: [FixRecord, PacketFacts][] = [
      [edge('GPTBot'), factsWith({ GPTBot: 'blocked_by_ua_rule' })],
      [{ family: 'content', record: contentRecord('direct_answer_150') }, factsWith()],
    ];
    for (const [fix, facts] of cases) {
      const rows = beforeAfterOf(fix, facts);
      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) expect(BeforeAfterSchema.safeParse(row).success).toBe(true);
      expect(rows.map((r) => r.measure)).toEqual(BEFORE_AFTER_RULES[fix.record.type].measures);
    }
  });
});
