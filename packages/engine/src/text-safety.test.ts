import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { toPersistableText, hasLoneSurrogate } from './text-safety.js';

/**
 * Control characters are written as ESCAPES, never as literal bytes. An earlier version of this file
 * held a literal NUL, which made git classify it as binary — so a whole round's changes to it were
 * invisible in the diff and reviewers' `grep` skipped the file entirely.
 */
const NUL = '\u0000';
const SOH = '\u0001';
const DEL = '\u007f';
const LONE_HIGH = '\ud800';
const LONE_LOW = '\udfff';

/** Independent oracle — deliberately NOT the implementation, so a bug in one cannot hide in the other. */
const oracleHasLone = (s: string): boolean => {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const n = s.charCodeAt(i + 1);
      if (!(n >= 0xdc00 && n <= 0xdfff)) return true;
      i++;
    } else if (c >= 0xdc00 && c <= 0xdfff) return true;
  }
  return false;
};

const bytes = (s: string): number => Buffer.byteLength(s, 'utf8');
const CONTROL_RE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

/**
 * Strings that ACTUALLY exercise the hazards. `fc.string()` almost never emits a lone surrogate or a
 * control character, so a naive generator makes every property pass vacuously — the fixture-too-small
 * failure this suite exists to prevent.
 */
const hazardousString = fc.string({
  unit: fc.oneof(
    { weight: 6, arbitrary: fc.constantFrom('a', ' ', 'é', '中', '\u{1F600}', '\u{10348}', '￿') },
    { weight: 3, arbitrary: fc.constantFrom(LONE_HIGH, '\udc00', '\udbff', LONE_LOW) },
    // Every boundary of the strip predicate AND both utf8Width tier edges. A narrow alphabet left
    // 0x08/0x0b/0x0c/0x0e and U+0080/U+0800 unpinned — the positions immediately adjacent to the
    // KEPT set are exactly where an off-by-one lives.
    { weight: 3, arbitrary: fc.constantFrom(NUL, SOH, DEL, '\u0008', '\u000b', '\u000c', '\u000e', '\u001f') },
    { weight: 2, arbitrary: fc.constantFrom('\u007f', '\u0080', '\u07ff', '\u0800', '\uffff') },
    { weight: 1, arbitrary: fc.constantFrom('\n', '\t', '\r', '"', '\\') },
  ),
  maxLength: 200,
});

describe('toPersistableText — the three jobs, one pass', () => {
  it('REPAIRS unpaired surrogates (rejected by jsonb as 22P02)', () => {
    // The inbound hazard: JSON.parse ACCEPTS an unpaired \uXXXX escape, so crawled JSON-LD carries one
    // whole, with no truncation involved.
    const parsed = JSON.parse('{"@type":"\\ud800"}') as { '@type': string };
    expect(hasLoneSurrogate(parsed['@type'])).toBe(true);
    expect(hasLoneSurrogate(toPersistableText(parsed['@type'], 100))).toBe(false);
    expect(hasLoneSurrogate(toPersistableText(`a${LONE_HIGH}b`, 100))).toBe(false);
    expect(hasLoneSurrogate(toPersistableText(`a${LONE_LOW}b`, 100))).toBe(false);
  });

  it('STRIPS NUL — rejected by jsonb AND by text, so it is audit-fatal on both column types', () => {
    // Arrives through the SAME JSON.parse channel as the lone surrogate. Repairing only surrogates left
    // it open; that was the round-4 blocker.
    const parsed = JSON.parse('{"@type":"Acme\\u0000Corp"}') as { '@type': string };
    expect(parsed['@type']).toContain(NUL); // JSON.parse really does yield a raw NUL
    expect(toPersistableText(parsed['@type'], 100)).toBe('AcmeCorp');
  });

  it('STRIPS other C0 controls and DEL — each costs SIX wire bytes as a JSON escape', () => {
    expect(toPersistableText(`a${SOH}b${DEL}c`, 100)).toBe('abc');
    // …which is what keeps the byte budget honest end to end: 2000 SOH would serialize to 12 000 bytes.
    expect(bytes(JSON.stringify(toPersistableText(SOH.repeat(2000), 2000)))).toBeLessThan(20);
  });

  it('KEEPS tab, newline and carriage return — legitimate prose whitespace, 2 JSON bytes each', () => {
    expect(toPersistableText('a\tb\nc\rd', 100)).toBe('a\tb\nc\rd');
  });

  it('TRUNCATES by UTF-8 BYTES, not code units', () => {
    // A CJK char is 1 code unit but 3 bytes; an emoji is 2 units and 4 bytes. Counting units let a
    // "2000" budget put 6000 bytes on the wire.
    expect(toPersistableText('中'.repeat(1000), 300)).toHaveLength(100); // 300 / 3
    expect(bytes(toPersistableText('中'.repeat(1000), 300))).toBeLessThanOrEqual(300);
    expect(bytes(toPersistableText('\u{1F600}'.repeat(1000), 300))).toBeLessThanOrEqual(300);
    expect(toPersistableText('\u{1F600}'.repeat(1000), 300)).toHaveLength(150); // 75 emoji x 2 units
  });

  it('is byte-identical to a plain slice on ASCII — the compatibility guarantee', () => {
    // Why every pre-existing fixture and the minted-snapshot byte-identity pin are unchanged.
    const ascii = 'abcdefghij'.repeat(500);
    expect(toPersistableText(ascii, 2000)).toBe(ascii.slice(0, 2000));
    expect(toPersistableText(ascii, 99_999)).toBe(ascii);
  });

  it('never splits a code point, at ANY budget around a multi-byte boundary', () => {
    for (let b = 0; b <= 12; b++) {
      const out = toPersistableText('\u{1F600}\u{1F600}\u{1F600}', b);
      expect(bytes(out), `budget ${b}`).toBeLessThanOrEqual(b);
      expect(out.length % 2, `budget ${b} must not end mid-pair`).toBe(0);
    }
    for (let b = 0; b <= 9; b++) {
      expect(bytes(toPersistableText('中中中', b)), `budget ${b}`).toBeLessThanOrEqual(b);
    }
  });

  it('U+FFFF is a 3-byte BMP char, not a surrogate — the code-point step must not treat it as one', () => {
    // The step (`cp > 0xffff ? 2 : 1`) is off-by-one-able exactly here, and the previous generator
    // never emitted U+FFFF, so the byte bound could not see it.
    expect(bytes(toPersistableText('￿ZZ', 3))).toBeLessThanOrEqual(3);
    expect(toPersistableText('￿ZZ', 3)).toBe('￿');
  });

  it('zero and negative budgets yield the empty string', () => {
    expect(toPersistableText('anything', 0)).toBe('');
    expect(toPersistableText('anything', -5)).toBe('');
  });
});

