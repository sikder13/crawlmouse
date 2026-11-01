import fc from 'fast-check';
import { setFlagsFromString } from 'node:v8';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { detached } from './detached.js';

setFlagsFromString('--expose-gc');
const gc = runInNewContext('gc') as () => void;
const heldMiB = (keep: () => string[]): number => {
  gc();
  gc();
  const before = process.memoryUsage().heapUsed;
  const kept = keep();
  gc();
  gc();
  const held = (process.memoryUsage().heapUsed - before) / 1048576;
  expect(kept.length).toBeGreaterThan(0);
  return held;
};
const body = (): string => Buffer.alloc(10 * 1024 * 1024, 'abcdefgh ').toString('utf8');

describe('detached', () => {
  it('returns an equal string, for any string, lone surrogates included', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'binary' }), (s) => {
        expect(detached(s)).toBe(s);
      }),
    );
    expect(detached('a\ud800b\udc00')).toBe('a\ud800b\udc00');
  });

  it('keeps a prefix of a 10 MiB body without keeping the body', () => {
    // A slice of each would hold all eight bodies: 80 MiB.
    expect(
      heldMiB(() => Array.from({ length: 8 }, () => detached(body().slice(0, 4096)))),
    ).toBeLessThan(2);
  });
});
