/** PLACEHOLDER: replaced by the NoJs segment's view model. */
import type { FixtureDataset } from '@crawlmouse/types/v2';
import { segmentFrame, type SegmentFrame, type SegmentOptions } from './frame';

export interface NoJsView {
  frame: SegmentFrame;
}

export function nojsView(
  d: FixtureDataset,
  checkId: string,
  options: SegmentOptions = {},
): NoJsView {
  return { frame: segmentFrame(d, checkId, 'nojs', options) };
}
