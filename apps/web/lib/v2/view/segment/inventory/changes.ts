import { entry, type SegmentInventoryEntry } from './types';

/** What the Changes segment reads from the check, its site and the site's changes. */
export const CHANGES_INVENTORY: SegmentInventoryEntry[] = [
  entry('changes-history', ['changes'], 'The audit history: each audit’s kind, time and grades', [
    'checks[].trigger',
    'checks[].finished_at',
    'checks[].technical_seo.score',
    'checks[].technical_seo.grade',
    'checks[].ai_readability.total',
    'checks[].ai_readability.grade',
  ]),
  entry('changes-schedule', ['changes'], 'When a kept site is next checked', ['sites[].schedule']),
  entry('changes-rows', ['changes'], 'Each change a re-check found', [
    'changes[].summary',
    'changes[].kind',
    'changes[].subject',
    'changes[].where',
    'changes[].pages_affected',
    'changes[].grade_deltas',
    'changes[].detected_at',
    'changes[].cause.text',
    'changes[].cause.changed_at',
    'changes[].cause.diff',
    'changes[].notified',
  ]),
  entry('changes-clock', ['changes'], 'The account’s clock, for when a change was seen', [
    'accounts[].timezone',
  ]),
];
