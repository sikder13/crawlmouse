/**
 * A fix whose AI readability effect is not estimated yet (`ai_readability: null`) is headed by why
 * it waits, in the views that head a fix with its effect: the Result's first-fix card and fixes
 * table, the segment's open fix, and the fix page (owner ruling, 2026-11-05). The segment's Pro rows
 * are not among them: they give a fix's Technical SEO points beside what its AI effect waits on, as
 * the locked Final-Seg-Content does (lib/v2/copy/segment-content.ts).
 *
 * - A fix in crawler_access, without_js or content moves AI readability; while that effect waits,
 *   its headline is the waiting sentence, never a Technical SEO figure and never "+0".
 * - A structure fix keeps its Technical SEO figure; with 0 SEO and a null AI effect it waits too.
 */
import fc from 'fast-check';
import {
  FixSectionSchema,
  WithheldReasonSchema,
  type Fix,
  type FixSection,
  type FixtureDataset,
} from '@crawlmouse/types/v2';
import { describe, expect, it } from 'vitest';
import { findCheck, fixture, type FixtureName } from '../fixtures';
import { AI_WAITING } from './effect-headline';
import { fixView } from './fix';
import { resultView } from './result';
import { sectionFixes } from './segment/fixes';
import { FIRST_AUDIT } from './segment/test-helpers';

const NO_MAP = { nodes: [], positions: {} };
const WAITING = 'AI readability is graded once two scored crawlers can be measured';
/** The challenged site's top-ranked fix: an edge rule, AI effect waiting on too few crawlers. */
const CHALLENGED_TOP = 'f0000000-0000-4000-8000-0000000000c9';

const resultOf = (d: FixtureDataset, name: FixtureName) =>
  resultView(d, FIRST_AUDIT[name], { map: NO_MAP, asFirstSeen: name === 'bad-site' });
const headOf = (d: FixtureDataset, name: FixtureName, id: string) => {
  const h = fixView(d, FIRST_AUDIT[name], id, { asFirstSeen: name === 'bad-site' }).head;
  return `${h.points} ${h.unit}`;
};
const rowOf = (d: FixtureDataset, name: FixtureName, id: string) =>
  resultOf(d, name).fixes!.rows.find((r) => r.key === id)!.points;
const segmentOf = (d: FixtureDataset, name: FixtureName, f: Pick<Fix, 'section'>) =>
  sectionFixes(d, findCheck(d, FIRST_AUDIT[name]), f.section);

describe('the challenged site’s top fix, whose AI effect waits on two measured crawlers', () => {
  const d = fixture('challenged-site');
  const top = d.fixes.find((f) => f.id === CHALLENGED_TOP)!;

  it('is the fixture this pins: crawler access, 0 Technical SEO, AI waiting on too few crawlers', () => {
    expect(top).toMatchObject({ section: 'crawler_access', rank: 1 });
    expect(top.effect).toMatchObject({
      technical_seo: 0,
      ai_readability: null,
      ai_readability_pending_on: ['too_few_crawlers_measured'],
    });
  });

  it('reads as waiting on the Result’s first-fix card', () => {
    const v = resultOf(d, 'challenged-site');
    expect(v.first.kind === 'fix' && v.first.title).toBe(top.title);
    const body = v.first.kind === 'fix' ? v.first.body : '';
    expect(body).toContain(`${WAITING}.`);
    expect(body).not.toMatch(/Technical SEO|\+0/);
  });

  it('reads as waiting in the Result’s fixes table', () => {
    expect(rowOf(d, 'challenged-site', top.id)).toBe('AI not yet estimated');
  });

  it('reads as waiting on the segment’s open fix', () => {
    const open = segmentOf(d, 'challenged-site', top).open.find((f) => f.id === top.id)!;
    expect({ points: open.points, unit: open.unit }).toEqual({ points: '—', unit: WAITING });
  });

  it('reads as waiting on the fix page', () => {
    expect(headOf(d, 'challenged-site', top.id)).toBe(`— ${WAITING}`);
  });
});

/** A fix's effect as the contract allows it with a null AI effect. */
const effectArb = (fingerprints: readonly string[]) =>
  fc.record({
    technical_seo: fc.option(fc.integer({ min: 0, max: 6 }), { nil: null }),
    pending: fc.array(fc.constantFrom(...WithheldReasonSchema.options, ...fingerprints), {
      minLength: 1,
      maxLength: 3,
    }),
  });

/**
 * Every headline the views give fix `id` of `name`'s first audit, after its section and effect are
 * replaced. The challenged site's top fix is open (card, table, open fix, fix page); the bad site's
 * fix 5 is the first fix Free does not open, so it heads a named table row and a locked fix page.
 */
