import { describe, expect, it } from 'vitest';
import { listMigrations } from './files';
import { gateProblems, manifestProblems } from './production';
import type { DryRunSummary } from './summary';

const pending = listMigrations().filter((f) => f.version > '20261101000001');
const summary = (over: Partial<DryRunSummary> = {}): DryRunSummary => ({
  passed: true,
  commit: 'abc',
  branch: 'pr-1',
  finishedAt: '2026-11-05T00:00:00Z',
  steps: [],
  files: pending.map((f) => ({ file: f.file, sha256: f.sha256 })),
  production: {},
  ...over,
});

describe('the gate before the owner approves', () => {
  it('passes when the dry run passed with these exact bytes', () => {
    expect(pending).toHaveLength(4);
    expect(gateProblems(pending, summary())).toEqual([]);
  });

  it('refuses a dry run that did not pass', () => {
    expect(gateProblems(pending, summary({ passed: false }))).toEqual(['the dry run did not pass']);
  });

  it('refuses a pending file the dry run did not apply', () => {
    const s = summary({ files: summary().files.slice(1) });
    expect(gateProblems(pending, s)).toEqual([`${pending[0]!.file} was not in the dry run`]);
  });

  it('refuses a pending file whose bytes changed after the dry run', () => {
    const files = summary().files.map((f, i) => (i === 2 ? { ...f, sha256: '0'.repeat(64) } : f));
    expect(gateProblems(pending, summary({ files }))).toEqual([
      `${pending[2]!.file} differs from the bytes the dry run applied`,
    ]);
  });
});

describe('the manifest check after the owner approves', () => {
  const manifest = pending.map((f) => ({ file: f.file, sha256: f.sha256 }));

  it('passes when production still has exactly the approved files pending', () => {
    expect(manifestProblems(manifest, pending)).toEqual([]);
  });

  it.each([
    ['one fewer pending', pending.slice(1)],
    [
      'one more pending',
      [...listMigrations().filter((f) => f.version === '20261101000001'), ...pending],
    ],
    ['a changed file', pending.map((f, i) => (i === 0 ? { ...f, sha256: 'f'.repeat(64) } : f))],
  ])('refuses %s', (_label, now) => {
    expect(manifestProblems(manifest, now)[0]).toMatch(/not the approved manifest/);
  });
});
