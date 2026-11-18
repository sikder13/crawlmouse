import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { jsonBytes } from './json-bytes.js';

/** What the store holds for a string: its JSON, quotes excluded, in UTF-8 bytes (store.ts). */
const stored = (s: string) => Buffer.byteLength(JSON.stringify(s)) - 2;

describe('jsonBytes', () => {
  it('counts a string mixing quotes, backslashes and control characters as JSON.stringify writes it', () => {
    const s = 'a"b\\c\u0001d\n\t"\\\u001f\u007f';
    // ASCII only, so JSON's length in UTF-16 units is its length in bytes.
    expect(JSON.stringify(s).length - 2).toBe(29);
    expect(jsonBytes(s)).toBe(29);
    // UTF-8 counting, what the room counted before, says 13.
    expect(Buffer.byteLength(s)).toBe(13);
  });

  it('counts a page of quotes at twice its UTF-8 size', () => {
    const s = '"'.repeat(100_000);
    expect(jsonBytes(s)).toBe(200_000);
    expect(jsonBytes(s)).toBe(stored(s));
  });

  it('agrees with JSON.stringify on any string, lone surrogates included', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.oneof(
            fc.string({ unit: 'binary' }),
            fc.constantFrom('"', '\\', '\u0000', '\u0008', '\u001f', '\ud800', '\udfff', '😀'),
          ),
        ),
        (parts) => {
          const s = parts.join('');
          expect(jsonBytes(s)).toBe(stored(s));
        },
      ),
      { numRuns: 500 },
    );
  });
});
