import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { FIXTURE_NAMES } from './fixture-names';
import { fixture } from './fixtures';
import { NOT_ONE_LINE, oneLine } from './packet-text';

const NL = String.fromCharCode(10);
const CR = String.fromCharCode(13);
const LINE_SEPARATOR = String.fromCharCode(0x2028);
const PARAGRAPH_SEPARATOR = String.fromCharCode(0x2029);
const NEXT_LINE = String.fromCharCode(0x85);
const RIGHT_TO_LEFT_OVERRIDE = String.fromCharCode(0x202e);
const ZERO_WIDTH_SPACE = String.fromCharCode(0x200b);
const ESCAPE = String.fromCharCode(0x1b);
const NUL = String.fromCharCode(0);

describe('oneLine', () => {
  it.each([
    ['a line feed', `a${NL}b`, 'a b'],
    ['a carriage return and line feed', `a${CR}${NL}b`, 'a b'],
    ['a run of breaks', `a${NL}${NL}${CR}b`, 'a b'],
    ['a line separator', `a${LINE_SEPARATOR}b`, 'a b'],
    ['a paragraph separator', `a${PARAGRAPH_SEPARATOR}b`, 'a b'],
    ['a next-line character', `a${NEXT_LINE}b`, 'a b'],
    ['a tab', 'a\tb', 'a b'],
    ['an escape sequence', `a${ESCAPE}[2Jb`, 'a [2Jb'],
    ['a NUL', `a${NUL}b`, 'a b'],
    ['a right-to-left override', `a${RIGHT_TO_LEFT_OVERRIDE}b`, 'ab'],
    ['a zero-width space', `a${ZERO_WIDTH_SPACE}b`, 'ab'],
    ['a break at either end', `${NL}a b${NL}`, 'a b'],
  ])('%s', (_name, text, expected) => {
    expect(oneLine(text)).toBe(expected);
  });

  it('leaves a line of ordinary text as it is, spaces and punctuation included', () => {
    const line = 'curl -sA "X/1.0"  https://example.com/a?b=1&c=2 | grep -c \'three-season\' → ≥ 1';
    expect(oneLine(line)).toBe(line);
  });

  it('leaves no break, control or format character, whatever the text', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'binary' }), (text) => {
        expect(NOT_ONE_LINE.test(oneLine(text))).toBe(false);
      }),
    );
  });

  it('is the identity on what it has cleaned', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'binary' }), (text) => {
        expect(oneLine(oneLine(text))).toBe(oneLine(text));
      }),
    );
  });

  it('changes no title and no packet string of a contract fixture', () => {
    const strings = FIXTURE_NAMES.flatMap((name) =>
      fixture(name).fixes.flatMap((f) => [
        f.title,
        ...(f.packet
          ? [f.packet, ...f.packet.packets].flatMap((b) => [
              ...b.context,
              ...b.change,
              ...b.keep,
              b.verify.command,
              b.verify.expect,
            ])
          : []),
      ]),
    );
    expect(strings.length).toBeGreaterThan(50);
    expect(strings.filter((s) => oneLine(s) !== s)).toEqual([]);
  });
});
