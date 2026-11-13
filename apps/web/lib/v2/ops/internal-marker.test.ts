import { describe, expect, it, vi } from 'vitest';
import {
  cachedLookup,
  INTERNAL_CACHE_MS,
  isInternalEvent,
  subjectsOf,
  type InternalLookup,
} from './internal-marker';

const A = 'a0000000-0000-4000-8000-000000000001';
const B = 'b0000000-0000-4000-8000-000000000001';

describe('subjectsOf: what a distinct id can say about an account', () => {
  it('reads an account, a seat and a bare id; an explicit account id is asked too', () => {
    expect(subjectsOf(`account:${A}`)).toEqual([{ kind: 'account', id: A }]);
    expect(subjectsOf(`seat:${A}`)).toEqual([{ kind: 'seat', id: A }]);
    expect(subjectsOf(A)).toEqual([{ kind: 'any', id: A }]);
    expect(subjectsOf('check:abc', B)).toEqual([{ kind: 'account', id: B }]);
    expect(subjectsOf(`account:${A}`, A)).toEqual([{ kind: 'account', id: A }]);
  });

  it('reads nothing from an anonymous id, a check ref, a report slug or a malformed id', () => {
    for (const id of ['check:abc', 'report:x', `anon:${A}`, 'account:nope', `account:${A}x`, ''])
      expect(subjectsOf(id), id).toEqual([]);
    expect(subjectsOf('check:abc', 'not-a-uuid')).toEqual([]);
  });
});

describe('cachedLookup', () => {
  it('asks once per subject in 60 seconds, then again', async () => {
    let now = 1_000_000;
    const inner = vi.fn<InternalLookup>(async () => true);
    const look = cachedLookup(inner, () => now);
    expect(await look({ kind: 'account', id: A })).toBe(true);
    now += INTERNAL_CACHE_MS - 1;
    expect(await look({ kind: 'account', id: A })).toBe(true);
    expect(inner).toHaveBeenCalledTimes(1);
    expect(await look({ kind: 'seat', id: A })).toBe(true);
    expect(inner).toHaveBeenCalledTimes(2);
    now += 1;
    await look({ kind: 'account', id: A });
    expect(inner).toHaveBeenCalledTimes(3);
  });

  it('keeps at most 500 answers, dropping the oldest first', async () => {
    const inner = vi.fn<InternalLookup>(async () => false);
    const look = cachedLookup(inner, () => 0);
    const id = (n: number) => `a0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
    for (let n = 0; n < 500; n++) await look({ kind: 'account', id: id(n) });
    await look({ kind: 'account', id: id(0) });
    expect(inner).toHaveBeenCalledTimes(500);
    await look({ kind: 'account', id: id(500) });
    expect(inner).toHaveBeenCalledTimes(501);
    await look({ kind: 'account', id: id(499) });
    await look({ kind: 'account', id: id(500) });
    expect(inner).toHaveBeenCalledTimes(501);
    await look({ kind: 'account', id: id(0) });
    expect(inner).toHaveBeenCalledTimes(502);
  });

  it('fails open: a lookup that throws answers false, logs without the id, and is asked again next time', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const inner = vi.fn<InternalLookup>(async () => {
      throw new Error(`boom ${A}`);
    });
    const look = cachedLookup(inner, () => 0);
    expect(await look({ kind: 'account', id: A })).toBe(false);
    expect(await look({ kind: 'account', id: A })).toBe(false);
    expect(inner).toHaveBeenCalledTimes(2);
    expect(log).toHaveBeenCalledWith('analytics: internal lookup failed');
    expect(log.mock.calls.flat().join(' ')).not.toContain(A);
    log.mockRestore();
  });
});

describe('isInternalEvent', () => {
  it('is true when any subject is internal, and asks nothing for an event with none', async () => {
    const inner = vi.fn<InternalLookup>(async (s) => s.id === B);
    expect(await isInternalEvent(`account:${A}`, B, inner)).toBe(true);
    expect(await isInternalEvent(`account:${A}`, undefined, inner)).toBe(false);
    inner.mockClear();
    expect(await isInternalEvent('check:abc', undefined, inner)).toBe(false);
    expect(inner).not.toHaveBeenCalled();
  });
});
