/**
 * What the fix page and the link-map explorer read from the contract fixtures, entry by entry.
 * __tests__/v2/fix-map-perturbation.test.tsx changes each field in a copy of a fixture and requires
 * the page named to show the new value, and fails on a field listed here with no change or a
 * change for a field not listed here.
 */
export type CC24Page = 'fix' | 'locked' | 'map';

export interface PageInventoryEntry {
  id: string;
  pages: readonly CC24Page[];
  element: string;
  fields: readonly string[];
}

const entry = (
  id: string,
  pages: readonly CC24Page[],
  element: string,
  fields: readonly string[],
): PageInventoryEntry => ({ id, pages, element, fields });

export const FIX_MAP_INVENTORY: PageInventoryEntry[] = [
  entry('fix-head', ['fix', 'locked'], 'The fix’s title, estimated effect and class', [
    'fixes[].title',
    'fixes[].effect.ai_readability',
    'fixes[].effect.technical_seo',
    'fixes[].recommendation_class',
  ]),
  entry('fix-tiles', ['fix', 'locked'], 'Pages affected and effort, in the tiles', [
    'fixes[].affected_pages',
    'fixes[].effort',
  ]),
  entry('fix-before-after', ['fix'], 'The text share tiles and the before and after rows', [
    'fixes[].before_after[].today',
    'fixes[].before_after[].after',
    'fixes[].before_after[].after_bound',
  ]),
  entry('fix-packet', ['fix'], 'The packet: its problem, steps, what to keep and the check', [
    'fixes[].packet.context',
    'fixes[].packet.change',
    'fixes[].packet.keep',
    'fixes[].packet.verify.command',
    'fixes[].packet.verify.expect',
    'fixes[].packet.verify.ua',
  ]),
  entry('fix-stack', ['fix'], 'The stack the packet is written for, and the framework switch', [
    'fixes[].packet.framework',
    'fixes[].packet.frameworks',
    'checks[].stack.frontend',
    'checks[].stack.backend',
  ]),
  entry('fix-crawler', ['fix'], 'What the verify crawler gets today', [
    'checks[].crawlers[].status',
  ]),
  entry('map-head', ['map'], 'The pages and links in the heading, and what the record holds', [
    'checks[].coverage.pages_crawled',
    'checks[].structure.internal_links',
    'withheld[].included',
  ]),
  entry('map-filters', ['map'], 'The filters’ counts', [
    'checks[].structure.orphan_pages',
    'checks[].structure.js_only_pages',
    'checks[].structure.pages_deeper_than_3',
  ]),
  entry('map-page', ['map'], 'The selected page’s figures', [
    'page_results[].depth',
    'page_results[].links_in',
    'page_results[].links_out',
    'page_results[].pagerank_share',
    'page_results[].crawlers_reached',
    'page_results[].crawlers_reading_text',
    'page_results[].without_js',
  ]),
  entry('map-links', ['map'], 'The links to the selected page, with their anchors', [
    'link_edges[].anchor_text',
    'link_edges[].is_generic_anchor',
  ]),
  entry('map-access', ['map'], 'The crawler requests the record holds for the selected page', [
    'access_tests[].verdict',
    'access_tests[].word_count',
  ]),
];
