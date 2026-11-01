/** PLACEHOLDER: replaced by the Signals segment's view model. */
import type { FixtureDataset } from '@crawlmouse/types/v2';
import { segmentFrame, type SegmentFrame, type SegmentOptions } from './frame';

export interface SignalsView {
  frame: SegmentFrame;
}

export function signalsView(
  d: FixtureDataset,
  checkId: string,
  options: SegmentOptions = {},
): SignalsView {
  return { frame: segmentFrame(d, checkId, 'signals', options) };
}
