/**
 * The two-check fixture pair: packages/engine/fixtures/v2/diff/pair-input.json run through the diff
 * must give exactly the rows, statuses and events written by hand in expected-diff.json.
 */
import { readFileSync } from 'node:fs';
import { ChangeSchema } from '@crawlmouse/types/v2';
import { describe, expect, it } from 'vitest';
import { diffCheck } from './diff.js';
import type { DiffInput } from './types.js';

const DIR = new URL('../../../fixtures/v2/diff/', import.meta.url);
const read = (name: string) => JSON.parse(readFileSync(new URL(name, DIR), 'utf8'));
const input = read('pair-input.json') as DiffInput;
const expected = read('expected-diff.json') as {
  changes: Record<string, unknown>[];
  fixes: { fingerprint: string; number: number; status: string; rank: number | null }[];
  events: { fingerprint: string; kind: string }[];
};

describe('the two-check fixture pair', () => {
  it('gives each check every field a CheckSide has (the JSON is cast, not type-checked)', () => {
    const fields = ['check', 'detectors', 'indeterminate', 'page_cap', 'robots_txt'];
    expect(Object.keys(input.previous!).sort()).toEqual(fields);
    expect(Object.keys(input.current).sort()).toEqual(fields);
  });

  const result = diffCheck(input);
  const fingerprintOf = new Map(
    [...input.fixes, ...result.fixes].map((f) => [f.id, f.fingerprint] as const),
  );

  it('writes the change rows written by hand, in order', () => {
    const rows = result.changes.map((c) => {
      ChangeSchema.parse(c);
      const { id, fix_id, ...rest } = c;
      expect(id).toMatch(/^[0-9a-f-]{36}$/);
      return { ...rest, fix_fingerprint: fix_id === null ? null : fingerprintOf.get(fix_id) };
    });
    expect(rows).toEqual(expected.changes);
  });

  it('leaves each fix at the status and rank written by hand', () => {
    expect(
      result.fixes.map((f) => ({
        fingerprint: f.fingerprint,
        number: f.number,
        status: f.status,
        rank: f.rank,
      })),
    ).toEqual(expected.fixes);
  });

  it('appends the events written by hand', () => {
    expect(
      result.events.map((e) => ({ fingerprint: fingerprintOf.get(e.fix_id), kind: e.kind })),
    ).toEqual(expected.events);
  });
});
