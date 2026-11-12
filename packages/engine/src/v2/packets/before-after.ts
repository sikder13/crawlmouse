/**
 * The before and after rows of a fix (CC-30 D7): a row for each measure of the contract the fix's
 * record holds, and none for the rest. `after` is what the fix's counterfactual gives, taken from the
 * function the effect is computed with (grade/effects.ts), so the row and the effect cannot say
 * different things about the same fix.
 *
 * `BEFORE_AFTER_RULES` has a key for each `FixType` (the mapped type), so a fix type with no rule does
 * not compile; the spec renders the table from it, and before-after.test.ts holds each type's rows to
 * the measures its rule names.
 */
import type { CrawlerRegistryEntry, Fix, FixType } from '@crawlmouse/types/v2';
import { CRAWLER_REGISTRY_V2 } from '../crawler-registry.js';
import type { RenderedDetection } from '../detectors/rendered.js';
import { allPassing, servedAll, type FixRecord } from '../grade/effects.js';
import { median } from '../grade/numbers.js';
import type { PacketFacts } from './types.js';

type Row = Fix['before_after'][number];
type Measure = Row['measure'];

export interface BeforeAfterRule {
  /** The measures a fix of the type has a row for, in the rows' order. */
  measures: readonly Measure[];
  /** How the rows are computed, or why there is none, for the spec. */
  rule: string;
}

const NO_MEASURE = (what: string): BeforeAfterRule => ({
  measures: [],
  rule: `No row. The fix changes ${what}, and the contract's four measures (words without JavaScript, crawlers reading the text, a quotable opening, the text share) do not measure that.`,
});

const NO_FIX: BeforeAfterRule = {
  measures: [],
  rule: 'No row. The engine opens no fix of this type.',
};

export const BEFORE_AFTER_RULES: { readonly [T in FixType]: BeforeAfterRule } = {
  robots_txt_blocks_crawler: NO_FIX,
  edge_rule_blocks_crawler: {
    measures: ['crawlers_reading_text'],
    rule: 'Today: the AI crawlers (the registry’s `ai_search` and `ai_training` groups) whose verdict for the site is `allowed`, which is the count the fix page prints against the AI crawlers tested. After: the counterfactual serves the crawler, `allowed`, on the pages the rule blocked it on (`servedAll`), so the crawler is added when it is not counted today, and the bound is `approx`: whether it then reads the text depends on what those pages serve, which the blocked requests could not show. A crawler counted today stays counted and the bound is `exact`.',
  },
  client_rendered_template: {
    measures: ['words_without_js', 'text_share'],
    rule: 'From the template’s rendered pages (`evidence.pages`). Words without JavaScript: today the median `raw_words`, after the median `rendered_words`, `approx` because a server render need not hold the same words a browser shows. Text share: today the record’s `measured` (the median share), after 1, `approx` for the same reason. No row for crawlers reading the text: the fix’s counterfactual changes the text share and no crawler’s verdict.',
  },
  orphan_pages: NO_MEASURE('the links to a page'),
  quotable_opening: {
    measures: ['quotable_opening'],
    rule: 'A yes or no for a page the fix names. Today: no, since each page it names fails the check (`extent.failing`). After: yes, since the counterfactual passes each failing page (`allPassing`: passing + failing = the pages decided), which is also what the fix landing means, so the bound is `exact`. Pages the check could not read (`extent.unread`) are not spoken for.',
  },
  generic_anchor_text: NO_MEASURE('the text of links'),
  deep_pages: NO_MEASURE('the links to a page'),
  specs_as_images: NO_MEASURE(
    'how specifications are given, which the content check answers with a pass or a fail',
  ),
  missing_author_date: NO_MEASURE(
    'the byline and the date, which the content check answers with a pass or a fail',
  ),
  js_only_navigation: NO_FIX,
  redirect_chain: NO_MEASURE('where links point'),
  duplicate_pagination: NO_MEASURE('the later pages of a paginated list'),
  canonical_mismatch: NO_MEASURE('a canonical annotation'),
  hreflang_gap: NO_MEASURE('hreflang annotations'),
  missing_schema_description: NO_MEASURE(
    'schema.org markup, which the content check answers with a pass or a fail',
  ),
  no_question_headings: NO_MEASURE(
    'section headings, which the content check answers with a pass or a fail',
  ),
};

const row = (
  measure: Measure,
  today: Row['today'],
  after: Row['after'],
  after_bound: Row['after_bound'],
): Row => ({
  measure,
  today,
  after,
  after_bound,
  after_is_estimate: true,
});

type AccessRecord = Extract<FixRecord, { family: 'access' }>['record'];
type ContentRecord = Extract<FixRecord, { family: 'content' }>['record'];

function crawlersReadingText(
  record: AccessRecord,
  facts: Pick<PacketFacts, 'crawlers'>,
  registry: readonly CrawlerRegistryEntry[],
): Row[] {
  if (record.extent === null) return [];
  const ai = new Set(registry.filter((e) => e.group !== 'search_engine').map((e) => e.token));
  const reading = facts.crawlers.filter((c) => ai.has(c.ua) && c.verdict === 'allowed');
  const today = reading.length;
  // A crawler outside those groups is not one the row counts.
  if (!ai.has(record.crawler)) return [];
  if (reading.some((c) => c.ua === record.crawler)) {
    return [row('crawlers_reading_text', today, today, 'exact')];
  }
  // The pages the rule holds on, through the counterfactual the effect applies to the crawler's tally.
  const served = servedAll({
    ua: record.crawler,
    scored: record.scored,
    counts: { blocked_by_ua_rule: record.extent.matching },
    extent: {
      robots: { disallowed: 0, read: record.extent.of },
      edge: { blocked: record.extent.matching, served: 0, answered: record.extent.of },
    },
  });
  const reads = (served.counts.allowed ?? 0) > 0 && (served.counts.blocked_by_ua_rule ?? 0) === 0;
  return [row('crawlers_reading_text', today, today + (reads ? 1 : 0), reads ? 'approx' : 'exact')];
}

function quotableOpening(record: ContentRecord): Row[] {
  const { failing, of } = record.extent;
  if (failing === 0) return [];
  const after = allPassing({ passing: of - failing }, failing);
  return [row('quotable_opening', false, after.passing === of, 'exact')];
}

/** The text share of a template once it is rendered on the server: the whole text. */
export const SERVER_RENDERED_SHARE = 1;

/**
 * The rows of a client-rendered template, from the record's rendered pages; none when no page was
 * rendered or the record holds no measured share. The check builder calls it for the rendered family.
 */
export function renderedBeforeAfter(record: RenderedDetection): Row[] {
  const { pages } = record.evidence;
  if (pages.length === 0 || record.measured === null) return [];
  return [
    row(
      'words_without_js',
      median(pages.map((p) => p.raw_words)),
      median(pages.map((p) => p.rendered_words)),
      'approx',
    ),
    row('text_share', record.measured, SERVER_RENDERED_SHARE, 'approx'),
  ];
}

export function beforeAfterOf(
  fix: FixRecord,
  facts: PacketFacts,
  registry: readonly CrawlerRegistryEntry[] = CRAWLER_REGISTRY_V2,
): Fix['before_after'] {
  if (fix.family === 'access') {
    return fix.record.type === 'edge_rule_blocks_crawler'
      ? crawlersReadingText(fix.record, facts, registry)
      : [];
  }
  if (fix.family === 'content') {
    return fix.record.type === 'quotable_opening' ? quotableOpening(fix.record) : [];
  }
  return [];
}
