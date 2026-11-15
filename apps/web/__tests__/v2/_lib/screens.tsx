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
import { FirstCheckScreen } from '../../../components/v2/screens/site/FirstCheckScreen';
import { AccountStateScreen } from '../../../components/v2/screens/account/AccountStateScreen';
import {
  dashboardPreview,
  firstCheckPreview,
  noSiteEarlierPreview,
  noSitePreview,
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
  deletePreview,
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
import { DeleteScreen } from '../../../components/v2/screens/settings/DeleteScreen';
import { TrialEndScreen } from '../../../components/v2/screens/trial-end/TrialEndScreen';
import { ChangesLogScreen } from '../../../components/v2/screens/changes-log/ChangesLogScreen';
import { InviteScreen } from '../../../components/v2/screens/invite/InviteScreen';
import { SeatsScreen } from '../../../components/v2/screens/seats/SeatsScreen';
import { ProofScreen } from '../../../components/v2/screens/proof/ProofScreen';
import { RecipientLinkScreen } from '../../../components/v2/screens/share/RecipientLinkScreen';
import {
  REPORT_LINK_PREVIEWS,
  type ReportLinkPreview,
} from '../../../app/(v2-preview)/v2-preview/_preview/report-link';
import {
  PROOF_PREVIEWS,
  proofPreview,
  type ProofPreview,
} from '../../../app/(v2-preview)/v2-preview/_preview/proof';
import {
  INVITE_PREVIEWS,
  SEATS_PREVIEWS,
  seatsPreview,
  type InvitePreview,
  type SeatsPreview,
} from '../../../app/(v2-preview)/v2-preview/_preview/seats';
import { ClientScreen } from '../../../components/v2/screens/agency/ClientScreen';
import { MatrixScreen } from '../../../components/v2/screens/agency/MatrixScreen';
import { ClientReportsScreen } from '../../../components/v2/screens/agency/ReportsScreen';
import {
  AGENCY_PREVIEWS,
  CLIENT_PREVIEWS,
  agencyPreview,
  clientPreview,
  type AgencyPreview,
  type ClientPreview,
} from '../../../app/(v2-preview)/v2-preview/_preview/agency';
import {
  CLIENT_REPORTS_PREVIEWS,
  clientReportsPreview,
  type ClientReportsPreview,
} from '../../../app/(v2-preview)/v2-preview/_preview/agency-reports';

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
  // CC-26b: the states a live account reaches that no fixture moment holds.
  '/v2-preview/screens/dashboard/no-site': () => <DashboardScreen data={noSitePreview()} />,
  // CC-36 D5: a viewer who used v1.
  '/v2-preview/screens/dashboard/earlier': () => <DashboardScreen data={noSiteEarlierPreview()} />,
  '/v2-preview/screens/site/first-check': () => <FirstCheckScreen data={firstCheckPreview()} />,
  '/v2-preview/screens/dashboard/no-account': () => <AccountStateScreen state="no_account" />,
  '/v2-preview/screens/dashboard/ambiguous': () => <AccountStateScreen state="ambiguous" />,
};

/**
 * CC-27's account screens, listed apart from CC-26's so each step's previews are named by the step.
 * The verdict-copy guard and account-control-names.test.tsx read both maps.
 */
export const CC27_ELEMENTS: Record<string, () => React.ReactElement> = {
  '/v2-preview/screens/changes-log': () => <ChangesLogScreen data={changesLogPreview()} />,
  '/v2-preview/screens/alerts': () => <AlertsScreen data={alertsPreview('home')} />,
  '/v2-preview/screens/alerts/free': () => <AlertsScreen data={alertsPreview('clean')} />,
  '/v2-preview/screens/reports': () => <ReportsScreen data={reportsPreview('home')} />,
  '/v2-preview/screens/reports/agency': () => <ReportsScreen data={reportsPreview('withheld')} />,
  '/v2-preview/screens/settings': () => <SettingsScreen data={settingsPreview('home')} />,
  '/v2-preview/screens/settings/free': () => <SettingsScreen data={settingsPreview('clean')} />,
  '/v2-preview/screens/settings/delete': () => <DeleteScreen data={deletePreview()} />,
  '/v2-preview/screens/trial-end': () => <TrialEndScreen data={trialEndPreview()} />,
};

/** CC-31 workstream B2: the proof page, by registry path. */
export const CC31_PROOF_ELEMENTS: Record<string, () => React.ReactElement> = Object.fromEntries(
  (Object.keys(PROOF_PREVIEWS) as ProofPreview[]).map((path) => [
    path,
    () => <ProofScreen data={proofPreview(path)} />,
  ]),
);

/** CC-31 workstream B2: the page a client report's recipient lands on, by registry path. */
export const CC31_REPORT_LINK_ELEMENTS: Record<string, () => React.ReactElement> =
  Object.fromEntries(
    (Object.keys(REPORT_LINK_PREVIEWS) as ReportLinkPreview[]).map((path) => [
      path,
      () => <RecipientLinkScreen data={REPORT_LINK_PREVIEWS[path]()} />,
    ]),
  );

/** CC-31 workstream A: the Seats screen and the invitation page, by registry path. */
export const CC31_SEAT_ELEMENTS: Record<string, () => React.ReactElement> = {
  ...Object.fromEntries(
    (Object.keys(SEATS_PREVIEWS) as SeatsPreview[]).map((path) => [
      path,
      () => <SeatsScreen data={seatsPreview(path)} />,
    ]),
  ),
  ...Object.fromEntries(
    (Object.keys(INVITE_PREVIEWS) as InvitePreview[]).map((path) => [
      path,
      () => <InviteScreen data={INVITE_PREVIEWS[path]()} />,
    ]),
  ),
};

/** CC-31's agency screens: each state of the client matrix, the client page, and client reports. */
export const CC31_ELEMENTS: Record<string, () => React.ReactElement> = {
  ...Object.fromEntries(
    (Object.keys(AGENCY_PREVIEWS) as AgencyPreview[]).map((path) => [
      path,
      () => <MatrixScreen data={agencyPreview(path)} />,
    ]),
  ),
  ...Object.fromEntries(
    (Object.keys(CLIENT_PREVIEWS) as ClientPreview[]).map((path) => [
      path,
      () => {
        const data = clientPreview(path);
        if (data?.kind !== 'client') throw new Error(`${path} has no client page to render`);
        return <ClientScreen data={data} />;
      },
    ]),
  ),
  ...Object.fromEntries(
    (Object.keys(CLIENT_REPORTS_PREVIEWS) as ClientReportsPreview[]).map((path) => [
      path,
      () => <ClientReportsScreen data={clientReportsPreview(path)} />,
    ]),
  ),
};
