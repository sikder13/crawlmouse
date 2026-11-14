import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { addsInternalColumn } from './marker-gate';
import { PGLITE_TIMEOUT, withMarker } from './test-support';

/**
 * The gate that turns the `accounts.internal` tests on (CC-38 questions Q1), and the guard that the
 * wiring binds CC-33's `runInternal` once it is on the tree.
 *   pnpm --filter @crawlmouse/scripts exec vitest run qa/marker-gate.test.ts
 */

describe('the accounts.internal gate', () => {
  it('finds the column however the statement is spelled', () => {
    for (const sql of [
      'alter table public.accounts add column if not exists internal boolean not null default false;',
      'ALTER TABLE accounts ADD COLUMN internal boolean;',
      'alter table if exists only public.accounts\n  add internal boolean default false;',
      'alter table "accounts" add column "internal" boolean;',
      'alter table public.accounts add column x int, add column internal boolean;',
    ]) {
      expect(addsInternalColumn(sql)).toBe(true);
    }
  });

  it('does not take another table, another column, or a later statement for it', () => {
    for (const sql of [
      'alter table public.accounts_view add column internal boolean;',
      'alter table public.users add column internal boolean;',
      'alter table public.accounts add column internal_note text;',
      'alter table public.accounts add column state text; create table t (internal boolean);',
      'select internal from public.accounts;',
    ]) {
      expect(addsInternalColumn(sql)).toBe(false);
    }
  });
});

describe('CC-33 binds ops:internal into the wiring', () => {
  const ops = new URL('../ops/internal.ts', import.meta.url);
  const wiring = readFileSync(new URL('./wiring.ts', import.meta.url), 'utf8');
  it('once scripts/ops/internal.ts exists, wiring.ts imports runInternal from it', () => {
    if (!existsSync(ops)) {
      // Before the CC-33 merge: the seam is the stub that throws (wiring.ts markInternal).
      expect(wiring).toMatch(/needs CC-33/);
      return;
    }
    expect(wiring).toMatch(
      /import\s*\{[^}]*\brunInternal\b[^}]*\}\s*from\s*['"]\.\.\/ops\/internal(?:\.ts)?['"]/,
    );
  });
});

describe('withMarker', () => {
  // Longer than vitest's 5 s default, which is what a seeded PGlite test under load took: it passes
  // only because withMarker hands its timeout to the test.
  withMarker(
    'gives the test the timeout it was handed',
    async () => {
      await new Promise((r) => setTimeout(r, 5_500));
    },
    PGLITE_TIMEOUT,
  );
});
