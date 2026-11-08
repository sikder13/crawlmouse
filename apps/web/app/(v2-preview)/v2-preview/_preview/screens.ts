/**
 * What each screen preview renders, from the contract fixtures. Kept in one place so the preview
 * pages are one line each and the tests can render exactly what the pages render.
 */
import { fixture } from '../../../../lib/v2/fixtures';
import { stateAt } from '../../../../lib/v2/progress';
import { CHECKS, recording } from '../../../../lib/v2/recordings';
import { homeView } from '../../../../lib/v2/view/home';
import { mapDrawing } from '../../../../lib/v2/view/map';
import { resultStateView, resultView, type ResultPageView } from '../../../../lib/v2/view/result';
import { changesLogView } from '../../../../lib/v2/view/changes-log';
import { ACCOUNT_VIEWERS } from './accounts';
import { fixHref } from './fixes';
import { MAP_PATHS, segmentHrefs } from './segments';

/** Home's data: the bad site's first audit, its example the bad-site recording at its end. */
export function homePreview() {
  return homeView(fixture('bad-site'), CHECKS.badFirstAudit, {
    map: mapDrawing('bad-site'),
    end: stateAt(recording('bad-site').events, Infinity),
  });
}

/** The challenged-site fixture's other checks, which stand in for the Result page's states. */
export const STATE_CHECKS = {
  /** Kestrel Creative's first site, queued for its first audit. */
  empty: 'c0000000-0000-4000-8000-0000000000dd',
  /** granitepeak.example's scheduled re-check, which failed. */
  error: 'c0000000-0000-4000-8000-0000000000cb',
} as const;

export const RESULT_PREVIEWS = {
  'bad-site': () =>
    resultView(fixture('bad-site'), CHECKS.badFirstAudit, {
      map: mapDrawing('bad-site'),
      asFirstSeen: true,
      segmentHref: segmentHrefs('bad-site').segment,
      fixHref: fixHref(CHECKS.badFirstAudit),
      mapHref: MAP_PATHS['bad-site'].hubs,
    }),
  clean: () =>
    resultView(fixture('clean-site'), CHECKS.cleanFirstAudit, {
      map: mapDrawing('clean-site'),
      segmentHref: segmentHrefs('clean').segment,
      fixHref: fixHref(CHECKS.cleanFirstAudit),
      mapHref: MAP_PATHS.clean.hubs,
    }),
  challenged: () =>
    resultView(fixture('challenged-site'), CHECKS.challengedFirstAudit, {
      map: mapDrawing('challenged-site'),
      segmentHref: segmentHrefs('challenged').segment,
      fixHref: fixHref(CHECKS.challengedFirstAudit),
      mapHref: MAP_PATHS.challenged.hubs,
    }),
  loading: (): ResultPageView => ({ state: 'loading' }),
  empty: () => resultStateView(fixture('challenged-site'), STATE_CHECKS.empty),
  error: () => resultStateView(fixture('challenged-site'), STATE_CHECKS.error),
  // The clean-site result viewed at the moment it expires.
  expired: () => {
    const d = fixture('clean-site');
    const at = d.checks.find((c) => c.id === CHECKS.cleanFirstAudit)!.expires_at!;
    return resultStateView(d, CHECKS.cleanFirstAudit, at);
  },
} satisfies Record<string, () => ResultPageView>;

export type ResultPreview = keyof typeof RESULT_PREVIEWS;

// ── CC-27: the account screens after the dashboard and the site page ──────────────────────────

/** A preview page's query: the filters a link set, as Next hands them over. */
export type PreviewQuery = Record<string, string | string[] | undefined>;

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** The Changes log's preview path: its filter links point back at it. */
export const CHANGES_LOG_PATH = '/v2-preview/screens/changes-log';

/** The Changes log on bad-site, read as Final-Dashboard reads it, filtered by the page's query. */
export const changesLogPreview = (query: PreviewQuery = {}) =>
  changesLogView(
    fixture('bad-site'),
    ACCOUNT_VIEWERS.home(),
    { site: one(query.site), kind: one(query.kind), since: one(query.since) },
    CHANGES_LOG_PATH,
  );
