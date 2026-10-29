import fc from 'fast-check';
import { setFlagsFromString } from 'node:v8';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { bounded, CAPS } from './bounded.js';

setFlagsFromString('--expose-gc');
const gc = runInNewContext('gc') as () => void;

describe('bounded', () => {
  it('cuts text to its cap in UTF-8 bytes, as toPersistableText cuts', () => {
    expect(bounded('a\u0001b\ud800', { kind: 'text', bytes: 5 })).toBe('ab\ufffd');
    fc.assert(
      fc.property(fc.string({ unit: 'binary' }), fc.nat({ max: 50 }), (s, bytes) => {
        expect(Buffer.byteLength(bounded(s, { kind: 'text', bytes }))).toBeLessThanOrEqual(bytes);
      }),
    );
  });

  it('keeps a whole value up to its cap, and none past it', () => {
    const url = `https://example.com/${'p'.repeat(2028)}`;
    expect(url).toHaveLength(2048);
    expect(bounded(url, CAPS.url)).toBe(url);
    expect(bounded(`${url}q`, CAPS.url)).toBeNull();
  });

  it('holds what it keeps as a flat copy', () => {
    // As toPersistableText builds them, 1,000 such texts held 60 MiB of fragments; a slice of a
    // 10 MiB body would hold the body.
    const body = Buffer.alloc(10 * 1024 * 1024, 'abcdefgh ').toString('utf8');
    gc();
    gc();
    const before = process.memoryUsage().heapUsed;
    const kept = [
      ...Array.from({ length: 1000 }, (_, i) =>
        bounded(`${'x'.repeat(3000)}${i}`, CAPS.anchorText),
      ),
      bounded(body.slice(0, 2000), CAPS.url),
    ];
    gc();
    gc();
    expect(kept).toHaveLength(1001);
    expect((process.memoryUsage().heapUsed - before) / 1048576).toBeLessThan(4);
  });
});
