/**
 * The values on the audit-flow screens that come from a check: by element, the screens that show
 * it and the fixture fields it is read from. SPEC 22 renders this table.
 *
 * __tests__/v2/perturbation.test.tsx changes each field an entry lists, one at a time, in a copy of
 * a contract fixture, and requires each screen the entry names to show the new value where it did
 * not before. That file also fails when an entry lists a field, or a screen, that no change shows.
 * Verify: `pnpm --filter @crawlmouse/web exec vitest run __tests__/v2/perturbation.test.tsx`.
 */
export type Screen = 'Home' | 'Result' | 'Crawl';

export interface InventoryEntry {
  id: string;
  /** The screens, as SPEC 22 prints them: `screenList` joined. */
  screens: string;
  element: string;
  /** The fields, as SPEC 22 prints them: `fieldList` joined. */
  field: string;
  screenList: readonly Screen[];
  fieldList: readonly string[];
}

function entry(
  id: string,
  screenList: readonly Screen[],
  element: string,
  fieldList: readonly string[],
): InventoryEntry {
  return {
    id,
    screens: screenList.join(', '),
    element,
    field: fieldList.join(', '),
    screenList,
    fieldList,
  };
}

export const INVENTORY: InventoryEntry[] = [
  entry('domain', ['Home', 'Result', 'Crawl'], 'The site', ['sites[].host']),
  entry('crawl-time', ['Home', 'Crawl'], 'How long the crawl took', [
    'checks[].started_at',
    'checks[].finished_at',
  ]),
  entry(
    'crawled-at',
    ['Result'],
    'When it was crawled; until when an unkept result is kept (expires_at, or finished_at + 24 h)',
    ['checks[].finished_at', 'checks[].expires_at'],
  ),
  entry('pages-crawled', ['Result'], 'Pages crawled', ['checks[].coverage.pages_crawled']),
  entry('pages-found', ['Home', 'Result'], 'Pages found', ['checks[].coverage.pages_discovered']),
  entry(
    'template-size',
    ['Home', 'Result', 'Crawl'],
    'Pages sharing a template; on Home and Crawl, the pages crawled, which the replay makes template by template',
    ['checks[].coverage.templates[].pages'],
  ),
  entry('links', ['Home', 'Result', 'Crawl'], 'Links', ['checks[].structure.internal_links']),
  entry('seo', ['Home', 'Result', 'Crawl'], 'Technical SEO letter and score', [
    'checks[].technical_seo.grade',
    'checks[].technical_seo.score',
  ]),
  entry('ai', ['Home', 'Result', 'Crawl'], 'AI readability letter and score', [
    'checks[].ai_readability.grade',
    'checks[].ai_readability.total',
  ]),
  entry('ai-withheld', ['Result', 'Crawl'], 'The access range, when AI readability is withheld', [
    'checks[].ai_readability.access_range',
  ]),
  entry('verdicts', ['Home', 'Result', 'Crawl'], 'Crawler verdicts and the sentences about them', [
    'checks[].crawlers[].verdict',
    'checks[].crawlers[].evidence_class',
    'checks[].crawlers[].by_template',
  ]),
  entry(
    'obstacle',
    ['Home', 'Result'],
    'What is in the way of a crawler, and what the fix for it changes',
    ['checks[].crawlers[].cause'],
  ),
  entry('text-share', ['Home', 'Result', 'Crawl'], 'Text a crawler can read', [
    'checks[].crawlers[].text_share',
  ]),
  entry('words', ['Home'], 'Words a browser sees and a crawler sees', [
    'page_results[].without_js.rendered_words',
    'page_results[].without_js.raw_words',
  ]),
  entry('alert', ['Home'], 'The alert card', [
    'changes[].summary',
    'changes[].detected_at',
    'changes[].where',
    'changes[].cause.changed_at',
    'changes[].cause.diff',
    'changes[].pages_affected',
  ]),
  entry('fix-first', ['Result'], 'If you fix one thing today: the first fix by rank', [
    'fixes[].title',
    'fixes[].effort',
    'fixes[].effect',
  ]),
  entry('without-js', ['Result'], 'Readable without JavaScript', [
    'checks[].without_js.site_text_share',
  ]),
  entry('orphans', ['Home', 'Result', 'Crawl'], 'Orphan pages', [
    'checks[].structure.orphan_pages',
  ]),
  entry('structure', ['Result'], 'Site structure', [
    'checks[].technical_seo.site_structure_score',
    'checks[].structure.pages_deeper_than_3',
    'checks[].structure.generic_anchor_share',
    'checks[].structure.hubs',
    'checks[].structure.hub_pagerank_share',
  ]),
  entry('content', ['Result'], 'Content an answer engine can quote', [
    'checks[].content.score',
    'checks[].content.checks[].by_template',
  ]),
  entry('signals', ['Result'], 'Agent-readiness signals', [
    'checks[].signals[].state',
    'checks[].signals[].counts_toward_grade',
    'checks[].signals[].evidence',
  ]),
  entry('findings', ['Result', 'Crawl'], 'The fixes table and the findings', [
    'fixes[].title',
    'fixes[].first_seen_check_id',
  ]),
  entry(
    'next-band',
    ['Home', 'Result', 'Crawl'],
    'How many fixes take the grade to the next band',
    ['fixes[].effect'],
  ),
  entry('fix-rows', ['Result'], 'The order of the fixes table, and a template fix’s page count', [
    'fixes[].rank',
    'fixes[].affected_pages',
    'fixes[].template_key',
  ]),
  entry('coverage', ['Result'], 'Pages tested, in the coverage lines', [
    'checks[].coverage.pages_sampled',
  ]),
];
