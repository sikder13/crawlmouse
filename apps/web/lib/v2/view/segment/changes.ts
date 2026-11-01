/** PLACEHOLDER: replaced by the Changes segment's view model. */
import type { FixtureDataset } from '@crawlmouse/types/v2';
import { segmentFrame, type SegmentFrame, type SegmentOptions } from './frame';

export interface ChangesView {
  frame: SegmentFrame;
}

export function changesView(
  d: FixtureDataset,
  checkId: string,
  options: SegmentOptions = {},
): ChangesView {
  return { frame: segmentFrame(d, checkId, 'changes', options) };
}
