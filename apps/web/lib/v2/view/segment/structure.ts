/** PLACEHOLDER: replaced by the Structure segment's view model. */
import type { FixtureDataset } from '@crawlmouse/types/v2';
import { segmentFrame, type SegmentFrame, type SegmentOptions } from './frame';

export interface StructureView {
  frame: SegmentFrame;
}

export function structureView(
  d: FixtureDataset,
  checkId: string,
  options: SegmentOptions = {},
): StructureView {
  return { frame: segmentFrame(d, checkId, 'structure', options) };
}
