/**
 * The recordings the screens replay: one per check a screen shows in progress or as a finished map.
 * Each is synthesised from its fixture (synthesise.ts) and memoised; none is captured from the engine.
 */
import { findCheck, fixture } from './fixtures';
import type { Recording } from './recording';
import { synthesise, type Moment, type RecordingSpec } from './synthesise';

export const CHECKS = {
  /** example-outfitter.com, the 25 Oct first audit: the locked Crawl and Result screens. */
  badFirstAudit: 'c0000000-0000-4000-8000-000000000001',
  /** trailhead.example, the first audit: the clean bill. */
  cleanFirstAudit: 'c0000000-0000-4000-8000-000000000065',
  /** trailhead.example, the free re-run still crawling at the fixture's "now". */
  cleanRerun: 'c0000000-0000-4000-8000-000000000066',
  /** granitepeak.example, the first audit: the edge challenges every automated request. */
  challengedFirstAudit: 'c0000000-0000-4000-8000-0000000000c9',
} as const;

/**
 * The moment the locked Crawl screen shows, read off docs/design/v2/screens/Final-Crawl.dc.html:
 * "0:47 elapsed", "128 of about 214 pages", "412 links found so far", and its five fetch lines.
 */
export const LOCKED_CRAWL_MOMENT: Moment = {
  at_ms: 47_000,
  pages_crawled: 128,
  links_found: 412,
  last_fetches: [
    { url: 'https://example-outfitter.com/collections/tents', status: 200, links: 41 },
    { url: 'https://example-outfitter.com/products/ridge-2p', status: 200, links: 12 },
    { url: 'https://example-outfitter.com/products/alpine-stove', status: 200, links: 11 },
    { url: 'https://example-outfitter.com/blog/winter-camping', status: 200, links: 23 },
    { url: 'https://example-outfitter.com/collections/packs', status: 200, links: 38 },
  ],
  source: 'docs/design/v2/screens/Final-Crawl.dc.html',
};

/** The running re-run's snapshot, read from the fixture rather than written here. */
function rerunMoment(): Moment {
  const progress = findCheck(fixture('clean-site'), CHECKS.cleanRerun).progress;
  if (!progress) throw new Error('The clean-site re-run has no progress snapshot');
  return {
    at_ms: progress.elapsed_ms,
    pages_crawled: progress.pages_crawled,
    links_found: progress.links_found,
    last_fetches: progress.recent_fetches,
    source: 'apps/web/lib/fixtures/v2/clean-site.json, the re-run check’s progress',
  };
}

export const RECORDING_NAMES = [
  'bad-site',
  'clean-site',
  'clean-site-rerun',
  'challenged-site',
] as const;
export type RecordingName = (typeof RECORDING_NAMES)[number];

export function recordingSpec(name: RecordingName): RecordingSpec {
  switch (name) {
    case 'bad-site':
      return {
        fixture: 'bad-site',
        check_id: CHECKS.badFirstAudit,
        moments: [LOCKED_CRAWL_MOMENT],
        seed: 214,
      };
    case 'clean-site':
      return { fixture: 'clean-site', check_id: CHECKS.cleanFirstAudit, moments: [], seed: 38 };
    case 'clean-site-rerun':
      return {
        fixture: 'clean-site',
        check_id: CHECKS.cleanRerun,
        shape_check_id: CHECKS.cleanFirstAudit,
        moments: [rerunMoment()],
        seed: 39,
      };
    case 'challenged-site':
      return {
        fixture: 'challenged-site',
        check_id: CHECKS.challengedFirstAudit,
        moments: [],
        seed: 96,
      };
  }
}

const made = new Map<RecordingName, Recording>();

export function recording(name: RecordingName): Recording {
  let r = made.get(name);
  if (!r) {
    const spec = recordingSpec(name);
    r = synthesise(spec, fixture(spec.fixture));
    made.set(name, r);
  }
  return r;
}
