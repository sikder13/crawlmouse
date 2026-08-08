import { describe, it, expect } from 'vitest';
import { findingMeta, FINDING_META_CATEGORIES } from './finding-meta';

/**
 * GUARD — no finding whose copy ASSERTS A VERDICT may render beside a withheld one.
 *
 * A refused audit shipped the no-grade label and, four lines below it, "Your grade is an estimate
 * until the whole site is crawled." Correct on a graded partial audit; false where there is no grade.
 * `ResultView` now filters on `FindingMeta.assertsVerdict`, and this is what stops that flag from
 * being a one-off exclusion for the one category we happened to notice.
 *
 * THE RULE IS DERIVED FROM THE COPY, NOT FROM A LIST OF CATEGORIES. A hardcoded exclusion is the
 * fourteenth-surface problem: the next finding whose copy says "your grade" would render beside a
 * refusal and nothing would object. Here the copy is scanned; if it presumes a verdict and the entry
 * is not flagged, this fails — on the day the copy is written, not after a user sees it.
 *
 * WHEN THIS FAILS, do not add an exception. Either reword the copy so it does not presume a verdict,
 * or set `assertsVerdict: true` so it is withheld alongside the letter.
 */

/**
 * Copy that presumes a verdict exists. Second-person possessive ("your grade", "your score") or a
 * direct claim about one ("the grade is", "grade is an estimate"). Deliberately NOT matching a
 * neutral mention — "affects how search engines rank you" asserts nothing about a letter we hold.
 */
const ASSERTS_VERDICT =
  /\b(your|the)\s+(grade|score)\b|\bgrade\s+(is|was|will)\b|\bscore\s+(is|was|will)\b/i;

describe('GUARD — finding copy must not presume a verdict beside a refusal', () => {
  it('flags every category whose copy asserts a verdict, and no others', () => {
    const offenders: string[] = [];
    const overFlagged: string[] = [];
    for (const category of FINDING_META_CATEGORIES) {
      const meta = findingMeta(category);
      const copy = [meta.label, meta.what, meta.why, meta.siteWide ?? ''].join(' ');
      const asserts = ASSERTS_VERDICT.test(copy);
      if (asserts && !meta.assertsVerdict) offenders.push(`${category}: "${copy.match(ASSERTS_VERDICT)?.[0]}"`);
      if (!asserts && meta.assertsVerdict) overFlagged.push(category);
    }
    expect(
      offenders,
      'This copy presumes a verdict. Reword it, or set assertsVerdict: true so it is withheld with the letter.',
    ).toEqual([]);
    // The reverse too: a flag with no matching copy is a stale exclusion hiding a finding from a
    // refused user for no reason.
    expect(overFlagged, 'assertsVerdict set on copy that does not assert a verdict — stale flag').toEqual([]);
  });

  it('the matcher matches — proven against the copy that shipped the defect', () => {
    // Without this the guard above passes trivially if the regex ever stops matching anything.
    expect(ASSERTS_VERDICT.test('Your grade is an estimate until the whole site is crawled.')).toBe(true);
    expect(ASSERTS_VERDICT.test('This lowers your score.')).toBe(true);
    expect(ASSERTS_VERDICT.test('The grade is provisional.')).toBe(true);
    // ...and does not fire on copy that merely mentions ranking or crawlers.
    expect(ASSERTS_VERDICT.test('Internal links concentrate ranking signal.')).toBe(false);
    expect(ASSERTS_VERDICT.test('It affects how easily search engines and AI crawlers find your pages.')).toBe(false);
  });

  it('at least one category IS flagged — the guard is not vacuous', () => {
    const flagged = FINDING_META_CATEGORIES.filter((c) => findingMeta(c).assertsVerdict);
    expect(flagged.length).toBeGreaterThan(0);
    expect(flagged).toContain('incomplete_crawl');
  });
});
