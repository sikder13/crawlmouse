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
            // Class boundaries, mixed into longer strings; the sweep below checks each code unit alone.
            fc.constantFrom(
              '"',
              '\\',
              '\u0000',
              '\u0008',
              '\u000b',
              '\u001f',
              '\u007f',
              '\u0080',
              '\u00a0',
              '\u07ff',
              '\u0800',
              '\u2028',
              '\u2029',
              '\ud7ff',
              '\ud800',
              '\udbff',
              '\udc00',
              '\udfff',
              '\ue000',
              '\uffff',
              '😀',
            ),
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

  // Every UTF-16 code unit, alone: a miscount of any single one fails here, generated or not. Then
  // the pairs, where a high surrogate before a low one is one 4-byte character and any other order
  // is two lone surrogates.
  it('agrees with JSON.stringify on every code unit, and on surrogates in every order', () => {
    const wrong: string[] = [];
    const check = (s: string) => {
      if (jsonBytes(s) !== stored(s)) wrong.push(JSON.stringify(s));
    };
    for (let c = 0; c <= 0xffff; c++) check(String.fromCharCode(c));
    for (let h = 0xd800; h <= 0xdbff; h++) {
      for (const l of [0xdc00, 0xdfff]) check(String.fromCharCode(h, l));
      check(String.fromCharCode(h, 0x61));
      check(String.fromCharCode(0xdc00, h));
    }
    for (let l = 0xdc00; l <= 0xdfff; l++) {
      for (const h of [0xd800, 0xdbff]) check(String.fromCharCode(h, l));
      check(String.fromCharCode(l, l));
    }
    expect(wrong).toEqual([]);
  });
});
