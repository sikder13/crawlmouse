/** PLACEHOLDER: replaced by the Content segment's view model. */
import type { FixtureDataset } from '@crawlmouse/types/v2';
import { segmentFrame, type SegmentFrame, type SegmentOptions } from './frame';

export interface ContentView {
  frame: SegmentFrame;
}

export function contentView(
  d: FixtureDataset,
  checkId: string,
  options: SegmentOptions = {},
): ContentView {
  return { frame: segmentFrame(d, checkId, 'content', options) };
}
