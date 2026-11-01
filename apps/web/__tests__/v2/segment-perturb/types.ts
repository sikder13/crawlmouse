import type { Check, FixtureDataset } from '@crawlmouse/types/v2';
import type { FixtureName } from '../../../lib/v2/fixtures';
import type { ChangesHistory } from '../../../app/(v2-preview)/v2-preview/_preview/segments';
import type { SegmentKey } from '../../../lib/v2/view/segment/frame';

/**
 * One change to a copy of a fixture, and what each segment page must then show that it did not
 * before. The page is the fixture's first audit, or, with `history`, a Changes page of a later
 * check (whose check `change` receives).
 */
export interface SegmentChange {
  fixture?: FixtureName;
  history?: ChangesHistory;
  change: (check: Check, d: FixtureDataset) => void;
  expect: Partial<Record<SegmentKey, string[]>>;
}

/** By inventory entry id, then by field: the changes that show the field is read. */
export type PerturbTable = Record<string, Record<string, SegmentChange[]>>;
