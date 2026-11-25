import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { titleOf } from './challenge.js';

/** The regular expression titleOf replaces, kept here as the reference it must agree with. */
const byRegex = (html: string): string | null => {
  const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  return m ? m[1]!.trim().toLowerCase() : null;
};

describe('titleOf', () => {
  it('finds what the regular expression found, on generated pages built from the tags it reads', () => {
    const piece = fc.constantFrom(
      '<title',
      '<TITLE',
      '<title>',
      '</title>',
      '</TITLE>',
      '>',
      '<',
      '/',
      ' x ',
      'Just a moment...',
      ' class="a"',
      '\n',
      // Characters whose case behaves differently under /i and toLowerCase: the axis the change moved.
      'İ',
      'ı',
      'Σ',
      'AΣ',
      'ẞ',
      '\u212A',
      'ſ',
      '<TİTLE',
      '</tİtle>',
      'title',
    );
    fc.assert(
      fc.property(fc.array(piece, { maxLength: 30 }), (parts) => {
        const html = parts.join('');
        expect(titleOf(html.toLowerCase())).toBe(byRegex(html));
      }),
      { numRuns: 5_000 },
    );
  });

  it('reads the ordinary cases', () => {
    const at = (h: string) => titleOf(h.toLowerCase());
    expect(at('<html><head><title> Just a moment... </title></head></html>')).toBe(
      'just a moment...',
    );
    expect(at('<title data-x="1">A</title><title>B</title>')).toBe('a');
    expect(at('<title>never closed')).toBeNull();
    expect(at('<p>no title</p>')).toBeNull();
  });

  // The regular expression on these inputs, measured on a workstation on 2026-11-24: 9.7 s and 12.4 s.
  // Sized so that it fails here in seconds rather than hanging the run.
  it.each([
    ['many <title with no >', '<title'.repeat(40_000)],
    ['many <title>a with no </title>', '<title>a'.repeat(80_000)],
  ])('reads %s in linear time', (_name, html) => {
    const started = performance.now();
    expect(titleOf(html.toLowerCase())).toBeNull();
    expect(performance.now() - started).toBeLessThan(500);
  });
});
