/**
 * The Site structure segment (Final-Seg-Structure) as data: the orphan count and the link graph's
 * figures from the check, the crawl's own map drawing, and the orphan pages the record lists.
 * Every sentence is built from those figures (OPERATING-RULES §10).
 */
import type { Check, PageResult } from '@crawlmouse/types/v2';
import { findCheck } from '../../fixtures';
import { listOf, percent, templateNoun } from '../../format';
import { RECORDING_NAMES, recordingSpec } from '../../recordings';
import { clientRenderedTemplates, isAi } from '../../sentences';
import { capitalise, count, numberWord, plural } from '../../words';
import { mapDrawing, type MapDrawing } from '../map';
import type { CoverageView, DoorView } from '../result';
import { sectionFixes, type SectionFixesView } from './fixes';
import { segmentFrame, type SegmentFrame, type SegmentOptions } from './frame';
import type { ViewDataset } from '../dataset';

export interface OrphanRow {
  page: string;
  linksIn: string;
  foundVia: string;
  parent: string;
  /** "0 of 6": of the AI crawlers tested, how many read the page's text. */
  reading: string;
  lastChanged: string;
}

export interface StructureMapView extends MapDrawing {
  /** How much of the crawl the drawing holds: "every page crawled, 214 of 214". */
  caption: string;
  /** The map's description for a screen reader. */
  label: string;
  explore: string;
  /** Where "Explore all" opens: the explorer, every page. */
  exploreHref: string;
  legend: { jsOnly: number; orphans: number; jsLinks: boolean };
}

export interface StructureView {
  frame: SegmentFrame;
  headline: { title: string; pill: DoorView['pill']; body: string };
  tiles: { label: string; value: string; note: null }[];
  coverage: CoverageView;
  /** Null when no drawing of this crawl exists. */
  map: StructureMapView | null;
  orphans: {
    heading: string;
    sub: string | null;
    rows: OrphanRow[];
    /** Where "Open in the explorer" opens: the explorer as it opens. */
    explorerHref: string;
    /** "0 of 2 orphan pages are listed in this record", when the record lists fewer. */
    unlisted: string | null;
    notes: string[];
  };
  fixes: SectionFixesView;
  keep: { title: string; sub: string } | null;
}

/** A depth the locked page calls healthy: within three clicks, as the deep-pages fix counts. */
const HEALTHY_DEPTH = 3;

const FOUND_VIA: Record<PageResult['found_via'], string> = {
  sitemap: 'sitemap.xml',
  link: 'a link',
  javascript: 'JavaScript',
};

const pathOf = (url: string) => new URL(url).pathname;

/**
 * "14 Sep 2026", from a sitemap `<lastmod>` date. The month comes from en-US, whose short names are
 * three letters throughout (en-GB writes "Sept").
 */
const MONTH = new Intl.DateTimeFormat('en-US', { month: 'short', timeZone: 'UTC' });
function dateOf(day: string): string {
  const at = new Date(`${day}T00:00:00Z`);
  return `${at.getUTCDate()} ${MONTH.format(at)} ${at.getUTCFullYear()}`;
}

/** The drawing the crawl screen made of this check, when there is one. */
export function drawingOf(checkId: string): MapDrawing | null {
  const name = RECORDING_NAMES.find((n) => {
    const spec = recordingSpec(n);
    return spec.check_id === checkId && !spec.shape_check_id;
  });
  return name ? mapDrawing(name) : null;
}

function headlineTitle(orphans: number): string {
  if (orphans === 0) return 'Every page crawled has a link pointing at it.';
  return orphans === 1
    ? 'One page has no links pointing at it.'
    : `${capitalise(numberWord(orphans))} pages have no links pointing at them.`;
}

function headlineBody(check: Check, rows: readonly PageResult[], map: MapDrawing | null): string {
  const s = check.structure!;
  const parts: string[] = [];
  if (s.orphan_pages > 0) {
    const listedAll = rows.length === s.orphan_pages;
    parts.push(
      listedAll && rows.every((r) => r.found_via === 'sitemap')
        ? 'Crawlers found them only through the sitemap, so they earn no PageRank and most answer engines never see them.'
        : 'No internal link reaches them, so they earn no PageRank.',
    );
  }
  if (s.js_only_pages > 0) {
    const n = s.js_only_pages;
    const more = s.orphan_pages > 0 ? ' more' : '';
    parts.push(
      `${capitalise(numberWord(n))}${more} ${plural(n, 'page is', 'pages are')} reachable only through JavaScript navigation, which a crawler that does not run scripts cannot follow.`,
    );
  }
  parts.push(
    `${s.hubs ? `${capitalise(numberWord(s.hubs))} hub ${plural(s.hubs, 'page carries', 'pages carry')} ${percent(s.hub_pagerank_share)}% of the site's internal PageRank` : 'No page stands out as a hub'}; the average page is ${s.avg_click_depth.toFixed(1)} clicks from the homepage, which is ${s.avg_click_depth <= HEALTHY_DEPTH ? 'healthy' : 'deep'}.`,
  );
  parts.push(`${percent(s.generic_anchor_share)}% of anchors are generic.`);
  if (map && map.nodes.length) {
    const what =
      map.nodes.length === check.coverage!.pages_crawled ? 'every page crawled' : 'the pages drawn';
    parts.push(
      `The map below shows ${what}: each dot a page, larger the closer it is to the homepage; each line the link that reached it.`,
    );
  }
  return parts.join(' ');
}

/**
 * Why an orphan's crawler count is what it is, per template: said only where the template's
 * orphans share their counts, and the reason only where the AI crawlers read that template thin.
 */
