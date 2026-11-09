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
import { alertsView } from '../../../../lib/v2/view/alerts';
import { changesLogView } from '../../../../lib/v2/view/changes-log';
import { reportsView } from '../../../../lib/v2/view/reports';
import { deleteStepView, settingsView } from '../../../../lib/v2/view/settings';
import { trialEndView, trialEndViewer } from '../../../../lib/v2/view/trial-end';
import { ACCOUNT_VIEWERS, BAD_ACCOUNT_ID, DATASET } from './accounts';
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

/**
 * Alerts: on bad-site as Final-Dashboard reads it (Final-Alerts), and on CC-26's stand-in Free
 * account over clean-site, which has no rules and has sent nothing (Slack gated).
 */
export const alertsPreview = (name: 'home' | 'clean') =>
  alertsView(fixture(DATASET[name]), ACCOUNT_VIEWERS[name]());

/** Reports: its preview paths, which the site picker reloads. */
export const REPORTS_PATHS = {
  home: '/v2-preview/screens/reports',
  withheld: '/v2-preview/screens/reports/agency',
} as const;

/**
 * Reports: on bad-site (Final-Reports), and on Northwind's Agency account over challenged-site,
 * whose client reports exercise the Scheduled list (owner ruling 8). `?site=` picks the site.
 */
export const reportsPreview = (name: keyof typeof REPORTS_PATHS, query: PreviewQuery = {}) =>
  reportsView(
    fixture(DATASET[name]),
    ACCOUNT_VIEWERS[name](),
    { site: one(query.site) },
    REPORTS_PATHS[name],
  );

/** Settings: on bad-site (Final-Settings), and on CC-26's stand-in Free account. */
export const settingsPreview = (name: 'home' | 'clean') =>
  settingsView(fixture(DATASET[name]), ACCOUNT_VIEWERS[name]());

/**
 * Trial ending on bad-site, read at the trial's reminder: three days before trial_ends_at, after the
 * fixture's as_of (SPEC 27 renders what the fixture holds between the two moments). The
 * challenged-site variant was dropped (owner ruling 2): no account there has a trial that overlaps a
 * withheld result.
 */
export const trialEndPreview = () => {
  const d = fixture('bad-site');
  return trialEndView(d, trialEndViewer(d, BAD_ACCOUNT_ID));
};

/** The step “Delete…” opens, on bad-site (owner ruling 12). */
export const deletePreview = () => deleteStepView(fixture(DATASET.home), ACCOUNT_VIEWERS.home());

/** Each CC-27 preview: the fixture it reads, who reads it and when, and its view model. */
export const CC27_PREVIEWS = {
  '/v2-preview/screens/alerts': {
    fixture: DATASET.home,
    viewer: ACCOUNT_VIEWERS.home,
    view: () => alertsPreview('home'),
  },
  '/v2-preview/screens/alerts/free': {
    fixture: DATASET.clean,
    viewer: ACCOUNT_VIEWERS.clean,
    view: () => alertsPreview('clean'),
  },
  '/v2-preview/screens/reports': {
    fixture: DATASET.home,
    viewer: ACCOUNT_VIEWERS.home,
    view: () => reportsPreview('home'),
  },
  '/v2-preview/screens/reports/agency': {
    fixture: DATASET.withheld,
    viewer: ACCOUNT_VIEWERS.withheld,
    view: () => reportsPreview('withheld'),
  },
  '/v2-preview/screens/settings': {
    fixture: DATASET.home,
    viewer: ACCOUNT_VIEWERS.home,
    view: () => settingsPreview('home'),
  },
  '/v2-preview/screens/settings/free': {
    fixture: DATASET.clean,
    viewer: ACCOUNT_VIEWERS.clean,
    view: () => settingsPreview('clean'),
  },
  '/v2-preview/screens/settings/delete': {
    fixture: DATASET.home,
    viewer: ACCOUNT_VIEWERS.home,
    view: deletePreview,
  },
  '/v2-preview/screens/trial-end': {
    fixture: 'bad-site',
    viewer: () => trialEndViewer(fixture('bad-site'), BAD_ACCOUNT_ID),
    view: trialEndPreview,
  },
  '/v2-preview/screens/changes-log': {
    fixture: DATASET.home,
    viewer: ACCOUNT_VIEWERS.home,
    view: () => changesLogPreview(),
  },
} as const;
