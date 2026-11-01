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
  homePreview,
  type ResultPreview,
} from '../../../app/(v2-preview)/v2-preview/_preview/screens';
import type { RecordingName } from '../../../lib/v2/recordings';

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
