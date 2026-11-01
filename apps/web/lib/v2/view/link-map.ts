/**
 * The link-map explorer (Final-LinkMap): a check's link map, the page a reader selects, and what
 * the record says about it. Two scopes:
 *
 * - `hubs`: the hubs and their neighbours, found by the engine's `hubsAndNeighbours` among the
 *   pages and links the check's record holds, laid out by the engine's layout. A check whose record
 *   holds no page has no hubs to find, so it is drawn whole instead.
 * - `all`: every page crawled, from the crawl's recording (the drawing the Structure page shows).
 *
 * `generated` replaces the drawing with one that is no audit's (the 2,000-node preview); no page in
 * it has a record. Above EXPLORER_SVG_MAX nodes the screen draws on a canvas.
 */
import type { Check, FixtureDataset, PageResult } from '@crawlmouse/types/v2';
import { findCheck, fixesAsOf, siteOf } from '../fixtures';
import { dayTimeUtc, percent } from '../format';
import { hubsAndNeighbours, layoutMap, nodeRadius, type LayoutNode } from '../map-layout';
import { count, plural } from '../words';
import { type FixHrefs } from './fix';
import type { MapDrawing } from './map';
import { isFreeFix } from './free-fixes';
import { keptUntilOf } from './result';
import { sectionFixes } from './segment/fixes';
import { NO_HREFS, SEGMENT_KEYS, SEGMENTS, type SegmentLink } from './segment/frame';
import { drawingOf } from './segment/structure';

/** The most nodes drawn as SVG; a larger map is drawn on a canvas (CC-24 brief, scope 2). */
export const EXPLORER_SVG_MAX = 500;

/** A depth the locked page flags: more than three clicks from the homepage. */
const DEEP = 3;

export interface LinkMapOptions {
  scope: 'hubs' | 'all';
  /** Show a since-kept check as it was at its finish, as the Result preview does. */
  asFirstSeen?: boolean;
  hrefs?: FixHrefs;
  /** A drawing that is no audit's, shown in place of the check's. */
  generated?: MapDrawing;
}

export interface MapNodeView {
  /** The page's path, which names it on the map and in the list. */
  path: string;
  kind: LayoutNode['kind'];
  /** The page's depth: its record's when there is one, else the drawing's. */
  depth: number | null;
  x: number;
  y: number;
  r: number;
  /** The path of the page whose link the line is drawn from; null for none. */
  parent: string | null;
  /** The link the line stands for was made by JavaScript (drawn dashed). */
  js: boolean;
}

export interface PillView {
  state: 'ok' | 'warn' | 'bad' | 'neutral';
  label: string;
}

export interface PageDetails {
  path: string;
  depth: number | null;
  pills: PillView[];
  facts: { label: string; value: string }[];
  linkedFrom: {
    heading: string;
    lines: { path: string; anchor: string; generic: boolean }[];
    more: string | null;
  };
  linksTo: { heading: string; paths: string[]; more: string | null };
  access: {
    heading: string;
    rows: { ua: string; verdict: PageAccessVerdict; evidence: string; words: string }[];
    note: string | null;
  } | null;
  fix: SegmentLink | null;
}

type PageAccessVerdict = FixtureDataset['access_tests'][number]['verdict'];

export interface MapFilter {
  key: 'orphan' | 'js_only' | 'deep';
  label: string;
  /** The drawn pages it picks out. */
  ids: string[];
  /** What pressing it says: how many there are, and how many are drawn. */
  note: string;
}

export interface LinkMapView {
  frame: {
    domain: string;
    overview: string;
    section: { title: string; href: string };
    keptUntil: string | null;
    keepHref: string;
    tabs: (SegmentLink & { current: boolean })[];
    back: SegmentLink;
    next: SegmentLink;
  };
  title: string;
  caption: string;
  explore: SegmentLink | null;
  filters: MapFilter[];
  renderer: 'svg' | 'canvas';
  /** The stage's name for a screen reader. */
  label: string;
  nodes: MapNodeView[];
  /** Every drawn page, in the order the keyboard walks them: by depth, then path. */
  order: string[];
  /** What the record holds about a drawn page, by path; a page with no record is absent. */
  details: Record<string, PageDetails>;
  /** What the panel says for a page with no record. */
  reduced: string;
  /** The page selected when the explorer opens. */
  initial: string;
  keep: { title: string; sub: string; primary: boolean } | null;
}

