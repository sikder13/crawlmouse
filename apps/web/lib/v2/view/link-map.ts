/**
 * The link-map explorer (Final-LinkMap): a check's link map, the page a reader selects, and what
 * the record says about it. Two scopes:
 *
 * - `hubs`: the hubs and their neighbours, found by the engine's `hubsAndNeighbours` among the
 *   pages and links the check's record holds, laid out by the engine's layout; or the drawing the
 *   pipeline stored of them when the check was built (`drawing`), which is that same layout. A
 *   check whose record holds no page has no hubs to find, so it is drawn whole instead.
 * - `all`: every page crawled, from the crawl's recording (the drawing the Structure page shows);
 *   a check with no recording is laid out from its record (`everyPage`).
 *
 * `generated` replaces the drawing with one that is no audit's (the 2,000-node preview); no page in
 * it has a record. Above EXPLORER_SVG_MAX nodes the screen draws on a canvas.
 */
import type { Check, CrawlerResult, FixtureDataset, PageResult } from '@crawlmouse/types/v2';
import { findCheck, fixesAsOf, siteOf } from '../fixtures';
import { dayTimeUtc, percent } from '../format';
import { hubsAndNeighbours, layoutMap, nodeRadius, type LayoutNode } from '../map-layout';
import { count, plural } from '../words';
import { type FixHrefs } from './fix';
import type { MapDrawing } from './map';
import { openFixes, type FixPlan } from './free-fixes';
import { keptUntilOf } from './result';
import { sectionFixes } from './segment/fixes';
import { NO_HREFS, SEGMENT_KEYS, SEGMENTS, type SegmentLink } from './segment/frame';
import { drawingOf } from './segment/structure';
import type { ViewDataset } from './dataset';

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
  /** The hubs drawing stored with the check; given, the hubs scope draws it as stored. */
  drawing?: MapDrawing;
  /** The reader's plan: Free opens the free fixes (free-fixes.ts), Pro opens every live fix. */
  plan?: FixPlan;
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
    rows: AccessRow[];
    note: string | null;
    tagged: string | null;
  } | null;
  fix: SegmentLink | null;
}

type PageAccessVerdict = FixtureDataset['access_tests'][number]['verdict'];

