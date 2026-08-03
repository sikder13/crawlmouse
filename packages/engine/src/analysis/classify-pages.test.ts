import { describe, it, expect } from 'vitest';
import { classifyPages, type ClassifyInput } from './classify-pages.js';
import { simhash64 } from './simhash.js';
import { MIN_GRADEABLE_TEXT_CHARS } from '../constants.js';

// ─────────────────────────────────────────────────────────────────────────────
// SPEC 5.1a §5 — classification, and the M9 population/graph split it feeds.
// ─────────────────────────────────────────────────────────────────────────────

const HOME = 'https://s.test';
const noCms = (_u: string) => false;
const opts = { homepageUrl: HOME, isCmsExcluded: noCms };
const p = (url: string, extra: Partial<ClassifyInput> = {}): ClassifyInput => ({
  url, urlHash: `hash-${url}`, mainTextChars: 500, simhash: null, noindex: false, ...extra,
});
const kinds = (inputs: ClassifyInput[], o = opts) => {
  const m = classifyPages(inputs, o);
  return Object.fromEntries([...m].map(([u, c]) => [u, c.kind]));
};

describe('§5 layering', () => {
  it('classifies the E5 URLs correctly and leaves real pages content', () => {
    expect(kinds([
      p(HOME), p(`${HOME}/about`), p(`${HOME}/contact`),
      p(`${HOME}/cp/auth/login`), p(`${HOME}/tweets/1876554433221100`), p(`${HOME}/tag/seo`),
    ])).toEqual({
      [HOME]: 'content',
      [`${HOME}/about`]: 'content',
      [`${HOME}/contact`]: 'content',
      [`${HOME}/cp/auth/login`]: 'auth',
      [`${HOME}/tweets/1876554433221100`]: 'status',
      [`${HOME}/tag/seo`]: 'archive',
    });
  });

  it('the homepage is gradeable even when its URL would match a rule', () => {
    // The homepage is the BFS root and the orphan seed. Excluding it leaves every page unreachable —
    // the exact shape depth.ts already carries a fallback for.
    const home = `${HOME}/search`;
    expect(kinds([p(home)], { homepageUrl: home, isCmsExcluded: noCms })[home]).toBe('content');
  });

  it('applies the CMS overlay through the SAME entry point, not beside it', () => {
    const wp = (u: string) => u.includes('/wp-admin');
    expect(kinds([p(`${HOME}/wp-admin/edit`)], { homepageUrl: HOME, isCmsExcluded: wp })[`${HOME}/wp-admin/edit`])
      .toBe('utility');
  });

  it('excludes a noindex page (§5.2) but records why', () => {
    const m = classifyPages([p(`${HOME}/thanks`, { noindex: true })], opts);
    const c = m.get(`${HOME}/thanks`)!;
    expect(c.kind).toBe('utility');
    expect(c.gradeable).toBe(false);
    expect(c.reason).toBe('directive:noindex');
  });

  it('marks a page below the thin floor as thin, and keeps a short-but-real page', () => {
    expect(kinds([
      p(`${HOME}/stub`, { mainTextChars: MIN_GRADEABLE_TEXT_CHARS - 1 }),
      p(`${HOME}/contact`, { mainTextChars: MIN_GRADEABLE_TEXT_CHARS }),
    ])).toEqual({ [`${HOME}/stub`]: 'thin', [`${HOME}/contact`]: 'content' });
  });

  it('keeps a page whose extraction DEGRADED rather than assuming it is thin', () => {
    // Absence of a signal is not evidence of thinness. Treating undefined as 0 would exclude every
    // page on a site whose DOM trips the extractor — a silent, total grade change.
    expect(kinds([p(`${HOME}/x`, { mainTextChars: undefined })])[`${HOME}/x`]).toBe('content');
  });

  it('every classification carries a non-empty reason', () => {
    const m = classifyPages([
      p(HOME), p(`${HOME}/login`), p(`${HOME}/stub`, { mainTextChars: 1 }), p(`${HOME}/ok`),
    ], opts);
    for (const [url, c] of m) expect(c.reason, `empty reason for ${url}`).toBeTruthy();
  });
});

describe('§5.4 duplicate collapsing', () => {
  const long = (product: string) =>
    `${product} available now. ` +
    Array.from({ length: 60 }, (_, i) => `shared boilerplate sentence ${i} about shipping returns and warranty`).join(' ');

  it('collapses near-duplicates onto ONE representative and names it', () => {
    const a = p(`${HOME}/a-widget`, { simhash: simhash64(long('Blue Widget')) });
    const b = p(`${HOME}/b-widget`, { simhash: simhash64(long('Red Gadget')) });
    const m = classifyPages([a, b], opts);
    expect(m.get(`${HOME}/a-widget`)!.kind).toBe('content');
    const dup = m.get(`${HOME}/b-widget`)!;
    expect(dup.kind).toBe('duplicate');
    expect(dup.duplicateOf).toBe(a.urlHash);
  });

  it('picks the representative by canonical URL ASC, NOT by input order', () => {
    // Arrival order is a forbidden input (§6.6). If the representative were the first ARRIVAL, the same
    // page would be content or duplicate depending on network timing — non-determinism straight into
    // the grade. Feeding the same pair in both orders must give the same verdict.
    const a = p(`${HOME}/aaa`, { simhash: simhash64(long('One')) });
    const b = p(`${HOME}/zzz`, { simhash: simhash64(long('Two')) });
    for (const order of [[a, b], [b, a]]) {
      const m = classifyPages(order, opts);
      expect(m.get(`${HOME}/aaa`)!.kind).toBe('content');
      expect(m.get(`${HOME}/zzz`)!.kind).toBe('duplicate');
    }
  });

  it('never collapses pages whose text was too short for a k=3 verdict', () => {
    // simhash null (the §5.4 floor) must mean "no duplicate verdict", not "duplicate of everything".
    expect(kinds([
      p(`${HOME}/one`, { simhash: null }), p(`${HOME}/two`, { simhash: null }),
    ])).toEqual({ [`${HOME}/one`]: 'content', [`${HOME}/two`]: 'content' });
  });

  it('does not collapse genuinely different long pages', () => {
    const a = p(`${HOME}/a`, { simhash: simhash64(Array.from({ length: 150 }, (_, i) => `alpha${i}`).join(' ')) });
    const b = p(`${HOME}/b`, { simhash: simhash64(Array.from({ length: 150 }, (_, i) => `beta${i}`).join(' ')) });
    expect(kinds([a, b])).toEqual({ [`${HOME}/a`]: 'content', [`${HOME}/b`]: 'content' });
  });
});