const pathOf = (url: string) => {
  const u = new URL(url);
  return `${u.pathname}${u.search}`;
};

const round = (n: number) => Math.round(n * 10) / 10;

/** "0.4%" for a small share, "18%" otherwise. */
const share = (s: number) => (s < 0.01 ? `${(s * 100).toFixed(1)}%` : `${percent(s)}%`);

const TEXT_STATE: Record<NonNullable<PageResult['without_js']>['state'], PillView['state']> = {
  readable: 'ok',
  partial: 'warn',
  empty_shell: 'bad',
};

function detailsOf(
  d: FixtureDataset,
  check: Check,
  page: PageResult,
  fixLink: (p: PageResult) => SegmentLink | null,
): PageDetails {
  const ai = check.crawlers.filter((c) => c.group !== 'search_engine').length;
  const edges = d.link_edges.filter((e) => e.check_id === check.id);
  const into = edges
    .filter((e) => e.to_url === page.url)
    .sort((a, b) => (a.from_url < b.from_url ? -1 : 1));
  const out = [
    ...new Set(edges.filter((e) => e.from_url === page.url).map((e) => e.to_url)),
  ].sort();
  const more = (total: number, listed: number) =>
    total > listed ? `${count(total - listed)} more, not in this record` : null;
  const pills: PillView[] = [
    page.depth === null
      ? { state: 'neutral', label: page.is_orphan ? 'orphan' : 'no link path' }
      : { state: 'neutral', label: `depth ${page.depth}` },
  ];
  if (page.js_only) pills.push({ state: 'warn', label: 'JavaScript-only' });
  if (page.without_js) {
    pills.push({
      state: TEXT_STATE[page.without_js.state],
      label: `${percent(page.without_js.text_share)}% text without JS`,
    });
  }
  const tests = d.access_tests.filter(
    (t) => t.check_id === check.id && t.page_url === page.url && t.ua !== null,
  );
  return {
    path: pathOf(page.url),
    depth: page.depth,
    pills,
    facts: [
      { label: 'Links in', value: count(page.links_in) },
      { label: 'Links out', value: count(page.links_out) },
      {
        label: 'Share of internal PageRank',
        value: page.pagerank_share === null ? 'not measured' : share(page.pagerank_share),
      },
      {
        label: 'Crawlers that reach it',
        value: page.crawlers_reached === null ? 'not tested' : `${page.crawlers_reached} of ${ai}`,
      },
      {
        label: 'Crawlers that read its text',
        value:
          page.crawlers_reading_text === null
            ? 'not tested'
            : `${page.crawlers_reading_text} of ${ai}`,
      },
    ],
    linkedFrom: {
      heading: `Linked from · ${count(page.links_in)}`,
      lines: into.map((e) => ({
        path: pathOf(e.from_url),
        anchor: e.anchor_text,
        generic: e.is_generic_anchor,
      })),
      more: more(page.links_in, into.length),
    },
    linksTo: {
      heading: `Links to · ${count(page.links_out)}`,
      paths: out.map(pathOf),
      more: more(page.links_out, out.length),
    },
    access: tests.length
      ? {
          heading: 'Crawler access for this page',
          rows: tests.map((t) => ({
            ua: t.ua!,
            verdict: t.verdict,
            evidence: t.evidence_class,
            words:
              t.word_count === null
                ? 'no text read'
                : `${count(t.word_count)} ${plural(t.word_count, 'word', 'words')}`,
          })),
          note:
            tests.length < ai
              ? `${tests.length} of the ${ai} AI crawlers’ requests for this page are in the record.`
              : null,
        }
      : null,
    fix: fixLink(page),
  };
}

const ORDER = (a: MapNodeView, b: MapNodeView) =>
  (a.depth ?? Infinity) - (b.depth ?? Infinity) || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);

