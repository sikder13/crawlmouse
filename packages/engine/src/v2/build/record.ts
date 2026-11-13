/**
 * The Check record of a built check, and the parts of it no engine step returns whole: robots.txt as
 * the diff and Content Signals read it, the declaration signals, the stack, and the structure counts.
 */
import {
  type AccessTest,
  type Check,
  type CrawlBatchResult,
  type DeclarationFetch,
  type FrontendMarker,
  type PageResult,
} from '@crawlmouse/types/v2';
import { TOP_HUB_FRACTION } from '../../analysis/structure.js';
import { declarationSignal, DECLARATIONS, type DeclarationKind } from '../access/declarations.js';
import { isGraded } from '../grade/technical-seo.js';
import { siteEstimate } from '../render/estimate.js';
import type { Assembled } from './assemble.js';
import type { Graded } from './grade.js';
import type { BuildInput } from './types.js';

const originOf = (url: string): string => new URL(url).origin;

/**
 * robots.txt on the homepage's origin, as the first crawl batch that read it recorded it: the whole
 * file when the worker kept it whole, '' when the site has none (it answered 4xx, or an HTML page), and
 * null when it could not be read or was not kept whole, so nothing is read from part of a file.
 */
export function robotsText(crawl: readonly CrawlBatchResult[], homepage: string): string | null {
  const origin = originOf(homepage);
  const reading = crawl.flatMap((b) => b.robots).find((r) => r.origin === origin);
  if (reading === undefined) return null;
  if (reading.state === 'none') return '';
  return reading.state === 'rules' && reading.body_complete ? reading.body : null;
}

/** What one declaration GET answered, on the homepage's origin, from the first batch that asked. */
function probeOf(crawl: readonly CrawlBatchResult[], homepage: string, kind: DeclarationKind) {
  const origin = originOf(homepage);
  const fetches: DeclarationFetch[] = crawl
    .flatMap((b) => b.declarations)
    .filter((d) => originOf(d.origin) === origin && d.path === DECLARATIONS[kind].path);
  const asked = fetches.find((d) => d.state !== 'not_requested');
  if (asked === undefined) return null;
  return {
    status: asked.status,
    media_type: asked.media_type,
    bytes: asked.bytes_complete ? asked.bytes : null,
  };
}

/** Cloudflare's error 1020 on a crawler test names the edge; no other vendor is read yet. */
function edgeOf(tests: readonly AccessTest[]): NonNullable<Check['stack']>['edge'] {
  return tests.some((t) => t.identity_role === 'crawler' && t.cause === 'cloudflare_1020')
    ? {
        vendor: 'Cloudflare',
        detected_from: "a crawler test answered with Cloudflare's error 1020",
      }
    : null;
}

type Frontend = NonNullable<NonNullable<Check['stack']>['frontend']>;

/**
 * The front ends a homepage's markers name, in the order they are taken (CC-32 D5): Hydrogen, then
 * Next.js, then a Liquid theme. Hydrogen's header is set by Hydrogen itself, which can run inside a
 * Next.js app (the Shopify/hydrogen repository's examples/nextjs), so a page carrying both is taken
 * as Hydrogen. The WordPress and Webflow markers name no front end here: the CMS already names that
 * framework (packets/stack.ts).
 */
export const FRONTENDS: ReadonlyArray<{
  framework: Frontend['framework'];
  name: string;
  markers: readonly FrontendMarker[];
}> = [
  {
    framework: 'shopify_hydrogen',
    name: 'Shopify Hydrogen',
    markers: ['hydrogen_powered_by_header'],
  },
  { framework: 'nextjs', name: 'Next.js', markers: ['next_static_path', 'next_data_script'] },
  {
    framework: 'shopify_liquid',
    name: 'Shopify Liquid',
    markers: ['shopify_theme_object', 'shopify_section_class'],
  },
];

/** What each marker that names a front end is, in words, for `detected_from`. */
const MARKER_WORDS: Readonly<Partial<Record<FrontendMarker, string>>> = {
  next_static_path: 'asset paths under /_next/static/',
  next_data_script: '__NEXT_DATA__ script',
  shopify_theme_object: 'Shopify.theme script',
  shopify_section_class: 'shopify-section elements',
  hydrogen_powered_by_header: 'powered-by response header',
};

