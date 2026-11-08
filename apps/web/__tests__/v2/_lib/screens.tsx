/**
 * Every screen preview as an element, built the way its page builds it, so a test renders exactly
 * what the preview serves.
 */
import { HomeScreen } from '../../../components/v2/screens/home/HomeScreen';
import { CrawlScreen } from '../../../components/v2/screens/crawl/CrawlScreen';
import { ResultScreen } from '../../../components/v2/screens/result/ResultScreen';
import { ResultState } from '../../../components/v2/screens/result/ResultStates';
import { DashboardScreen } from '../../../components/v2/screens/dashboard/DashboardScreen';
import { SiteScreen } from '../../../components/v2/screens/site/SiteScreen';
import {
  dashboardPreview,
  shellPreview,
  sitePreview,
} from '../../../app/(v2-preview)/v2-preview/_preview/accounts';
import { crawlProps } from '../../../app/(v2-preview)/v2-preview/_preview/CrawlPreview';
import {
  RESULT_PREVIEWS,
  homePreview,
  type ResultPreview,
  alertsPreview,
  changesLogPreview,
  reportsPreview,
  settingsPreview,
  trialEndPreview,
} from '../../../app/(v2-preview)/v2-preview/_preview/screens';
import type { RecordingName } from '../../../lib/v2/recordings';
import {
  ChangesHistoryPreview,
  SegmentPreview,
} from '../../../app/(v2-preview)/v2-preview/_preview/SegmentPreview';
import type {
  ChangesHistory,
  SegmentVariant,
} from '../../../app/(v2-preview)/v2-preview/_preview/segments';
import type { SegmentKey } from '../../../lib/v2/view/segment/frame';
import { AlertsScreen } from '../../../components/v2/screens/alerts/AlertsScreen';
import { ReportsScreen } from '../../../components/v2/screens/reports/ReportsScreen';
import { SettingsScreen } from '../../../components/v2/screens/settings/SettingsScreen';
import { TrialEndScreen } from '../../../components/v2/screens/trial-end/TrialEndScreen';
import { ChangesLogScreen } from '../../../components/v2/screens/changes-log/ChangesLogScreen';

export const homeData = homePreview;

export const homeElement = () => <HomeScreen data={homeData()} />;

export function resultElement(name: ResultPreview) {
  const data = RESULT_PREVIEWS[name]();
  return data.state === 'result' ? <ResultScreen data={data} /> : <ResultState data={data} />;
}

export const RESULT_NAMES = Object.keys(RESULT_PREVIEWS) as ResultPreview[];

export const crawlElement = (name: RecordingName, at?: string) => (
  <CrawlScreen {...crawlProps(name, { at })} />
);

export const SEGMENT_VARIANTS: SegmentVariant[] = ['bad-site', 'clean', 'challenged'];

export const segmentElement = (segment: SegmentKey, variant: SegmentVariant) => (
  <SegmentPreview segment={segment} variant={variant} />
);

export const changesHistoryElement = (name: ChangesHistory) => (
  <ChangesHistoryPreview name={name} />
);

/** The account screens' previews, by registry path, built as their pages build them. */
export const ACCOUNT_ELEMENTS: Record<string, () => React.ReactElement> = {
  '/v2-preview/screens/dashboard/day0': () => <DashboardScreen data={dashboardPreview('day0')} />,
  '/v2-preview/screens/dashboard': () => <DashboardScreen data={dashboardPreview('home')} />,
  '/v2-preview/screens/dashboard/clean': () => <DashboardScreen data={dashboardPreview('clean')} />,
  '/v2-preview/screens/dashboard/withheld': () => (
    <DashboardScreen data={dashboardPreview('withheld')} />
  ),
  '/v2-preview/screens/site': () => (
    <SiteScreen data={sitePreview('home')} shell={shellPreview('home')} />
  ),
  '/v2-preview/screens/site/clean': () => (
    <SiteScreen data={sitePreview('clean')} shell={shellPreview('clean')} />
  ),
  '/v2-preview/screens/site/withheld': () => (
    <SiteScreen data={sitePreview('withheld')} shell={shellPreview('withheld')} />
  ),
};

/**
 * CC-27's account screens, apart from CC-26's: account-control-names.test.tsx pins the length of
 * ACCOUNT_ELEMENTS, and CC-27 does not edit that file. The verdict-copy guard reads both maps.
 */
export const CC27_ELEMENTS: Record<string, () => React.ReactElement> = {
  '/v2-preview/screens/changes-log': () => <ChangesLogScreen data={changesLogPreview()} />,
  '/v2-preview/screens/alerts': () => <AlertsScreen data={alertsPreview('home')} />,
  '/v2-preview/screens/alerts/free': () => <AlertsScreen data={alertsPreview('clean')} />,
  '/v2-preview/screens/reports': () => <ReportsScreen data={reportsPreview('home')} />,
  '/v2-preview/screens/reports/agency': () => <ReportsScreen data={reportsPreview('withheld')} />,
  '/v2-preview/screens/settings': () => <SettingsScreen data={settingsPreview('home')} />,
  '/v2-preview/screens/settings/free': () => <SettingsScreen data={settingsPreview('clean')} />,
  '/v2-preview/screens/trial-end': () => <TrialEndScreen data={trialEndPreview()} />,
};
