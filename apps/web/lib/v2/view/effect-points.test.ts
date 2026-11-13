/**
 * CC-32 D4: an estimated effect at or below zero is shown as no measurable effect, never with a minus
 * sign or "lower", in every printer of a fix's effect: the fixes table (`points`), the open fix and the
 * fix page (`effectOf`), the segment's Pro rows (`proPoints`, `groupPoints`), the Result's grouped
 * "N more" row and its first-fix card. The engine's number is not changed, and neither is the order.
 *
 * The table below is written by hand from the rule, row by row; it is not computed from the code.
 */
import type { Fix, FixSection } from '@crawlmouse/types/v2';
import { describe, expect, it } from 'vitest';
import { findCheck, fixture } from '../fixtures';
import { formatPoints, groupSum, NO_EFFECT, NO_EFFECT_SHORT } from './effect-headline';
import { points, restPoints, resultView } from './result';
import { effectOf, groupPoints, proPoints } from './segment/fixes';
import { FIRST_AUDIT } from './segment/test-helpers';

type Value = number | null;
const VALUES: readonly Value[] = [null, -1, 0, 0.01, 3];

const base = fixture('bad-site').fixes[0]!;
function fixWith(ai: Value, seo: Value, section: FixSection): Fix {
  return {
    ...base,
    section,
    effect: {
      ...base.effect,
      ai_readability: ai,
      ai_readability_pending_on: ai === null ? ['too_few_crawlers_measured'] : [],
      technical_seo: seo,
      technical_seo_pending_on: seo === null ? ['grade_refused'] : [],
      absorbed_by: null,
    },
  };
}

const WAIT = 'AI not yet estimated';
const NOT_EST = 'SEO not estimated';
const NME = NO_EFFECT_SHORT;

/** `points` by hand: rows are AI ∈ VALUES, columns Technical SEO ∈ VALUES. */
const TABLE: Record<'crawler_access' | 'structure', string[][]> = {
  crawler_access: [
    [WAIT, WAIT, WAIT, WAIT, WAIT],
    [NOT_EST, NME, NME, '+0.01 SEO', '+3 SEO'],
    [NOT_EST, NME, NME, '+0.01 SEO', '+3 SEO'],
    ['+0.01 AI', '+0.01 AI', '+0.01 AI', '+0.01 AI', '+0.01 AI'],
    ['+3 AI', '+3 AI', '+3 AI', '+3 AI', '+3 AI'],
  ],
  structure: [
    [NOT_EST, WAIT, WAIT, '+0.01 SEO', '+3 SEO'],
    [NOT_EST, NME, NME, '+0.01 SEO', '+3 SEO'],
    [NOT_EST, NME, NME, '+0.01 SEO', '+3 SEO'],
    ['+0.01 AI', '+0.01 AI', '+0.01 AI', '+0.01 AI', '+0.01 AI'],
    ['+3 AI', '+3 AI', '+3 AI', '+3 AI', '+3 AI'],
  ],
};

/** Nothing a printer gives may read as a loss, or as a signed zero. */
const NEVER = /[−-]\s?\d|\blower\b|\+-|\+0(?![.\d])/;

describe('formatPoints and groupSum', () => {
  it('give a figure above zero only', () => {
    expect([0.01, 3].map(formatPoints)).toEqual(['+0.01', '+3']);
    expect([0, -0.01, -1].map(formatPoints)).toEqual([null, null, null]);
  });

  it('take each member at 0 before adding', () => {
    expect(groupSum([-2, 3])).toBe(3);
    expect(groupSum([-2, 0])).toBe(0);
    expect(groupSum([])).toBe(0);
  });
});

