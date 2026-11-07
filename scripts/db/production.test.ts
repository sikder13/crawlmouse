import { describe, expect, it } from 'vitest';
import { listMigrations } from './files';
import {
  applyUnderLock,
  driftProblems,
  gateProblems,
  manifestProblems,
  type ApplySteps,
} from './production';
import { rollbackOrderProblem } from './rollback';
import { parseSummary, type DryRunSummary } from './summary';

// The v2 set as it stood when production recorded 006b. Later files are left out: P1
// (20261106000001_service_role_parity) is applied to production before any dry run sees it, and its
// rollback is deliberately empty, so it cannot be a pending file here.
const pending = listMigrations().filter(
  (f) => f.version > '20261101000001' && f.version <= '20261103000001',
);
const PRODUCTION = { acls: 'a'.repeat(32), columns: 'b'.repeat(32) };
const summary = (over: Partial<DryRunSummary> = {}): DryRunSummary => ({
  passed: true,
  commit: 'abc',
  branch: 'pr-1',
  finishedAt: '2026-11-05T00:00:00Z',
  steps: [],
  files: pending.map((f) => ({ file: f.file, sha256: f.sha256 })),
  rollbacks: [],
  production: { ...PRODUCTION },
  ...over,
});

describe('the gate before the owner approves', () => {
  it('passes when the dry run passed with these exact bytes on this production', () => {
    expect(pending).toHaveLength(4);
    expect(gateProblems(pending, summary(), PRODUCTION)).toEqual([]);
  });

  it('refuses a dry run that did not pass', () => {
    expect(gateProblems(pending, summary({ passed: false }), PRODUCTION)).toEqual([
      'the dry run did not pass',
    ]);
  });

  it('refuses a pending file the dry run did not apply', () => {
    const s = summary({ files: summary().files.slice(1) });
    expect(gateProblems(pending, s, PRODUCTION)).toEqual([
      `${pending[0]!.file} was not in the dry run`,
    ]);
  });

  it('refuses a pending file whose bytes changed after the dry run', () => {
    const files = summary().files.map((f, i) => (i === 2 ? { ...f, sha256: '0'.repeat(64) } : f));
    expect(gateProblems(pending, summary({ files }), PRODUCTION)).toEqual([
      `${pending[2]!.file} differs from the bytes the dry run applied`,
    ]);
  });

  it.each([
    [
      'a section that changed',
      { ...PRODUCTION, acls: 'c'.repeat(32) },
      ["production's acls section changed since the dry run read it"],
    ],
    [
      'a section the dry run did not see',
      { ...PRODUCTION, types: 'd'.repeat(32) },
      ["production's types section changed since the dry run read it"],
    ],
  ])(
    'refuses when production differs from what the dry run tested: %s',
    (_label, now, problems) => {
      expect(gateProblems(pending, summary(), now)).toEqual(problems);
    },
  );

  it('refuses a dry run that recorded no fingerprint of production', () => {
    expect(gateProblems(pending, summary({ production: {} }), PRODUCTION)).toEqual([
      'the dry run recorded no fingerprint of production',
    ]);
  });
});

