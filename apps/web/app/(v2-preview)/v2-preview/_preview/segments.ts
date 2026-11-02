/**
 * What each segment preview renders, from the contract fixtures: each of the six segments for each
 * fixture's first audit (the checks the Result previews show, so a door and its segment agree),
 * and Changes for two later checks that found changes. Kept apart from the pages so a test renders
 * exactly what a page renders.
 */
import { fixture, type FixtureName } from '../../../../lib/v2/fixtures';
import { CHECKS } from '../../../../lib/v2/recordings';
import { accessView } from '../../../../lib/v2/view/segment/access';
import { changesView } from '../../../../lib/v2/view/segment/changes';
import { contentView } from '../../../../lib/v2/view/segment/content';
import type {
  SegmentHrefs,
  SegmentKey,
  SegmentOptions,
} from '../../../../lib/v2/view/segment/frame';
import { nojsView } from '../../../../lib/v2/view/segment/nojs';
import { signalsView } from '../../../../lib/v2/view/segment/signals';
import { structureView } from '../../../../lib/v2/view/segment/structure';

export type SegmentVariant = 'bad-site' | 'clean' | 'challenged';

/** The Changes previews of checks after the first: changes found, and who was told. */
export type ChangesHistory = 'history' | 'challenged-history';

interface Source {
  fixture: FixtureName;
  check: string;
  /** The page's path after the segment's own: '' for the bad site. */
  suffix: string;
  /** The Result preview of the same check: the "Overview" tab. */
  overview: string;
  asFirstSeen: boolean;
}

export const SEGMENT_SOURCES: Record<SegmentVariant, Source> = {
  'bad-site': {
    fixture: 'bad-site',
    check: CHECKS.badFirstAudit,
    suffix: '',
    overview: '/v2-preview/screens/result',
    asFirstSeen: true,
  },
  clean: {
    fixture: 'clean-site',
    check: CHECKS.cleanFirstAudit,
    suffix: '/clean',
    overview: '/v2-preview/screens/result/clean',
    asFirstSeen: false,
  },
  challenged: {
    fixture: 'challenged-site',
    check: CHECKS.challengedFirstAudit,
    suffix: '/challenged',
    overview: '/v2-preview/screens/result/challenged',
    asFirstSeen: false,
  },
};

export const HISTORY_SOURCES: Record<ChangesHistory, { fixture: FixtureName; check: string }> = {
  /** example-outfitter.com's weekly check that found the robots.txt change (FACTS dashboard day). */
  history: { fixture: 'bad-site', check: 'c0000000-0000-4000-8000-000000000006' },
  /** granitepeak.example's re-check after a fix, which found the product text fall. */
  'challenged-history': {
    fixture: 'challenged-site',
    check: 'c0000000-0000-4000-8000-0000000000ca',
  },
};

export const segmentPath = (key: SegmentKey, suffix = '') =>
  `/v2-preview/screens/segment/${key}${suffix}`;

/**
 * The link-map explorer of each variant: the bad site's opens on its hubs, with every page one
 * click on; the other two sites' records hold too few pages to find hubs in, so both open on every
 * page.
 */
export const MAP_PATHS: Record<SegmentVariant, { hubs: string; all: string }> = {
  'bad-site': { hubs: '/v2-preview/screens/map', all: '/v2-preview/screens/map/all' },
  clean: { hubs: '/v2-preview/screens/map/clean', all: '/v2-preview/screens/map/clean' },
  challenged: {
    hubs: '/v2-preview/screens/map/challenged',
    all: '/v2-preview/screens/map/challenged',
  },
};

/** The tabs, the back and next links and the explorer of a variant: its own pages, and its Result. */
export function segmentHrefs(variant: SegmentVariant): SegmentHrefs {
  const { suffix, overview } = SEGMENT_SOURCES[variant];
  return { overview, segment: (k) => segmentPath(k, suffix), map: MAP_PATHS[variant] };
}

const options = (variant: SegmentVariant): SegmentOptions => ({
  asFirstSeen: SEGMENT_SOURCES[variant].asFirstSeen,
  hrefs: segmentHrefs(variant),
});

const source = (variant: SegmentVariant) => {
  const s = SEGMENT_SOURCES[variant];
  return [fixture(s.fixture), s.check] as const;
};

export const SEGMENT_PREVIEWS = {
  access: (v: SegmentVariant) => accessView(...source(v), options(v)),
  nojs: (v: SegmentVariant) => nojsView(...source(v), options(v)),
  structure: (v: SegmentVariant) => structureView(...source(v), options(v)),
  content: (v: SegmentVariant) => contentView(...source(v), options(v)),
  signals: (v: SegmentVariant) => signalsView(...source(v), options(v)),
  changes: (v: SegmentVariant) => changesView(...source(v), options(v)),
} satisfies Record<SegmentKey, (v: SegmentVariant) => unknown>;

/** Changes for a later check: its site's own pages are not previewed, so the links go to "#". */
export function changesHistoryPreview(name: ChangesHistory) {
  const s = HISTORY_SOURCES[name];
  return changesView(fixture(s.fixture), s.check);
}
