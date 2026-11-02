/**
 * What each link-map explorer preview renders: the bad site zoomed to its hubs (Final-LinkMap) and
 * with every page, the clean and challenged sites with every page (their records hold too few
 * pages to find hubs in), and the generated 2,000-node graph on the canvas, framed as the bad
 * site's audit so the page around it is a real one. Kept apart from the pages so a test renders
 * exactly what a page renders.
 */
import { fixture, type FixtureName } from '../../../../lib/v2/fixtures';
import { generatedGraph } from '../../../../lib/v2/generated-graph';
import { layoutMap } from '../../../../lib/v2/map-layout';
import { CHECKS } from '../../../../lib/v2/recordings';
import { linkMapView } from '../../../../lib/v2/view/link-map';
import type { MapDrawing } from '../../../../lib/v2/view/map';
import { fixHref } from './fixes';
import { MAP_PATHS, segmentHrefs, type SegmentVariant } from './segments';

export type MapVariant = 'bad-site' | 'all' | 'clean' | 'challenged' | 'large';

interface Source {
  fixture: FixtureName;
  check: string;
  segments: SegmentVariant;
  scope: 'hubs' | 'all';
  path: string;
  asFirstSeen: boolean;
  generated?: true;
}

export const LARGE_MAP_SIZE = 2_000;

/** The seed of the engine's 2,000-node layout test (generated-graph.ts). */
const LARGE_MAP_SEED = 2026;

export const MAP_SOURCES: Record<MapVariant, Source> = {
  'bad-site': {
    fixture: 'bad-site',
    check: CHECKS.badFirstAudit,
    segments: 'bad-site',
    scope: 'hubs',
    path: MAP_PATHS['bad-site'].hubs,
    asFirstSeen: true,
  },
  all: {
    fixture: 'bad-site',
    check: CHECKS.badFirstAudit,
    segments: 'bad-site',
    scope: 'all',
    path: MAP_PATHS['bad-site'].all,
    asFirstSeen: true,
  },
  clean: {
    fixture: 'clean-site',
    check: CHECKS.cleanFirstAudit,
    segments: 'clean',
    scope: 'all',
    path: MAP_PATHS.clean.all,
    asFirstSeen: false,
  },
  challenged: {
    fixture: 'challenged-site',
    check: CHECKS.challengedFirstAudit,
    segments: 'challenged',
    scope: 'all',
    path: MAP_PATHS.challenged.all,
    asFirstSeen: false,
  },
  large: {
    fixture: 'bad-site',
    check: CHECKS.badFirstAudit,
    segments: 'bad-site',
    scope: 'all',
    path: '/v2-preview/screens/map/large',
    asFirstSeen: true,
    generated: true,
  },
};

let large: MapDrawing | null = null;

/** The generated graph, laid out once per server process (the layout takes about two seconds). */
export function largeDrawing(): MapDrawing {
  if (!large) {
    const nodes = generatedGraph(LARGE_MAP_SIZE, LARGE_MAP_SEED);
    large = { nodes, positions: layoutMap(nodes) };
  }
  return large;
}

export function mapPreview(variant: MapVariant) {
  const s = MAP_SOURCES[variant];
  return linkMapView(fixture(s.fixture), s.check, {
    scope: s.scope,
    asFirstSeen: s.asFirstSeen,
    hrefs: { ...segmentHrefs(s.segments), fix: fixHref(s.check) },
    generated: s.generated ? largeDrawing() : undefined,
  });
}
