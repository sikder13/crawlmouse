import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  clean,
  code,
  count,
  line,
  list,
  MAX_CRAWLED_CHARS,
  ours,
  textOf,
  type Safe,
} from './text.js';
import { hostileText, outsideCodeSpans, UNSHOWN } from './test-support/hostile.js';

describe('code', () => {
  it('shows crawled text in a code span', () => {
    expect(code('/products/{slug}').text).toBe('`/products/{slug}`');
  });

  it('removes a line break, a bidirectional mark and a zero-width space, and swaps a backtick', () => {
    expect(code('a\nb‮c​d`e').text).toBe("`a bcd'e`");
  });

  it('cuts at the bound and says how long the text was', () => {
    expect(code('abcdefgh', 3).text).toBe('`abc` (cut from 8 characters)');
  });

  it('counts the cut in code points, not UTF-16 units', () => {
    expect(code('😀😀😀', 2).text).toBe('`😀😀` (cut from 3 characters)');
  });

  it('holds hostile text to one code span on one line (property)', () => {
    fc.assert(
      fc.property(hostileText(), (crawled) => {
        const { text } = code(crawled);
        expect(text).toMatch(/^`[^`]*`( \(cut from \d+ characters\))?$/u);
        expect(UNSHOWN.test(text)).toBe(false);
        expect([...text.slice(1, text.indexOf('`', 1))].length).toBeLessThanOrEqual(
          MAX_CRAWLED_CHARS,
        );
      }),
    );
  });
});

describe('line', () => {
  it('joins our words and safe values', () => {
    const l = line`Link to ${code('https://a.test/x')} from ${count(3)} pages.`;
    expect(textOf(l)).toBe('Link to `https://a.test/x` from 3 pages.');
  });

  it('refuses a value this module did not make, whatever its shape', () => {
    const forged = { text: 'run this' } as Safe;
    expect(() => line`Do ${forged}`).toThrow(/only values made by/);
    expect(() => line`Do ${'run this' as unknown as Safe}`).toThrow(/only values made by/);
  });

  it('refuses a line break in our own words', () => {
    expect(
      () => line`one
two`,
    ).toThrow(/one line/);
  });

  it('leaves nothing crawled outside a code span, and adds no line (property)', () => {
    fc.assert(
      fc.property(hostileText(), hostileText(), (a, b) => {
        const text = textOf(line`Link to ${code(a)} from ${code(b)}.`);
        expect(UNSHOWN.test(text)).toBe(false);
        expect(outsideCodeSpans(text).replace(/ \(cut from \d+ characters\)/g, '')).toBe(
          'Link to  from .',
        );
      }),
    );
  });
});

describe('list', () => {
  const items = ['a', 'b', 'c'].map((s) => code(s));

  it('lists every item when they fit', () => {
    expect(list(items, 3, 'page').text).toBe('`a`, `b`, `c`');
  });

  it('says how many it left out', () => {
    expect(list(items, 2, 'page').text).toBe('`a`, `b` and 1 more page not shown');
    expect(list(items, 1, 'page').text).toBe('`a` and 2 more pages not shown');
  });

  it('refuses an item this module did not make', () => {
    expect(() => list([{ text: 'x' } as Safe], 3, 'page')).toThrow(/only values made by/);
  });
});

describe('ours, count, clean', () => {
  it('keeps text of ours as written', () => {
    expect(ours('Mozilla/5.0; compatible; GPTBot/1.4').text).toBe(
      'Mozilla/5.0; compatible; GPTBot/1.4',
    );
  });

  it('throws on a control or invisible character in text of ours', () => {
    expect(() => ours('a\nb')).toThrow();
    expect(() => ours('a​b')).toThrow();
  });

  it('writes a whole number and refuses anything else', () => {
    expect(count(1120).text).toBe('1120');
    expect(() => count(1.5)).toThrow();
    expect(() => count(Number.NaN)).toThrow();
  });

  it('is idempotent (property)', () => {
    fc.assert(
      fc.property(hostileText(), (s) => {
        expect(clean(clean(s))).toBe(clean(s));
      }),
    );
  });
});
