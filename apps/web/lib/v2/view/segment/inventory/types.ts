import type { SegmentKey } from '../frame';

/** One value a segment page reads from a check: the pages that show it and the fixture fields. */
export interface SegmentInventoryEntry {
  id: string;
  segments: readonly SegmentKey[];
  element: string;
  fields: readonly string[];
}

export const entry = (
  id: string,
  segments: readonly SegmentKey[],
  element: string,
  fields: readonly string[],
): SegmentInventoryEntry => ({ id, segments, element, fields });