export function linkMapView(
  d: FixtureDataset,
  checkId: string,
  { scope, asFirstSeen = false, hrefs = NO_HREFS, generated }: LinkMapOptions,
): LinkMapView {
  const check = findCheck(d, checkId);
  const s = check.structure;
  const coverage = check.coverage;
  if (!s || !coverage) throw new Error(`Check ${checkId} has no structure to map`);
  const crawled = coverage.pages_crawled;
  const records = d.page_results.filter((p) => p.check_id === check.id);
  const links = d.link_edges.filter((e) => e.check_id === check.id);
  const withheld = (collection: string) =>
    d.withheld.find((w) => w.check_id === check.id && w.collection === collection);

  // Which drawing: the hubs among the record, the crawl's whole map, or a generated one.
  let drawing: MapDrawing;
  let drawnScope: 'hubs' | 'all' | 'generated';
  if (generated) {
    drawing = generated;
    drawnScope = 'generated';
  } else if (scope === 'hubs' && records.length) {
    const nodes = hubsAndNeighbours(records, links);
    drawing = { nodes, positions: layoutMap(nodes) };
    drawnScope = 'hubs';
  } else {
    const whole = drawingOf(checkId);
    if (!whole) throw new Error(`Check ${checkId} has no drawing of its crawl`);
    drawing = whole;
    drawnScope = 'all';
  }

  const byUrl = new Map(records.map((p) => [p.url, p]));
  const live = fixesAsOf(d, check);
  const fixOf = (p: PageResult) =>
    live.find((x) => x.template_key !== null && x.template_key === p.template_key);
  const fixLink = (p: PageResult): SegmentLink | null => {
    const f = fixOf(p);
    return f ? { label: 'Open the fix for this template', href: hrefs.fix?.(f.id) ?? '#' } : null;
  };
  const record = (url: string) => (drawnScope === 'generated' ? undefined : byUrl.get(url));

  const nodes: MapNodeView[] = drawing.nodes.map((n) => {
    const at = drawing.positions[n.id];
    if (!at) throw new Error(`The drawing has no position for ${n.id}`);
    const r = record(n.id);
    return {
      path: pathOf(n.id),
      kind: n.kind,
      depth: r ? r.depth : n.depth,
      x: round(at.x),
      y: round(at.y),
      r: nodeRadius(n),
      parent: n.parent ? pathOf(n.parent) : null,
      js: n.via === 'javascript',
    };
  });
  const details: Record<string, PageDetails> = {};
  for (const n of drawing.nodes) {
    const r = record(n.id);
    if (r) details[pathOf(n.id)] = detailsOf(d, check, r, fixLink);
  }
  const order = [...nodes].sort(ORDER).map((n) => n.path);
  // Open first on a page whose fix the reader can open now, so the fix link is worth following.
  const freeFix = (path: string) => {
    const r = drawing.nodes.find((n) => pathOf(n.id) === path);
    const f = r ? fixOf(record(r.id)!) : undefined;
    return f !== undefined && isFreeFix(d, check, f);
  };
  const initial =
    order.find((p) => details[p]?.fix && freeFix(p)) ??
    order.find((p) => details[p]?.fix) ??
    order.find((p) => details[p]) ??
    order[0]!;

  const isGenerated = drawnScope === 'generated';
  const linkCount = isGenerated ? nodes.filter((n) => n.parent).length : s.internal_links;
  const pageCount = isGenerated ? nodes.length : crawled;
  const drawnOf = (pred: (n: MapNodeView) => boolean) => nodes.filter(pred).map((n) => n.path);
  const filter = (
    key: MapFilter['key'],
    name: string,
    noun: [string, string],
    total: number,
    ids: string[],
  ): MapFilter => ({
    key,
    label: `${name} · ${count(total)}`,
    ids,
    note:
      ids.length === total
        ? `${count(total)} ${plural(total, noun[0], noun[1])}, all on this drawing.`
        : `${count(total)} ${plural(total, noun[0], noun[1])}; ${count(ids.length)} of them ${plural(ids.length, 'is', 'are')} on this drawing.`,
  });
  const orphanIds = drawnOf((n) => n.kind === 'orphan');
  const jsIds = drawnOf((n) => n.kind === 'js_only');
  const deepIds = drawnOf((n) => n.depth !== null && n.depth > DEEP);

  const held = withheld('page_results');
  const heldLinks = withheld('link_edges');
  const select =
    'Select a page to see what links to it, what it links to, and which crawlers reach it.';
  const orphansDrawn = orphanIds.length ? ' Orphans sit at the edge with no line in.' : '';
  const caption =
    drawnScope === 'hubs'
      ? `Zoomed to the hubs and their neighbours, ${count(nodes.length)} of ${count(crawled)}. The audit’s record holds ${count(held?.included ?? records.length)} of its ${count(held?.total ?? crawled)} pages and ${count(heldLinks?.included ?? links.length)} of its ${count(heldLinks?.total ?? s.internal_links)} links, so the hubs are found among those. ${select}${orphansDrawn}`
      : drawnScope === 'all'
        ? `Every page crawled, ${count(nodes.length)} of ${count(crawled)}, each drawn from the page whose link first reached it. ${select}${orphansDrawn}`
        : `A generated graph of ${count(nodes.length)} pages for the performance test, drawn on a canvas. It is not an audit, so no page has a record. ${select}`;

  const keptUntil = keptUntilOf(d, check, asFirstSeen);
  const kept = keptUntil === null ? null : dayTimeUtc(keptUntil);
  const open = sectionFixes(d, check, 'structure').open.length;
  return {
    frame: {
      domain: siteOf(d, check).host,
      overview: hrefs.overview,
      section: { title: SEGMENTS.structure.title, href: hrefs.segment('structure') },
      keptUntil: kept,
      keepHref: kept === null ? '#' : '#keep',
      tabs: [
        { label: 'Overview', href: hrefs.overview, current: false },
        ...SEGMENT_KEYS.map((k) => ({
          label: SEGMENTS[k].tab,
          href: hrefs.segment(k),
          current: k === 'structure',
        })),
      ],
      back: { label: `Back: ${SEGMENTS.structure.backName}`, href: hrefs.segment('structure') },
      next: {
        label: `Fixes for site structure · ${open} open`,
        href: `${hrefs.segment('structure')}#fixes`,
      },
    },
    title: `${count(pageCount)} ${plural(pageCount, 'page', 'pages')}, ${count(linkCount)} ${plural(linkCount, 'link', 'links')}.`,
    caption,
    explore:
      drawnScope === 'hubs'
        ? { label: `Explore all ${count(crawled)}`, href: hrefs.map?.all ?? '#' }
        : null,
    filters: [
      filter(
        'orphan',
        'Orphans',
        ['orphan page', 'orphan pages'],
        isGenerated ? orphanIds.length : s.orphan_pages,
        orphanIds,
      ),
      filter(
        'js_only',
        'JavaScript-only',
        ['JavaScript-only page', 'JavaScript-only pages'],
        isGenerated ? jsIds.length : s.js_only_pages,
        jsIds,
      ),
      filter(
        'deep',
        'Deeper than 3 clicks',
        ['page deeper than 3 clicks', 'pages deeper than 3 clicks'],
        isGenerated ? deepIds.length : s.pages_deeper_than_3,
        deepIds,
      ),
    ],
    renderer: nodes.length > EXPLORER_SVG_MAX ? 'canvas' : 'svg',
    label: `Link map of ${count(nodes.length)} pages. Use the arrow keys to move from page to page.`,
    nodes,
    order,
    details,
    reduced: isGenerated
      ? 'A generated page: the performance test has no record of it.'
      : `The audit’s record holds ${count(held?.included ?? records.length)} of its ${count(held?.total ?? crawled)} pages; this page’s figures are not among them.`,
    initial,
    keep:
      kept === null
        ? null
        : {
            title:
              'Keep this map: it is rebuilt on every check, and an email tells you when a page loses its links.',
            sub: `One email creates a free account that re-checks monthly, with 14 days of Pro to start, including the link-map CSV. Otherwise this page expires ${kept}.`,
            // With no fix to open from any drawn page, keeping the map is the reader's next step.
            primary: !Object.values(details).some((x) => x.fix),
          },
  };
}
