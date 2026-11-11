import { describe, expect, it } from 'vitest';
import { erasePerson, type ErasurePlan, type ErasurePorts, type StorageObject } from './erase';

/** The sequencer over fake ports: the order of calls, and what it does when a step fails. */

const STORAGE_REFUSAL = 'storage objects are still stored';

function plan(over: Partial<ErasurePlan> = {}): ErasurePlan {
  return {
    userId: 'u1',
    emails: ['a@example.com'],
    accounts: ['acc1'],
    refusals: [],
    refusalCodes: [],
    counts: { 'accounts deleted': 1 },
    kept: {},
    storage: [],
    mintedReports: [],
    ...over,
  };
}

const objects: StorageObject[] = [{ bucket: 'evidence', name: 'acc1/x.json' }];

function ports(first: ErasurePlan, overrides: Partial<ErasurePorts> = {}) {
  const calls: string[] = [];
  const p: ErasurePorts = {
    async plan() {
      calls.push('plan');
      return first;
    },
    async apply() {
      calls.push('apply');
    },
    async removeStorage(o) {
      calls.push(`removeStorage:${o.length}`);
    },
    async deleteAuthUser(id) {
      calls.push(`deleteAuthUser:${id}`);
    },
    async sweepAuditLog() {
      calls.push('sweepAuditLog');
    },
    async recount() {
      calls.push('recount');
      return { counts: { 'accounts deleted': 0 }, storage: [] };
    },
    ...overrides,
  };
  return { p, calls };
}

describe('erasePerson', () => {
  it('runs plan, storage, apply, the Auth delete, the sweep and the read-back, in that order', async () => {
    const first = plan({
      storage: objects,
      refusals: [`1 ${STORAGE_REFUSAL}`],
      refusalCodes: ['storage'],
    });
    const { p, calls } = ports(first);
    const result = await erasePerson(p, { userId: 'u1' });
    expect(calls).toEqual([
      'plan',
      'removeStorage:1',
      'apply',
      'deleteAuthUser:u1',
      'sweepAuditLog',
      'recount',
    ]);
    expect(result).toEqual({
      ok: true,
      before: first,
      after: { counts: { 'accounts deleted': 0 }, storage: [] },
    });
  });

  it('a refusal other than storage removes no object and changes nothing', async () => {
    const first = plan({
      storage: objects,
      refusals: ['subscription sub_1 is live; cancel it in Stripe first', `1 ${STORAGE_REFUSAL}`],
      refusalCodes: ['live_subscription', 'storage'],
    });
    const { p, calls } = ports(first);
    expect(await erasePerson(p, { userId: 'u1' })).toEqual({
      ok: false,
      refusals: first.refusals,
    });
    expect(calls).toEqual(['plan']);
  });

  it('tells the Storage refusal by its code, wherever it sits in the list (T3)', async () => {
    const storageFirst = plan({
      storage: objects,
      refusals: [`1 ${STORAGE_REFUSAL}`, 'account a1: other people are seated on it'],
      refusalCodes: ['storage', 'others_seated'],
    });
    const blocked = ports(storageFirst);
    expect((await erasePerson(blocked.p, { userId: 'u1' })).ok).toBe(false);
    expect(blocked.calls).toEqual(['plan']);
    // Storage objects listed, and a refusal that is not about them: it stops the erasure.
    const otherOnly = ports(
      plan({
        storage: objects,
        refusals: ['account a1: other people are seated on it'],
        refusalCodes: ['others_seated'],
      }),
    );
    expect((await erasePerson(otherOnly.p, { userId: 'u1' })).ok).toBe(false);
    expect(otherOnly.calls).toEqual(['plan']);
    const onlyStorage = ports(
      plan({ storage: objects, refusals: [`1 ${STORAGE_REFUSAL}`], refusalCodes: ['storage'] }),
    );
    expect((await erasePerson(onlyStorage.p, { userId: 'u1' })).ok).toBe(true);
    expect(onlyStorage.calls).toContain('removeStorage:1');
  });

  it('a refusal with no storage listed stops it too', async () => {
    const { p, calls } = ports(
      plan({ refusals: ['users.pro_until is in the future'], refusalCodes: ['v1_subscription'] }),
    );
    expect((await erasePerson(p, { userId: 'u1' })).ok).toBe(false);
    expect(calls).toEqual(['plan']);
  });

  it('with no user, deletes no Auth user and sweeps nothing', async () => {
    const { p, calls } = ports(plan({ userId: null, accounts: [] }));
    await erasePerson(p, { email: 'a@example.com' });
    expect(calls).toEqual(['plan', 'apply', 'recount']);
  });

  it('an apply that throws stops before the Auth delete', async () => {
    const { p, calls } = ports(plan(), {
      async apply() {
        calls.push('apply');
        throw new Error('waitlist deleted: counted 1, changed 2; nothing was committed');
      },
    });
    await expect(erasePerson(p, { userId: 'u1' })).rejects.toThrow(/nothing was committed/);
    expect(calls).toEqual(['plan', 'apply']);
  });

  it('the Auth port throws once, and a second call finishes', async () => {
    let failures = 1;
    const { p, calls } = ports(plan(), {
      async deleteAuthUser(id) {
        calls.push(`deleteAuthUser:${id}`);
        if (failures-- > 0) throw new Error('Auth admin delete failed: HTTP 503');
      },
    });
    await expect(erasePerson(p, { userId: 'u1' })).rejects.toThrow(/HTTP 503/);
    expect(calls).toEqual(['plan', 'apply', 'deleteAuthUser:u1']);
    calls.length = 0;
    const second = await erasePerson(p, { userId: 'u1' });
    expect(second.ok).toBe(true);
    expect(calls).toEqual(['plan', 'apply', 'deleteAuthUser:u1', 'sweepAuditLog', 'recount']);
  });
});
