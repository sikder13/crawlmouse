/**
 * The values on the audit-flow screens that come from a check, by screen and element, with the
 * fixture field each is read from. SPEC 22 renders this table, and
 * __tests__/v2/perturbation.test.tsx changes each field in a copy of the fixture and requires the
 * screens to follow, so no entry can be a literal.
 */
export interface InventoryEntry {
  id: string;
  screens: string;
  element: string;
  field: string;
}

export const INVENTORY: InventoryEntry[] = [
  { id: 'domain', screens: 'Home, Result', element: 'The site', field: 'sites[].host' },
  {
    id: 'timing',
    screens: 'Home, Result, Crawl',
    element: 'Crawl time; crawled at; kept until',
    field: 'checks[].started_at, finished_at (kept until: expires_at, or finished_at + 24 h)',
  },
  {
    id: 'pages',
    screens: 'Home, Result, Crawl',
    element: 'Pages crawled of pages found',
    field: 'checks[].coverage.pages_crawled, pages_discovered',
  },
  {
    id: 'links',
    screens: 'Home, Result, Crawl',
    element: 'Links',
    field: 'checks[].structure.internal_links',
  },
  {
    id: 'seo',
    screens: 'Home, Result, Crawl',
    element: 'Technical SEO letter and score',
    field: 'checks[].technical_seo.grade, score',
  },
  {
    id: 'ai',
    screens: 'Home, Result, Crawl',
    element: 'AI readability letter and score, or the access range when withheld',
    field: 'checks[].ai_readability.grade, total, access_range',
  },
  {
    id: 'verdicts',
    screens: 'Home, Result, Crawl',
    element: 'Crawler verdicts and the sentences about them',
    field: 'checks[].crawlers[].verdict, evidence_class, cause, by_template',
  },
  {
    id: 'text-share',
    screens: 'Home, Result',
    element: 'Text a crawler can read',
    field: 'checks[].crawlers[].text_share',
  },
  {
    id: 'obstacle',
    screens: 'Home',
    element: 'What is in the way',
    field: 'checks[].crawlers[].cause',
  },
  {
    id: 'template-size',
    screens: 'Home, Result',
    element: 'Pages sharing a template',
    field: 'checks[].coverage.templates[].pages',
  },
  {
    id: 'words',
    screens: 'Home',
    element: 'Words a browser sees and a crawler sees',
    field: 'page_results[].without_js.rendered_words, raw_words',
  },
  {
    id: 'alert',
    screens: 'Home',
    element: 'The alert card',
    field: 'changes[].summary, detected_at, where, cause.changed_at, cause.diff, pages_affected',
  },
  {
    id: 'fix-first',
    screens: 'Result',
    element: 'If you fix one thing today',
    field: 'fixes[] (first by rank): title, effort, effect; the causes of its crawlers',
  },
  {
    id: 'without-js',
    screens: 'Result',
    element: 'Readable without JavaScript',
    field: 'checks[].without_js.site_text_share',
  },
  {
    id: 'structure',
    screens: 'Home, Result',
    element: 'Site structure and the Technical SEO summary',
    field:
      'checks[].technical_seo.site_structure_score; structure.orphan_pages, pages_deeper_than_3, generic_anchor_share, hubs, hub_pagerank_share',
  },
  {
    id: 'content',
    screens: 'Result',
    element: 'Content an answer engine can quote',
    field: 'checks[].content.score, checks[].by_template',
  },
  {
    id: 'signals',
    screens: 'Result',
    element: 'Agent-readiness signals',
    field: 'checks[].signals[].state, counts_toward_grade, evidence',
  },
  {
    id: 'fixes',
    screens: 'Result, Crawl',
    element: 'The fixes table and the findings',
    field: 'fixes[].title, rank, effect, affected_pages, template_key, first_seen_check_id',
  },
  {
    id: 'coverage',
    screens: 'Result',
    element: 'Coverage lines',
    field: 'checks[].coverage.pages_sampled, pages_discovered, templates',
  },
];
