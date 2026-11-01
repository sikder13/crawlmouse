import { entry } from './types';

/** What Site structure reads from the check. */
export const STRUCTURE_INVENTORY = [
  entry(
    'structure-verdict',
    ['structure'],
    'The orphan count in the headline, and the score in its pill',
    ['checks[].structure.orphan_pages', 'checks[].technical_seo.site_structure_score'],
  ),
  entry(
    'structure-figures',
    ['structure'],
    'The link graph’s figures, in the tiles and the sentence',
    [
      'checks[].structure.internal_links',
      'checks[].structure.js_only_pages',
      'checks[].structure.avg_click_depth',
      'checks[].structure.hubs',
      'checks[].structure.hub_pagerank_share',
      'checks[].structure.generic_anchor_share',
    ],
  ),
  entry('structure-pages', ['structure'], 'Pages crawled, of pages found', [
    'checks[].coverage.pages_crawled',
    'checks[].coverage.pages_discovered',
  ]),
  entry(
    'structure-orphans',
    ['structure'],
    'The orphan pages, where each belongs, and what reads them',
    [
      'page_results[].is_orphan',
      'page_results[].url',
      'page_results[].links_in',
      'page_results[].found_via',
      'page_results[].suggested_parent_url',
      'page_results[].crawlers_reading_text',
      'page_results[].crawlers_reached',
      'page_results[].sitemap_lastmod',
    ],
  ),
  entry('structure-pro-fixes', ['structure'], 'The section’s Pro fixes: title and scope', [
    'fixes[].title',
    'fixes[].detail',
  ]),
];