describe('toPersistableText — properties', () => {
  it('output is ALWAYS well-formed, control-free, and within the BYTE budget', () => {
    fc.assert(
      fc.property(hazardousString, fc.integer({ min: 0, max: 250 }), (s, budget) => {
        const out = toPersistableText(s, budget);
        expect(oracleHasLone(out)).toBe(false);
        expect(bytes(out)).toBeLessThanOrEqual(budget);
        expect(CONTROL_RE.test(out)).toBe(false);
      }),
      { numRuns: 4000 },
    );
  });

  it('DETERMINISTIC (R1) and IDEMPOTENT', () => {
    fc.assert(
      fc.property(hazardousString, fc.integer({ min: 0, max: 250 }), (s, budget) => {
        const once = toPersistableText(s, budget);
        expect(toPersistableText(s, budget)).toBe(once);
        expect(toPersistableText(once, budget)).toBe(once);
      }),
      { numRuns: 3000 },
    );
  });

  it('agrees with the independent lone-surrogate oracle', () => {
    fc.assert(
      fc.property(hazardousString, (s) => {
        expect(hasLoneSurrogate(s)).toBe(oracleHasLone(s));
      }),
      { numRuns: 2000 },
    );
  });

  it('is O(budget), not O(input) — a huge hostile string costs no more than a small one', () => {
    // The composed repair-then-cut version copied the ENTIRE input before cutting to 100 bytes: one
    // lone surrogate inside a 5 MB @type cost 304 ms, and 25 of them cost 6.3 s on a single page.
    const huge = `${'x'.repeat(5_000_000)}${LONE_HIGH}`;
    const t0 = performance.now();
    toPersistableText(huge, 100);
    const elapsed = performance.now() - t0;
    expect(elapsed, `took ${elapsed.toFixed(1)}ms`).toBeLessThan(50);
  });

  it('the strip predicate is pinned at EVERY boundary, including the ones adjacent to the kept set', () => {
    // 0x09/0x0a/0x0d are kept; 0x08, 0x0b, 0x0c, 0x0e are their immediate neighbours and are exactly
    // where an off-by-one hides. Each was an unpinned mutant before this case.
    for (const cp of [0x00, 0x01, 0x08, 0x0b, 0x0c, 0x0e, 0x1f, 0x7f]) {
      const ch = String.fromCharCode(cp);
      expect(toPersistableText(`a${ch}b`, 100), `U+${cp.toString(16).padStart(4, '0')} must be stripped`).toBe('ab');
    }
    for (const cp of [0x09, 0x0a, 0x0d]) {
      const ch = String.fromCharCode(cp);
      expect(toPersistableText(`a${ch}b`, 100), `U+${cp.toString(16).padStart(4, '0')} must be kept`).toBe(`a${ch}b`);
    }
  });

  it('utf8Width is pinned at every tier edge (U+007F/0080, U+07FF/0800, U+FFFF/10000)', () => {
    // The `< 0x80` / `< 0x800` / `< 0x10000` comparisons are off-by-one-able and were unpinned.
    expect(bytes(toPersistableText('\u007f'.repeat(10), 5))).toBeLessThanOrEqual(5); // stripped anyway (DEL)
    expect(toPersistableText('\u0080\u0080', 2)).toBe('\u0080');          // 2 bytes each
    expect(toPersistableText('\u07ff\u07ff', 2)).toBe('\u07ff');
    expect(toPersistableText('\u0800\u0800', 3)).toBe('\u0800');          // 3 bytes each
    expect(toPersistableText('\uffff\uffff', 3)).toBe('\uffff');
    // Budget 6 is what distinguishes 4 bytes from 3: at budget 4 the second char fails either way.
    expect(toPersistableText('\u{10000}\u{10000}', 4)).toBe('\u{10000}');
    expect(toPersistableText('\u{10000}\u{10000}', 6)).toBe('\u{10000}'); // 4+4 > 6, so still one
  });

  it('a non-finite budget yields the empty string rather than an unbounded result', () => {
    expect(toPersistableText('abcdef', Number.NaN)).toBe('');
    // Infinity too: the title says "yields the empty string", and an unbounded result is the wrong
    // failure direction for a bounding function. The assertion used to contradict its own title.
    expect(toPersistableText('abcdef', Number.POSITIVE_INFINITY)).toBe('');
  });
});
