import type { FixtureDataset } from '@crawlmouse/types/v2';
import { CHECKS } from '../../../lib/v2/recordings';
import type { PerturbTable } from './types';

const orphans = (d: FixtureDataset) =>
  d.page_results.filter((p) => p.check_id === CHECKS.badFirstAudit && p.is_orphan);
const page = (d: FixtureDataset, path: string) =>
  d.page_results.find((p) => p.check_id === CHECKS.badFirstAudit && p.url.endsWith(path))!;
const anchors = (d: FixtureDataset) => d.fixes.find((f) => f.type === 'generic_anchor_text')!;

export const STRUCTURE_PERTURB: PerturbTable = {
  'structure-verdict': {
    'checks[].structure.orphan_pages': [
      {
        change: (c) => (c.structure!.orphan_pages = 8),
        expect: {
          structure: [
            'Eight pages have no links pointing at them.',
            '7 of 8 orphan pages are listed in this record.',
          ],
        },
      },
    ],
    'checks[].technical_seo.site_structure_score': [
      {
        change: (c) => (c.technical_seo!.site_structure_score = 68.2),
        expect: { structure: ['68 / 100'] },
      },
    ],
  },
  'structure-figures': {
    'checks[].structure.internal_links': [
      {
        change: (c) => (c.structure!.internal_links = 801),
        expect: { structure: ['Internal links 801'] },
      },
    ],
    'checks[].structure.js_only_pages': [
      {
        change: (c) => (c.structure!.js_only_pages = 6),
        expect: { structure: ['Six more pages are reachable only', 'JavaScript-only · 6'] },
      },
    ],
    'checks[].structure.avg_click_depth': [
      {
        change: (c) => (c.structure!.avg_click_depth = 2.7),
        expect: { structure: ['2.7 clicks'] },
      },
    ],
    'checks[].structure.hubs': [
      { change: (c) => (c.structure!.hubs = 3), expect: { structure: ['Three hub pages carry'] } },
    ],
    'checks[].structure.hub_pagerank_share': [
      {
        change: (c) => (c.structure!.hub_pagerank_share = 0.58),
        expect: { structure: ['58% of the site'] },
      },
    ],
    'checks[].structure.generic_anchor_share': [
      {
        change: (c) => (c.structure!.generic_anchor_share = 0.41),
        expect: { structure: ['41% of anchors are generic.'] },
      },
    ],
  },
  'structure-pages': {
    'checks[].coverage.pages_crawled': [
      {
        change: (c) => {
          c.coverage!.pages_crawled = 210;
          c.coverage!.templates.find((t) => t.label === 'Products')!.pages -= 4;
        },
        expect: { structure: ['Pages 210', 'Explore all 210'] },
      },
    ],
    'checks[].coverage.pages_discovered': [
      {
        change: (c) => (c.coverage!.pages_discovered = 230),
        expect: { structure: ['Tested 214 of 230 pages'] },
      },
    ],
  },
  'structure-orphans': {
    'page_results[].is_orphan': [
      {
        change: (_, d) => (page(d, '/collections/sleep').is_orphan = true),
        expect: { structure: ['/collections/sleep'] },
      },
    ],
    'page_results[].url': [
      {
        change: (_, d) => (orphans(d)[0]!.url = 'https://example-outfitter.com/products/ridge-4p'),
        expect: { structure: ['/products/ridge-4p'] },
      },
    ],
    'page_results[].links_in': [
      {
        change: (_, d) => (orphans(d)[0]!.links_in = 1),
        expect: { structure: ['/products/ridge-3p 1 sitemap.xml'] },
      },
    ],
    'page_results[].found_via': [
      {
        change: (_, d) => (orphans(d)[0]!.found_via = 'link'),
        expect: { structure: ['/products/ridge-3p 0 a link'] },
      },
    ],
    'page_results[].suggested_parent_url': [
      {
        change: (_, d) =>
          (orphans(d)[0]!.suggested_parent_url = 'https://example-outfitter.com/collections/tarps'),
        expect: { structure: ['/collections/tarps'] },
      },
    ],
    'page_results[].crawlers_reading_text': [
      {
        change: (_, d) => (orphans(d)[0]!.crawlers_reading_text = 2),
        expect: { structure: ['/collections/tents 2 of 6'] },
      },
    ],
    'page_results[].crawlers_reached': [
      {
        change: (_, d) =>
          orphans(d)
            .filter((p) => p.url.includes('/products/'))
            .forEach((p) => (p.crawlers_reached = 5)),
        expect: { structure: ['reached by 5 of 6 AI crawlers'] },
      },
    ],
    'page_results[].sitemap_lastmod': [
      {
        change: (_, d) => (orphans(d)[0]!.sitemap_lastmod = '2026-09-20'),
        expect: { structure: ['20 Sep 2026'] },
      },
    ],
  },
  'structure-pro-fixes': {
    'fixes[].title': [
      {
        change: (_, d) => (anchors(d).title = 'Rewrite the generic anchor text on 6 pages'),
        expect: { structure: ['Rewrite the generic anchor text on 6 pages'] },
      },
    ],
    'fixes[].detail': [
      {
        change: (_, d) => (anchors(d).detail = 'the four hub pages only'),
        expect: { structure: ['the four hub pages only'] },
      },
    ],
  },
};
