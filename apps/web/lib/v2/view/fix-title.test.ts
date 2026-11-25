/**
 * D-12 (QA's production walk): three fixes on one site read "Describe pages under /fruit-and-veg/ in
 * their schema.org markup", and only their templates told them apart.
 */
import { describe, expect, it } from 'vitest';
import { fixture } from '../fixtures';
import { titleAmong } from './fix-title';
import { siteView } from './site';

const BAD_ACCOUNT = 'a0000000-0000-4000-8000-000000000001';
const OUTFITTER = '50000000-0000-4000-8000-000000000001';
const bad = fixture('bad-site');
const TITLE = 'Describe pages under /fruit-and-veg/ in their schema.org markup';

/** The fixture with fixes 4 and 7 (both open, /products/{slug}) given one title and two templates. */
function twins() {
  const d = structuredClone(bad);
  const [a, b] = ['0004', '0007'].map((n) => d.fixes.find((f) => f.id.endsWith(n))!);
  a!.title = TITLE;
  b!.title = TITLE;
  a!.template_key = '/fruit-and-veg/potatoes/{slug}';
  b!.template_key = '/fruit-and-veg/{slug}';
  return { d, a: a!, b: b! };
}

describe('titleAmong', () => {
  it('names the template of each fix whose title another fix of the site shares', () => {
    const { d, a, b } = twins();
    expect(titleAmong(a, d.fixes)).toBe(`${TITLE} · template /fruit-and-veg/potatoes/{slug}`);
    expect(titleAmong(b, d.fixes)).toBe(`${TITLE} · template /fruit-and-veg/{slug}`);
  });

  it('leaves a title alone that no other fix shares, or that another shares on the same template', () => {
    const { d, a, b } = twins();
    b.template_key = a.template_key;
    expect(titleAmong(a, d.fixes)).toBe(TITLE);
    const solo = bad.fixes.find((f) => f.id.endsWith('0008'))!;
    expect(titleAmong(solo, bad.fixes)).toBe(solo.title);
  });
});

describe('the site page’s fixes', () => {
  it('shows each of two same-titled fixes with its template (D-12)', () => {
    const { d } = twins();
    const view = siteView(d, { accountId: BAD_ACCOUNT, now: bad.as_of }, OUTFITTER, undefined, {
      allFixes: true,
    });
    const titles = view.fixes.rows.map((r) => r.title).filter((t) => t.startsWith(TITLE));
    expect(titles.sort()).toEqual([
      `${TITLE} · template /fruit-and-veg/potatoes/{slug}`,
      `${TITLE} · template /fruit-and-veg/{slug}`,
    ]);
  });
});