describe('parseSummary reads the artifact as data to check', () => {
  const text = (over: Record<string, unknown>) => JSON.stringify({ ...summary(), ...over });

  it('accepts what the dry run writes', () => {
    expect(parseSummary(text({})).passed).toBe(true);
  });

  it.each([
    ['passed as the string "false"', { passed: 'false' }],
    ['a sha256 that is not one', { files: [{ file: pending[0]!.file, sha256: 'x' }] }],
    ['a file name with a path', { files: [{ file: '../x.sql', sha256: '0'.repeat(64) }] }],
    ['no rollbacks list', { rollbacks: undefined }],
    ['a production digest that is not an md5', { production: { acls: 'zz' } }],
  ])('refuses %s', (_label, over) => {
    expect(() => parseSummary(text(over))).toThrow(/not shaped as dry-run.ts writes it/);
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

describe('a production rollback runs newest first', () => {
  const recorded = ['20261102000002', '20261102000003', '20261103000001'];

  it('allows the newest recorded migration', () => {
    expect(rollbackOrderProblem('20261103000001', recorded)).toBeNull();
  });

  it('refuses an older one while a newer one is applied', () => {
    expect(rollbackOrderProblem('20261102000003', recorded)).toBe(
      '20261103000001 is newer than 20261102000003 and still applied: roll back newest first',
    );
  });

  it('refuses one production does not record', () => {
    expect(rollbackOrderProblem('20261104000001', recorded)).toMatch(/does not record/);
  });
});

describe('the fingerprint check after the owner approves', () => {
  it('passes when production is still what the plan read', () => {
    expect(driftProblems(PRODUCTION, { ...PRODUCTION }, 'the plan')).toEqual([]);
  });

  it('refuses when a section changed between the plan and the approval', () => {
    expect(
      driftProblems(PRODUCTION, { ...PRODUCTION, columns: 'e'.repeat(32) }, 'the plan'),
    ).toEqual(["production's columns section changed since the plan read it"]);
  });

  it('refuses when the plan recorded nothing', () => {
    expect(driftProblems({}, PRODUCTION, 'the plan')).toEqual([
      'the plan recorded no fingerprint of production',
    ]);
  });
});

describe('the production apply holds the lock across every check and the push', () => {
  const manifest = pending.map((f) => ({ file: f.file, sha256: f.sha256 }));

  function steps(over: Partial<ApplySteps> = {}) {
    const calls: string[] = [];
    const s: ApplySteps = {
      lock: async () => {
        calls.push('lock');
        return async () => {
          calls.push('release');
        };
      },
      pending: async () => (calls.push('pending'), pending),
      fingerprint: async () => (calls.push('fingerprint'), { ...PRODUCTION }),
      listed: async () => (calls.push('listed'), pending.map((f) => f.file)),
      push: async () => {
        calls.push('push');
      },
      ...over,
    };
    return { s, calls };
  }

  it('locks before it reads anything and releases after the push', async () => {
    const { s, calls } = steps();
    expect(await applyUnderLock(manifest, PRODUCTION, s)).toBe(true);
    expect(calls).toEqual(['lock', 'pending', 'fingerprint', 'listed', 'push', 'release']);
  });

  it('a rollback seen under the lock stops the push, and the lock is released', async () => {
    // The newest file was rolled back before the lock was taken: one more file is pending.
    const more = [...listMigrations().filter((f) => f.version === '20261101000001'), ...pending];
    const { s, calls } = steps({ pending: async () => (calls.push('pending'), more) });
    await expect(applyUnderLock(manifest, PRODUCTION, s)).rejects.toThrow(
      /not the approved manifest/,
    );
    expect(calls).toEqual(['lock', 'pending', 'release']);
  });

  it('production that changed since the plan stops the push', async () => {
    const { s, calls } = steps({
      fingerprint: async () => (calls.push('fingerprint'), { ...PRODUCTION, acls: 'f'.repeat(32) }),
    });
    await expect(applyUnderLock(manifest, PRODUCTION, s)).rejects.toThrow(/acls section changed/);
    expect(calls).not.toContain('push');
    expect(calls.at(-1)).toBe('release');
  });

  it('a failed release after a failed push reports the push failure, and logs the release', async () => {
    const logged: string[] = [];
    const { s: st } = steps({
      lock: async () => async () => {
        throw new Error('the lock was lost');
      },
      push: async () => {
        throw new Error('supabase db push exited with 1');
      },
    });
    await expect(applyUnderLock(manifest, PRODUCTION, st, (l) => logged.push(l))).rejects.toThrow(
      'supabase db push exited with 1',
    );
    expect(logged).toEqual(['releasing the lock also failed: Error: the lock was lost']);
  });

  it('a failed release after a successful push fails the apply', async () => {
    const { s: st } = steps({
      lock: async () => async () => {
        throw new Error('the advisory lock was not held at the end of the push');
      },
    });
    await expect(applyUnderLock(manifest, PRODUCTION, st)).rejects.toThrow(/was not held/);
  });
});
