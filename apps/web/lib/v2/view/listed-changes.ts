/**
 * Which change rows a reader is shown and counted (F-302): one rule, read by every list and every
 * count of changes, so a count cannot name a row its list leaves out. A grade row in which no letter
 * moved ("Technical SEO A → A (90 → 91)") is written by the engine for a move of a point or more
 * within a letter; it is not listed as a change, and not counted as one.
 */
import type { Change } from '@crawlmouse/types/v2';

/** The fields the rule reads, so a mail's change row is read by it too. */
type Listed = Pick<Change, 'subject' | 'kind' | 'grade_deltas'>;

/** A grade row in which no letter moved. */
export const lettersUnmoved = (c: Listed): boolean =>
  c.subject === 'grade' &&
  c.kind === 'changed' &&
  c.grade_deltas.length > 0 &&
  c.grade_deltas.every((g) => g.from_grade === g.to_grade);

/** The grade names the engine's summary uses (packages/engine/src/v2/diff/changes.ts). */
const GRADE_LABEL: Readonly<Record<Change['grade_deltas'][number]['grade'], string>> = {
  technical_seo: 'Technical SEO',
  ai_readability: 'AI readability',
};

/**
 * `c` with only the grades whose letter moved (CTO ruling on QA N1): a row where one letter held and
 * another moved prints the moved one alone, never "A → A". A grade row's summary is rebuilt from what
 * is left, in the engine's own form ("AI readability D → F (41 → 22)"); any other row keeps its
 * summary. A row where every letter moved, or none, is returned as it is.
 */
export function onlyMoved<C extends Listed & { summary: string }>(c: C): C {
  const moved = c.grade_deltas.filter((g) => g.from_grade !== g.to_grade);
  if (moved.length === 0 || moved.length === c.grade_deltas.length) return c;
  return {
    ...c,
    grade_deltas: moved,
    summary:
      c.subject === 'grade' && c.kind === 'changed'
        ? moved
            .map(
              (g) =>
                `${GRADE_LABEL[g.grade]} ${g.from_grade} → ${g.to_grade} (${g.from_score} → ${g.to_score})`,
            )
            .join('; ')
        : c.summary,
  };
}

/** The rows of `changes` a reader is shown and counted, each with only the letters that moved. */
export const listedChanges = <C extends Listed & { summary: string }>(changes: readonly C[]): C[] =>
  changes.filter((c) => !lettersUnmoved(c)).map(onlyMoved);