function headlines(
  name: FixtureName,
  id: string,
  section: FixSection,
  technical_seo: number | null,
  pending: string[],
  refused: boolean,
): string[] {
  const d = structuredClone(fixture(name));
  const f = d.fixes.find((x) => x.id === id)!;
  f.section = section;
  f.effect = {
    ...f.effect,
    technical_seo,
    technical_seo_pending_on: technical_seo === null ? ['grade_refused'] : [],
    ai_readability: null,
    ai_readability_pending_on: pending as Fix['effect']['ai_readability_pending_on'],
  };
  if (refused) findCheck(d, FIRST_AUDIT[name]).technical_seo!.score = null;
  const out = [rowOf(d, name, id), headOf(d, name, id)];
  const v = resultOf(d, name);
  if (v.first.kind === 'fix' && v.first.title === f.title) out.push(v.first.body);
  const seg = segmentOf(d, name, f);
  const open = seg.open.find((x) => x.id === id);
  if (open) out.push(`${open.points} ${open.unit}`);
  // each slot reaches the views it is chosen for, so the property cannot pass by reaching none
  expect(out).toHaveLength(name === 'challenged-site' ? 4 : 2);
  return out;
}

const SLOTS = [
  {
    name: 'challenged-site' as const,
    id: CHALLENGED_TOP,
    fingerprints: ['0f1e0000000000ca'],
  },
  {
    name: 'bad-site' as const,
    id: fixture('bad-site').fixes.find(
      (f) => f.number === 5 && f.site_id === '50000000-0000-4000-8000-000000000001',
    )!.id,
    fingerprints: ['0f1e000000000001', '0f1e000000000002'],
  },
];

const AI_SECTIONS: readonly FixSection[] = ['crawler_access', 'without_js', 'content'];
/** A Technical SEO figure: "+2 SEO", "+2 Technical SEO", or "Technical SEO 67 → 69". */
const SEO_FIGURE = /[+-]?\d+\s+(?:Technical )?SEO\b|Technical SEO \d/;

describe('a fix whose AI effect is null, in the card, the table, the open fix and the fix page (property)', () => {
  it.each(SLOTS)(
    'never renders "+0", nor a Technical SEO figure when its section is an AI one ($name)',
    ({ name, id, fingerprints }) => {
      fc.assert(
        fc.property(
          fc.constantFrom(...FixSectionSchema.options),
          effectArb(fingerprints),
          fc.boolean(),
          (section, { technical_seo, pending }, refused) => {
            for (const h of headlines(name, id, section, technical_seo, pending, refused)) {
              expect(h).not.toMatch(/\+0\b/);
              if (AI_SECTIONS.includes(section)) expect(h).not.toMatch(SEO_FIGURE);
            }
          },
        ),
        { numRuns: 60 },
      );
    },
  );

  it('the regex it uses finds each Technical SEO form the views write', () => {
    for (const s of [
      '+2 SEO',
      '+1 Technical SEO; AI effect estimated after fix 1',
      'Technical SEO 67 → 69, estimated.',
      '+2 Technical SEO, estimated',
    ]) {
      expect(s).toMatch(SEO_FIGURE);
    }
    expect('— AI readability is graded once two scored crawlers can be measured').not.toMatch(
      SEO_FIGURE,
    );
  });

  it('a structure fix keeps its Technical SEO figure while its AI effect waits', () => {
    const [slot] = SLOTS;
    const h = headlines(slot!.name, slot!.id, 'structure', 3, ['too_few_crawlers_measured'], false);
    expect(h).toEqual(expect.arrayContaining(['+3 SEO', '+3 Technical SEO, estimated']));
  });
});

describe('the waiting sentence, chosen from the first pending entry', () => {
  /** The challenged top fix's open-fix unit and table points with `pending` as its AI pending list. */
  const waitingWith = (pending: string[]) => {
    const d = structuredClone(fixture('challenged-site'));
    const f = d.fixes.find((x) => x.id === CHALLENGED_TOP)!;
    f.effect.ai_readability_pending_on = pending as Fix['effect']['ai_readability_pending_on'];
    const open = segmentOf(d, 'challenged-site', f).open.find((x) => x.id === f.id)!;
    return { unit: open.unit, row: rowOf(d, 'challenged-site', f.id) };
  };

  it.each(WithheldReasonSchema.options)('%s heads the fix with its own sentence', (reason) => {
    const { unit, row } = waitingWith([reason, 'too_few_crawlers_measured']);
    expect(unit).toBe(AI_WAITING[reason]);
    expect(row).toBe('AI not yet estimated');
  });

  it('gives the seven reasons seven different sentences', () => {
    expect(new Set(Object.values(AI_WAITING)).size).toBe(WithheldReasonSchema.options.length);
  });

  it('names the fixes it waits on by number, in the bad site’s table and fix page', () => {
    const d = fixture('bad-site');
    const f = d.fixes.find(
      (x) => x.number === 4 && x.site_id === '50000000-0000-4000-8000-000000000001',
    )!;
    expect(f).toMatchObject({ section: 'content', rank: 6 });
    expect(f.effect.ai_readability_pending_on).toEqual(['0f1e000000000001', '0f1e000000000002']);
    expect(rowOf(d, 'bad-site', f.id)).toBe('AI after fixes 1 and 2');
    expect(headOf(d, 'bad-site', f.id)).toBe('— AI effect estimated after fixes 1 and 2');
    expect(waitingWith(['0f1e0000000000ca']).unit).toBe('AI effect estimated after fix 2');
    expect(waitingWith(['0f1e0000000000ca']).row).toBe('AI after fix 2');
  });

  it('skips a fingerprint that names no fix of the site, for the first reason listed', () => {
    expect(waitingWith(['0f1e00000000dead', 'check_not_scored']).unit).toBe(
      AI_WAITING.check_not_scored,
    );
  });
});