/** One row of a page's crawler access: an AI crawler's request, or the search engines' verdict. */
export interface AccessRow {
  ua: string;
  verdict: PageAccessVerdict;
  evidence: PageAccessEvidence;
  /** How the verdict is known, beside it ("by robots.txt", FACTS B2); null for a request. */
  qualifier: string | null;
  words: string;
}
type PageAccessEvidence = FixtureDataset['access_tests'][number]['evidence_class'];

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
  /**
   * The keep bar's words; null once an account keeps the audit. Which element is orange follows
   * the selection (Explorer.tsx): the page's fix link, else the keep bar, else the next link.
   */
  keep: { title: string; sub: string } | null;
  /** The legend's keys for what is drawn; a page and the selection ring are always keyed. */
  legend: { jsOnly: boolean; orphans: boolean; jsLinks: boolean };
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
  d: ViewDataset,
  check: Check,
  page: PageResult,
  fixLink: (p: PageResult) => SegmentLink | null,
): PageDetails {
  const ai = check.crawlers.filter((c) => c.group !== 'search_engine').length;
  const edges = d.link_edges.filter((e) => e.check_id === check.id);
  // In the order the record lists them.
  const into = edges.filter((e) => e.to_url === page.url);
  const out = [...new Set(edges.filter((e) => e.from_url === page.url).map((e) => e.to_url))];
  const more = (total: number, listed: number) =>
    total > listed ? `${count(total - listed)} more, not in this record` : null;
  // A page whose links were not all read has no count of its links out (its links_out is 0 when none
  // was read, the links found so far when the read stopped early), so none is shown.
  const linksOut = page.links_read ? page.links_out : null;
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
  // The search engines are read from robots.txt, not fetched (FACTS B2), so they are the check's,
  // not the page's: one row for each verdict they share, with the text a renderer gets.
  const engineGroups = new Map<string, CrawlerResult[]>();
  for (const c of check.crawlers.filter((x) => x.group === 'search_engine')) {
    engineGroups.set(c.verdict, [...(engineGroups.get(c.verdict) ?? []), c]);
  }
  const rendered = page.without_js?.rendered_words;
  const engines: AccessRow[] = [...engineGroups.values()].map((cs) => ({
    ua: cs.map((c) => c.ua).join(', '),
    verdict: cs[0]!.verdict,
    evidence: cs[0]!.evidence_class,
    // Said beside "allowed" only: the verdicts that refuse already name robots.txt ("blocked by
    // robots.txt", components/v2/verdicts.ts).
    qualifier: cs[0]!.status === null && cs[0]!.verdict === 'allowed' ? 'by robots.txt' : null,
    words:
      cs[0]!.verdict === 'allowed' && rendered !== undefined
        ? `renders ${count(rendered)} ${plural(rendered, 'word', 'words')}`
        : '',
  }));
  return {
    path: pathOf(page.url),
    depth: page.depth,
    pills,
    facts: [
      { label: 'Links in', value: count(page.links_in) },
      { label: 'Links out', value: linksOut === null ? 'not read' : count(linksOut) },
      {
        label: 'Share of internal PageRank',
        value: page.pagerank_share === null ? 'not measured' : share(page.pagerank_share),
      },
      {
        label: 'AI crawlers that reach it',
        value: page.crawlers_reached === null ? 'not tested' : `${page.crawlers_reached} of ${ai}`,
      },
      {
        label: 'AI crawlers that read its text',
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
      heading: `Links to · ${linksOut === null ? 'not read' : count(linksOut)}`,
      paths: out.map(pathOf),
      more: linksOut === null ? null : more(linksOut, out.length),
    },
    access:
      tests.length || engines.length
        ? {
            heading: 'Crawler access for this page',
            rows: [
              ...engines,
              ...tests.map((t) => ({
                ua: t.ua!,
                verdict: t.verdict,
                evidence: t.evidence_class,
                qualifier: null,
                words:
                  t.word_count === null
                    ? 'no text read'
                    : `${count(t.word_count)} ${plural(t.word_count, 'word', 'words')}`,
              })),
            ],
            note:
              tests.length < ai
                ? `${tests.length} of the ${ai} AI crawlers’ requests for this page are in the record.`
                : null,
            // FACTS D1: one line under every crawler table, where the requests are ours.
            tagged: tests.length
              ? 'Tested with tagged user agents from published IPs — crawlmouse.com/bot.'
              : null,
          }
        : null,
    fix: fixLink(page),
  };
}

const byUrl = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * The pages of a check's record as layout nodes, by the hubs map's rules (the engine's hubs.ts)
 * without its selection: a breadth-first walk of the links from the homepage (the page at depth 0),
 * links taken in URL order, gives each page it reaches its depth and, as parent, the nearest page
 * on the way back to the homepage. A page the walk does not reach is drawn only as an orphan or a
 * JavaScript-only page, which the layout places in its band.
 */
export function everyPage(
  pages: readonly PageResult[],
  links: readonly ViewDataset['link_edges'][number][],
): LayoutNode[] {
  const page = new Map(pages.map((p) => [p.url, p]));
  const outgoing = new Map<string, (typeof links)[number][]>();
  for (const l of [...links].sort(
    (a, b) => byUrl(a.from_url, b.from_url) || byUrl(a.to_url, b.to_url) || +a.js_only - +b.js_only,
  )) {
    outgoing.set(l.from_url, [...(outgoing.get(l.from_url) ?? []), l]);
  }
  const home = pages
    .filter((p) => p.depth === 0)
    .sort((a, b) => b.links_in - a.links_in || byUrl(a.url, b.url))[0];
  const reachedBy = new Map<string, (typeof links)[number] | null>(home ? [[home.url, null]] : []);
  const depth = new Map<string, number>(home ? [[home.url, 0]] : []);
  for (let queue = home ? [home.url] : [], k = 0; k < queue.length; k++) {
    const from = queue[k]!;
    for (const l of outgoing.get(from) ?? []) {
      if (reachedBy.has(l.to_url)) continue;
      reachedBy.set(l.to_url, l);
      depth.set(l.to_url, depth.get(from)! + 1);
      queue.push(l.to_url);
    }
  }
  const pageAbove = (url: string): string | null => {
    for (let l = reachedBy.get(url); l; l = reachedBy.get(l.from_url)) {
      if (page.has(l.from_url)) return l.from_url;
    }
    return null;
  };
  return [...page.values()]
    .sort((a, b) => byUrl(a.url, b.url))
    .flatMap((p): LayoutNode[] => {
      const kind = p.js_only ? 'js_only' : p.is_orphan ? 'orphan' : 'page';
      const reached = depth.has(p.url);
      if (!reached && kind === 'page') return [];
      const by = reachedBy.get(p.url);
      return [
        {
          id: p.url,
          parent: reached ? pageAbove(p.url) : null,
          depth: depth.get(p.url) ?? null,
          kind,
          via: by ? (by.js_only ? 'javascript' : 'link') : null,
        },
      ];
    });
}

const ORDER = (a: MapNodeView, b: MapNodeView) =>
  (a.depth ?? Infinity) - (b.depth ?? Infinity) || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);

export function linkMapView(
  d: ViewDataset,
  checkId: string,
  {
    scope,
    asFirstSeen = false,
    hrefs = NO_HREFS,
    generated,
    drawing: stored,
    plan,
  }: LinkMapOptions,
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
  // Whether `all` was laid out here from the record, which leaves out a page no link path reaches.
  let fromRecord = false;
  if (generated) {
    drawing = generated;
    drawnScope = 'generated';
  } else if (scope === 'hubs' && records.length) {
    if (stored) {
      drawing = stored;
    } else {
      const nodes = hubsAndNeighbours(records, links);
      drawing = { nodes, positions: layoutMap(nodes) };
    }
    drawnScope = 'hubs';
  } else {
    const recorded = drawingOf(checkId);
    if (recorded) {
      drawing = recorded;
    } else {
      const nodes = everyPage(records, links);
      drawing = { nodes, positions: layoutMap(nodes) };
      fromRecord = true;
    }
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
  const opened = new Set(openFixes(d, check, plan).map((f) => f.id));
  const freeFix = (path: string) => {
    const r = drawing.nodes.find((n) => pathOf(n.id) === path);
    const page = r ? record(r.id) : undefined;
    const f = page ? fixOf(page) : undefined;
    return f !== undefined && opened.has(f.id);
  };
  // First a page whose crawler requests the record holds, so the panel shows that evidence too.
  const initial =
    order.find((p) => details[p]?.fix && details[p]?.access?.tagged && freeFix(p)) ??
    order.find((p) => details[p]?.fix && freeFix(p)) ??
    order.find((p) => details[p]?.fix) ??
    order.find((p) => details[p]) ??
    order[0] ??
    // A drawing with no node selects nothing; the page shows a notice in place of the explorer.
    '';

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
        ? fromRecord && nodes.length < crawled
          ? `${count(nodes.length)} of the ${count(crawled)} pages crawled, each drawn from the page whose link first reached it. A page no link path from the homepage reaches is drawn only when it is an orphan or reachable only through JavaScript. ${select}${orphansDrawn}`
          : `Every page crawled, ${count(nodes.length)} of ${count(crawled)}, each drawn from the page whose link first reached it. ${select}${orphansDrawn}`
        : `A generated graph of ${count(nodes.length)} pages for the performance test, drawn ${nodes.length > EXPLORER_SVG_MAX ? 'on a canvas' : 'as SVG'}. It is not an audit, so no page has a record. ${select}`;

  const keptUntil = keptUntilOf(d, check, asFirstSeen);
  const kept = keptUntil === null ? null : dayTimeUtc(keptUntil);
  const structureFixes = sectionFixes(d, check, 'structure', plan);
  const open = structureFixes.open.length;
  const anyFix = structureFixes.open.length + structureFixes.proCount > 0;
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
        label: `Fixes for site structure · ${anyFix ? `${open} open` : 'nothing to fix'}`,
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
          },
    legend: {
      jsOnly: jsIds.length > 0,
      orphans: orphanIds.length > 0,
      jsLinks: nodes.some((n) => n.js),
    },
  };
}