/** The first front end in FRONTENDS a marker names, said from the markers found that name it. */
function frontendOf(markers: readonly FrontendMarker[]): Frontend | null {
  for (const f of FRONTENDS) {
    const found = f.markers.filter((m) => markers.includes(m));
    if (found.length === 0) continue;
    return {
      name: f.name,
      framework: f.framework,
      version: null,
      router: null,
      detected_from: `homepage ${found.map((m) => MARKER_WORDS[m]).join(' and ')}`,
    };
  }
  return null;
}

/**
 * The check's stack: the front end the homepage's markers name, the CMS the worker recognised on the
 * homepage, and the edge vendor. A row written before the worker recorded markers names no front end.
 */
export function stackOf(
  assembled: Pick<Assembled, 'rows' | 'homepage_url' | 'access_tests'>,
): NonNullable<Check['stack']> {
  const home = assembled.rows.get(assembled.homepage_url);
  return {
    frontend: frontendOf(home?.stack_signals?.frontend_markers ?? []),
    // detectCms answers `custom` when no signature matched: no CMS was recognised, which is not one.
    backend:
      home?.stack_signals && home.stack_signals.cms !== 'custom'
        ? {
            cms: home.stack_signals.cms,
            detected_from: `homepage ${home.stack_signals.detected_from}`,
          }
        : null,
    edge: edgeOf(assembled.access_tests),
  };
}

/** The structure counts the screens read, over the graded population where they are rates. */
export function structureOf(
  pages: readonly PageResult[],
  assembled: Pick<Assembled, 'edges' | 'analysis'>,
): NonNullable<Check['structure']> {
  const graded = pages.filter(isGraded);
  const deep = graded.filter((p) => p.depth !== null);
  const ranks = [...assembled.analysis.ranks.values()].sort((a, b) => b - a);
  const total = ranks.reduce((n, v) => n + v, 0);
  // v1's top hub tier (analysis/structure.ts hubConcentrationScore): the top 5% of pages by PageRank.
  const hubs = ranks.length === 0 ? 0 : Math.max(1, Math.ceil(TOP_HUB_FRACTION * ranks.length));
  const top = ranks.slice(0, hubs).reduce((n, v) => n + v, 0);
  return {
    internal_links: assembled.edges.length,
    orphan_pages: pages.filter((p) => p.is_orphan).length,
    js_only_pages: pages.filter((p) => p.js_only).length,
    pages_deeper_than_3: deep.filter((p) => p.depth! > 3).length,
    avg_click_depth: deep.length === 0 ? 0 : deep.reduce((n, p) => n + p.depth!, 0) / deep.length,
    hubs,
    hub_pagerank_share: total > 0 ? top / total : 0,
    generic_anchor_share: assembled.analysis.genericAnchorFraction,
  };
}

export function checkRecord(
  input: Pick<BuildInput, 'check'>,
  crawl: readonly CrawlBatchResult[],
  access: readonly { finished_at: string }[],
  assembled: Assembled,
  graded: Graded,
): Check {
  const { grades } = graded;
  const estimate = siteEstimate(
    graded.pages
      .filter(isGraded)
      .map((p) => ({ template_key: p.template_key, text_share: p.without_js?.text_share ?? null })),
  );
  const tested = access.map((b) => b.finished_at).sort((a, b) => Date.parse(a) - Date.parse(b));
  return {
    id: input.check.id,
    site_id: input.check.site_id,
    previous_check_id: input.check.previous_check_id,
    status: assembled.status.status,
    trigger: input.check.trigger,
    grade_version: grades.grade_version,
    queued_at: input.check.queued_at,
    started_at: input.check.started_at,
    finished_at: input.check.finished_at,
    tested_at: tested.at(-1) ?? null,
    expires_at: input.check.expires_at,
    deferred_until: null,
    failure_reason: null,
    result_email: null,
    coverage: assembled.coverage,
    technical_seo: grades.technical_seo,
    ai_readability: grades.ai_readability,
    structure: structureOf(graded.pages, assembled),
    without_js:
      estimate.site_text_share === null ? null : { site_text_share: estimate.site_text_share },
    content: grades.content,
    signals: [
      ...grades.signals,
      ...(Object.keys(DECLARATIONS) as DeclarationKind[]).map((k) =>
        declarationSignal(k, probeOf(crawl, assembled.homepage_url, k)),
      ),
    ],
    crawlers: graded.access.crawlers.map(
      ({ counts: _c, supporting: _s, intent: _i, extent: _e, ...row }) => ({
        ...row,
        text_share: null,
      }),
    ),
    stack: stackOf(assembled),
    competitors: [],
    // The contract keeps progress for a running check only (CheckSchema check_progress).
    progress: null,
  };
}
