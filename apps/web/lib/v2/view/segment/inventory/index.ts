/**
 * The values the segment pages read from a check: by element, the pages that show it and the
 * fixture fields it is read from. SPEC 23 renders this table, and
 * __tests__/v2/segment-perturbation.test.tsx changes each field, one at a time, in a copy of a
 * fixture and requires each page named to show the new value.
 */
import { ACCESS_INVENTORY } from './access';
import { CHANGES_INVENTORY } from './changes';
import { CONTENT_INVENTORY } from './content';
import { FRAME_INVENTORY } from './frame';
import { NOJS_INVENTORY } from './nojs';
import { SIGNALS_INVENTORY } from './signals';
import { STRUCTURE_INVENTORY } from './structure';
import type { SegmentInventoryEntry } from './types';

export type { SegmentInventoryEntry };

export const SEGMENT_INVENTORY: SegmentInventoryEntry[] = [
  ...FRAME_INVENTORY,
  ...ACCESS_INVENTORY,
  ...NOJS_INVENTORY,
  ...STRUCTURE_INVENTORY,
  ...CONTENT_INVENTORY,
  ...SIGNALS_INVENTORY,
  ...CHANGES_INVENTORY,
];