describe('every printer, over AI and Technical SEO in {null, −1, 0, 0.01, 3}, in an AI and a structure section', () => {
  for (const section of ['crawler_access', 'structure'] as const) {
    VALUES.forEach((ai, i) =>
      VALUES.forEach((seo, j) => {
        it(`${section}: AI ${ai}, Technical SEO ${seo}`, () => {
          const f = fixWith(ai, seo, section);
          const table = points(f, [f]);
          expect(table).toBe(TABLE[section][i]![j]);
          const head = effectOf(f, [f]);
          const pro = proPoints(f, [f]);
          const group = groupPoints([f]);
          for (const text of [table, `${head.points} ${head.unit}`, pro, group]) {
            expect(text).not.toMatch(NEVER);
          }
          // the open fix and the fix page say the same as the table, at length
          if (table === NME) expect(head).toEqual({ points: '—', unit: NO_EFFECT });
          if (table.startsWith('+')) expect(head.points).toBe(table.split(' ')[0]);
          // the Pro row names each figure above zero, and no other
          for (const [v, unit] of [
            [ai, 'AI readability'],
            [seo, 'Technical SEO'],
          ] as const) {
            if (v !== null && v > 0) expect(pro).toContain(`+${v} ${unit}`);
            else expect(pro).not.toContain(unit);
          }
          if (pro.startsWith(NME)) expect(table).toBe(NME);
        });
      }),
    );
  }
});

describe('a group with a negative member', () => {
  const fix = (ai: Value, seo: Value) => fixWith(ai, seo, 'structure');

  it('counts the member at 0, so it lowers no sum', () => {
    expect(groupPoints([fix(-1, -2), fix(0, 3)])).toBe('+3 Technical SEO together');
    expect(groupPoints([fix(2, -2), fix(1, 3)])).toBe(
      '+3 Technical SEO, +3 AI readability together',
    );
  });

  it('prints a sum of 0 as no measurable effect', () => {
    expect(groupPoints([fix(-1, -2), fix(0, 0)])).toBe(NME);
    expect(groupPoints([fix(null, -2), fix(null, 0)])).toBe(
      `${NME}; AI effect not yet estimated for 2`,
    );
  });

  it('keeps "no estimated effect" when nothing was estimated', () => {
    expect(groupPoints([fix(null, null)])).toBe(
      'no estimated effect; Technical SEO effect not estimated for 1; AI effect not yet estimated for 1',
    );
  });
});

describe('the Result, built from a fixture whose fixes are edited', () => {
  const resultOf = (edit: (fixes: Fix[]) => void) => {
    const d = structuredClone(fixture('bad-site'));
    const check = findCheck(d, FIRST_AUDIT['bad-site']);
    edit(d.fixes.filter((f) => f.site_id === check.site_id));
    return resultView(d, FIRST_AUDIT['bad-site'], {
      map: { nodes: [], positions: {} },
      asFirstSeen: true,
    });
  };
  const setAll = (fixes: Fix[], ai: Value, seo: Value) => {
    for (const f of fixes) {
      f.effect = {
        ...f.effect,
        ai_readability: ai,
        ai_readability_pending_on: ai === null ? ['too_few_crawlers_measured'] : [],
        technical_seo: seo,
        technical_seo_pending_on: seo === null ? ['grade_refused'] : [],
        absorbed_by: null,
      };
    }
  };

  it('the grouped "N more" row: no measurable effect when every member is at or below zero', () => {
    const v = resultOf((fixes) => setAll(fixes, 0, -1));
    expect(v.fixes!.rows.find((r) => r.key === 'rest')!.points).toBe(NME);
  });

  it('the grouped "N more" row: a negative member lowers no sum', () => {
    expect(restPoints([2, -50, 2])).toBe('+4 SEO');
    expect(restPoints([0, -1])).toBe(NME);
    const v = resultOf((fixes) => setAll(fixes, 0, 2));
    const rest = v.fixes!.rows.find((r) => r.key === 'rest')!;
    expect(rest.points).toBe(`+${2 * rest.count} SEO`);
  });

  it('the first-fix card: no measurable effect on the grade, with no figure', () => {
    const v = resultOf((fixes) => setAll(fixes, 0, -1));
    expect(v.first.kind).toBe('fix');
    const body = v.first.kind === 'fix' ? v.first.body : '';
    expect(body).toContain(`${NO_EFFECT}.`);
    expect(body).not.toMatch(NEVER);
  });
});
