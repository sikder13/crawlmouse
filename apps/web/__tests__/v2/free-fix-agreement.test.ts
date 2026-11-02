/**
 * One rule says which fixes Free opens (lib/v2/view/free-fixes.ts). The Result page, the four
 * segments that list fixes, and the fix page each import it; this test holds them to the same
 * answer: the segments and the fix page on every finished or partial check of every fixture, the
 * Result page on each graded first audit (the checks it shows).
 */
import { FixSectionSchema } from '@crawlmouse/types/v2';
import { describe, expect, it } from 'vitest';
import { fixesAsOf, fixture } from '../../lib/v2/fixtures';
import { fixView } from '../../lib/v2/view/fix';
import { freeFixes } from '../../lib/v2/view/free-fixes';
import { resultView } from '../../lib/v2/view/result';
import { sectionFixes } from '../../lib/v2/view/segment/fixes';

const NO_MAP = { map: { nodes: [], positions: {} } };

const cases = (['bad-site', 'challenged-site', 'clean-site'] as const).flatMap((name) =>
  fixture(name)
    .checks.filter((c) => c.status === 'finished' || c.status === 'partial')
    .map((c) => [name, c.id] as const),
);

describe.each(cases)('the free fixes of %s at %s', (name, checkId) => {
  const d = fixture(name);
  const check = d.checks.find((c) => c.id === checkId)!;
  const rule = freeFixes(d, check)
    .map((f) => f.id)
    .sort();

  // The Result page shows a graded first audit; a later check is shown by its Changes page, and
  // the fixtures' other sites hold no structure figures to draw a Result from.
  it.runIf(check.previous_check_id === null && check.structure !== null)(
    'are the ones the Result page opens',
    () => {
      const rows = resultView(d, checkId, NO_MAP).fixes?.rows ?? [];
      expect(
        rows
          .filter((r) => r.open)
          .map((r) => r.key)
          .sort(),
      ).toEqual(rule);
    },
  );

  it('are the ones the segments open, each in its own section', () => {
    const open = FixSectionSchema.options.flatMap((s) =>
      sectionFixes(d, check, s).open.map((f) => f.id),
    );
    expect(open.sort()).toEqual(rule);
  });

  it('are the ones the fix page opens on Free', () => {
    const opened = fixesAsOf(d, check)
      .filter((f) => fixView(d, checkId, f.id).kind === 'open')
      .map((f) => f.id);
    expect(opened.sort()).toEqual(rule);
  });
});
