/**
 * Which change rows a reader is shown and counted (F-302): one rule, read by every list and every
 * count of changes, so a count cannot name a row its list leaves out. A grade row in which no letter
 * moved ("Technical SEO A → A (90 → 91)") is written by the engine for a move of a point or more
 * within a letter; it is not listed as a change, and not counted as one.
 */
import type { Change } from '@crawlmouse/types/v2';

/** A grade row in which no letter moved. */
export const lettersUnmoved = (c: Change): boolean =>
  c.subject === 'grade' &&
  c.kind === 'changed' &&
  c.grade_deltas.length > 0 &&
  c.grade_deltas.every((g) => g.from_grade === g.to_grade);

/** The rows of `changes` a reader is shown and counted. */
export const listedChanges = <C extends Change>(changes: readonly C[]): C[] =>
  changes.filter((c) => !lettersUnmoved(c));
