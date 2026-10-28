/**
 * Every screen preview as an element, built the way its page builds it, so a test renders exactly
 * what the preview serves.
 */
import { HomeScreen } from '../../../components/v2/screens/home/HomeScreen';
import { CrawlScreen } from '../../../components/v2/screens/crawl/CrawlScreen';
import { ResultScreen } from '../../../components/v2/screens/result/ResultScreen';
import { ResultState } from '../../../components/v2/screens/result/ResultStates';
import { crawlProps } from '../../../app/(v2-preview)/v2-preview/_preview/CrawlPreview';
import {
  RESULT_PREVIEWS,
  type ResultPreview,
} from '../../../app/(v2-preview)/v2-preview/_preview/screens';
import { fixture } from '../../../lib/v2/fixtures';
import { stateAt } from '../../../lib/v2/progress';
import { CHECKS, recording, type RecordingName } from '../../../lib/v2/recordings';
import { homeView } from '../../../lib/v2/view/home';
import { mapDrawing } from '../../../lib/v2/view/map';

export function homeData() {
  return homeView(fixture('bad-site'), CHECKS.badFirstAudit, {
    map: mapDrawing('bad-site'),
    end: stateAt(recording('bad-site').events, Infinity),
  });
}

export const homeElement = () => <HomeScreen data={homeData()} />;

export function resultElement(name: ResultPreview) {
  const data = RESULT_PREVIEWS[name]();
  return data.state === 'result' ? <ResultScreen data={data} /> : <ResultState data={data} />;
}

export const RESULT_NAMES = Object.keys(RESULT_PREVIEWS) as ResultPreview[];

export const crawlElement = (name: RecordingName, at?: string) => (
  <CrawlScreen {...crawlProps(name, { at })} />
);