function orphanNotes(check: Check, rows: readonly PageResult[], aiCount: number): string[] {
  const thin = clientRenderedTemplates(check) ?? [];
  const templates = check.coverage!.templates;
  return templates.flatMap((t) => {
    const here = rows.filter((r) => r.template_key === t.template_key);
    const [first] = here;
    if (!first || first.crawlers_reached === null || first.crawlers_reading_text === null)
      return [];
    const same = here.every(
      (r) =>
        r.crawlers_reached === first.crawlers_reached &&
        r.crawlers_reading_text === first.crawlers_reading_text,
    );
    if (!same || first.crawlers_reading_text >= first.crawlers_reached) return [];
    const why = thin.includes(t.template_key)
      ? ': once reached, they still hit the JavaScript problem in the previous section'
      : '';
    return [
      `${capitalise(templateNoun(t.label).adjective)} page orphans are reached by ${first.crawlers_reached} of ${aiCount} AI crawlers and read by ${first.crawlers_reading_text}${why}.`,
    ];
  });
}

function orphanTable(
  check: Check,
  rows: readonly PageResult[],
): Omit<StructureView['orphans'], 'explorerHref'> {
  const total = check.structure!.orphan_pages;
  const aiCount = check.crawlers.filter(isAi).length;
  if (total === 0) {
    return { heading: 'No orphan pages', sub: null, rows: [], unlisted: null, notes: [] };
  }
  // An orphan found through a link has lost it since; only another way in says where it was found.
  const vias = [...new Set(rows.map((r) => r.found_via))].filter((v) => v !== 'link');
  return {
    heading: `The ${numberWord(total)} orphan ${plural(total, 'page', 'pages')}, and where ${plural(total, 'it belongs', 'each belongs')}`,
    sub:
      vias.length === 1
        ? `Found in ${FOUND_VIA[vias[0]!]}, linked from nowhere.`
        : vias.length
          ? `Found through ${listOf(vias.map((v) => FOUND_VIA[v]))}, linked from nowhere.`
          : null,
    rows: rows.map((r) => ({
      page: pathOf(r.url),
      linksIn: count(r.links_in),
      foundVia: FOUND_VIA[r.found_via],
      parent: r.suggested_parent_url ? pathOf(r.suggested_parent_url) : '—',
      reading:
        r.crawlers_reading_text === null
          ? 'not measured'
          : `${r.crawlers_reading_text} of ${aiCount}`,
      lastChanged: r.sitemap_lastmod ? dateOf(r.sitemap_lastmod) : '—',
    })),
    unlisted:
      rows.length < total
        ? `${count(rows.length)} of ${count(total)} orphan ${plural(total, 'page is', 'pages are')} listed in this record.`
        : null,
    notes: orphanNotes(check, rows, aiCount),
  };
}

function mapView(
  check: Check,
  drawing: MapDrawing | null,
  exploreHref: string,
): StructureMapView | null {
  if (!drawing || drawing.nodes.length === 0) return null;
  const s = check.structure!;
  const crawled = check.coverage!.pages_crawled;
  const drawn = drawing.nodes.length;
  return {
    ...drawing,
    caption:
      drawn === crawled
        ? `every page crawled, ${count(drawn)} of ${count(crawled)}`
        : `${count(drawn)} of ${count(crawled)} pages crawled`,
    label: `Link map of ${count(drawn)} pages: ${count(s.orphan_pages)} orphan, ${count(s.js_only_pages)} reachable only through JavaScript.`,
    explore: `Explore all ${count(crawled)}`,
    exploreHref,
    legend: {
      jsOnly: s.js_only_pages,
      orphans: s.orphan_pages,
      jsLinks: drawing.nodes.some((n) => n.via === 'javascript'),
    },
  };
}

export function structureView(
  d: ViewDataset,
  checkId: string,
  options: SegmentOptions = {},
  drawing: MapDrawing | null = drawingOf(checkId),
): StructureView {
  const check = findCheck(d, checkId);
  const s = check.structure;
  const coverage = check.coverage;
  if (!s || !coverage) {
    throw new Error(`Check ${check.id} has no structure; the segments show graded checks`);
  }
  const frame = segmentFrame(d, checkId, 'structure', options);
  const rows = d.page_results.filter((p) => p.check_id === check.id && p.is_orphan);
  const score = check.technical_seo?.site_structure_score ?? null;
  return {
    frame,
    headline: {
      title: headlineTitle(s.orphan_pages),
      pill: {
        state: 'neutral',
        label: score === null ? 'not graded' : `${Math.round(score)} / 100`,
      },
      body: headlineBody(check, rows, drawing),
    },
    tiles: [
      { label: 'Pages', value: count(coverage.pages_crawled), note: null },
      { label: 'Internal links', value: count(s.internal_links), note: null },
      { label: 'Orphan pages', value: count(s.orphan_pages), note: null },
      { label: 'Reachable only through JavaScript', value: count(s.js_only_pages), note: null },
      { label: 'Average click depth', value: s.avg_click_depth.toFixed(1), note: null },
    ],
    coverage: {
      tested: coverage.pages_crawled,
      total: coverage.pages_discovered,
      groups: coverage.templates.length,
    },
    map: mapView(check, drawing, options.hrefs?.map?.all ?? '#'),
    orphans: { ...orphanTable(check, rows), explorerHref: options.hrefs?.map?.hubs ?? '#' },
    fixes: sectionFixes(d, check, 'structure'),
    keep: frame.keptUntil
      ? {
          title:
            'Keep this audit: an email when an orphan appears or a hub loses links, and every fix for 14 days.',
          sub: `One email creates a free account that re-checks monthly, with 14 days of Pro to start, including the link-map CSV. Otherwise this page expires ${frame.keptUntil}.`,
        }
      : null,
  };
}
