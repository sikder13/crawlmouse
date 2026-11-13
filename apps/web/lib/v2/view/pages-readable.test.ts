/**
 * Owner ruling on CC-32 Q8: a client-rendered template fix whose AI effect is estimated at 0 or less
 * (a template of empty-root pages alone, whose pages no grade reads) is headed by the pages it makes
 * readable, "Makes N pages readable without JavaScript", N its `affected_pages`, in every printer:
 * never a grade number and never "no measurable effect". An AI effect still null keeps saying why it
 * waits. A client-rendered fix with a positive AI effect keeps its points.
 */
import type { Fix } from '@crawlmouse/types/v2';
import { describe, expect, it } from 'vitest';
import { findCheck, fixture } from '../fixtures';
import { NO_EFFECT_SHORT, pagesReadableText } from './effect-headline';
import { points, resultView } from './result';
import { effectOf, groupPoints, proPoints } from './segment/fixes';
import { FIRST_AUDIT } from './segment/test-helpers';

const base = fixture('bad-site').fixes.find((f) => f.type === 'client_rendered_template')!;

function shellFix(
  pages: number,
  ai: number | null = 0,
  seo: number | null = 0,
  last_state: Fix['last_state'] = 'detected',
): Fix {
  return {
    ...base,
    affected_pages: pages,
    last_state,
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

/** Each printer's text for one fix: the table, the open fix and fix page, the Pro row, a group. */
const printed = (f: Fix) => {
  const head = effectOf(f, [f]);
  return {
    table: points(f, [f]),
    head: `${head.points} ${head.unit}`,
    pro: proPoints(f, [f]),
    group: groupPoints([f]),
  };
};

/** A grade figure, signed or not, or the no-effect wording. */
const GRADE_OR_NONE = /[+−-]\s?\d|\bSEO\b|AI readability|No measurable effect/;

describe('the pages a shell-only template fix makes readable', () => {
  it('reads "Makes 1 page readable without JavaScript" for one page, in every printer', () => {
    expect(pagesReadableText(1)).toBe('Makes 1 page readable without JavaScript');
    const p = printed(shellFix(1));
    expect(p).toEqual({
      table: 'Makes 1 page readable without JavaScript',
      head: '— Makes 1 page readable without JavaScript',
      pro: 'Makes 1 page readable without JavaScript',
      group: 'Makes 1 page readable without JavaScript',
    });
  });

  it('reads "Makes 7 pages readable without JavaScript" for seven, with no grade number, at AI 0 or below', () => {
    for (const ai of [0, -0.5]) {
      for (const text of Object.values(printed(shellFix(7, ai)))) {
        expect(text).toContain('Makes 7 pages readable without JavaScript');
        expect(text).not.toMatch(GRADE_OR_NONE);
      }
    }
  });

  it('reads the pages line while its AI effect is not yet estimated, not why it waits', () => {
    const p = printed(shellFix(7, null));
    expect(p.table).toBe('Makes 7 pages readable without JavaScript');
    expect(p.head).toBe('— Makes 7 pages readable without JavaScript');
    expect(p.pro).toBe('Makes 7 pages readable without JavaScript');
    for (const text of Object.values(p)) expect(text).not.toMatch(GRADE_OR_NONE);
  });

  it('in a group, a fix headed by its pages is not counted as waiting; another fix still is', () => {
    const waiting: Fix = {
      ...shellFix(2, null),
      type: 'quotable_opening',
      section: 'content',
    };
    expect(groupPoints([shellFix(7, null)])).toBe('Makes 7 pages readable without JavaScript');
    expect(groupPoints([shellFix(7, null), waiting])).toBe(
      'Makes 7 pages readable without JavaScript; AI effect not yet estimated for 1',
    );
  });

  it('on a template with graded pages whose AI effect is 0 by rounding, the line still reads (CC-32 D4/Q8 note)', () => {
    // a graded-template fix: its counterfactual sets every graded page's share to 1, so its pages are
    // made readable; its AI effect rounded to 0 (grade/effects.ts DECIMALS)
    const p = printed(shellFix(40, 0, 0));
    expect(p.table).toBe('Makes 40 pages readable without JavaScript');
  });

  it('says the count is from the last detection when the last check did not detect it', () => {
    expect(points(shellFix(1, 0, 0, 'detected'), [])).toBe(
      'Makes 1 page readable without JavaScript',
    );
    for (const state of ['indeterminate', 'not_detected'] as const) {
      expect(points(shellFix(12, 0, 0, state), [])).toBe(
        'Would make 12 pages readable without JavaScript, as of the last check that detected it',
      );
      expect(points(shellFix(1, null, 0, state), [])).toBe(
        'Would make 1 page readable without JavaScript, as of the last check that detected it',
      );
    }
    expect(groupPoints([shellFix(4), shellFix(3, 0, 0, 'indeterminate')])).toBe(
      'Makes 4 pages readable without JavaScript; Would make 3 pages readable without JavaScript, as of the last check that detected it',
    );
  });

  it('a client-rendered fix with a positive AI effect still shows its points', () => {
    const p = printed(shellFix(7, 4, 0));
    expect(p.table).toBe('+4 AI');
    expect(p.head).toBe('+4 AI readability, estimated');
    expect(p.pro).toBe('+4 AI readability');
    expect(p.group).toBe('+4 AI readability together');
  });

  it('another fix type at AI 0 is still no measurable effect', () => {
    const other: Fix = { ...shellFix(7), type: 'quotable_opening', section: 'content' };
    expect(points(other, [other])).toBe(NO_EFFECT_SHORT);
  });

  it('a group adds its pages beside the points of its other members', () => {
    const graded = {
      ...shellFix(3, 0, 2),
      type: 'orphan_pages' as const,
      section: 'structure' as const,
    };
    expect(groupPoints([shellFix(4), shellFix(2), graded])).toBe(
      '+2 Technical SEO together; Makes 6 pages readable without JavaScript',
    );
  });
});

describe('the Result, with the bad site’s client-rendered fix made shell-only', () => {
  it('heads the fix with its pages wherever the Result prints it', () => {
    const d = structuredClone(fixture('bad-site'));
    const check = findCheck(d, FIRST_AUDIT['bad-site']);
    const f = d.fixes.find(
      (x) => x.site_id === check.site_id && x.type === 'client_rendered_template',
    )!;
    Object.assign(f, shellFix(5), { id: f.id, number: f.number, rank: f.rank, site_id: f.site_id });
    const v = resultView(d, FIRST_AUDIT['bad-site'], {
      map: { nodes: [], positions: {} },
      asFirstSeen: true,
    });
    const texts = [
      ...v.fixes!.rows.filter((r) => r.key === f.id || r.key === 'rest').map((r) => r.points),
      ...(v.first.kind === 'fix' && v.first.title === f.title ? [v.first.body] : []),
    ];
    expect(texts.some((t) => t.includes('Makes 5 pages readable without JavaScript'))).toBe(true);
    for (const t of texts) expect(t).not.toMatch(/No measurable effect on the grade/);
  });
});
