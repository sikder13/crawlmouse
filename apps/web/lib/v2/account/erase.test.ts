import { describe, expect, it } from 'vitest';
import { hashMailAddress } from '../mail/address-hash';
import {
  MAIL_KEPT_KEY,
  MAIL_PEPPER_REFUSAL,
  MAIL_SENDS_KEY,
  erasePerson,
  planWithMail,
  type ErasurePlan,
  type ErasurePorts,
  type StorageObject,
} from './erase';

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

const PEPPER = 'a-test-pepper-of-at-least-32-chars';

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
    mailPepper: PEPPER,
    async mailRecords(hashes, apply) {
      calls.push(`mailRecords:${apply ? 'delete' : 'count'}:${hashes.length}`);
      return { email_sends: apply ? 2 : 0, email_suppressions_kept: 1 };
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
      'mailRecords:count:1',
      'removeStorage:1',
      'apply',
      'mailRecords:delete:1',
      'deleteAuthUser:u1',
      'sweepAuditLog',
      'recount',
      'mailRecords:count:1',
    ]);
    expect(result).toEqual({
      ok: true,
      before: {
        ...first,
        counts: { ...first.counts, [MAIL_SENDS_KEY]: 0 },
        kept: { [MAIL_KEPT_KEY]: 1 },
      },
      after: { counts: { 'accounts deleted': 0, [MAIL_SENDS_KEY]: 0 }, storage: [] },
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
    expect(calls).toEqual(['plan', 'mailRecords:count:1']);
  });

  it('tells the Storage refusal by its code, wherever it sits in the list (T3)', async () => {
    const storageFirst = plan({
      storage: objects,
      refusals: [`1 ${STORAGE_REFUSAL}`, 'account a1: other people are seated on it'],
      refusalCodes: ['storage', 'others_seated'],
    });
    const blocked = ports(storageFirst);
    expect((await erasePerson(blocked.p, { userId: 'u1' })).ok).toBe(false);
    expect(blocked.calls).toEqual(['plan', 'mailRecords:count:1']);
    // Storage objects listed, and a refusal that is not about them: it stops the erasure.
    const otherOnly = ports(
      plan({
        storage: objects,
        refusals: ['account a1: other people are seated on it'],
        refusalCodes: ['others_seated'],
      }),
    );
    expect((await erasePerson(otherOnly.p, { userId: 'u1' })).ok).toBe(false);
    expect(otherOnly.calls).toEqual(['plan', 'mailRecords:count:1']);
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
    expect(calls).toEqual(['plan', 'mailRecords:count:1']);
  });

  it('with no user, deletes no Auth user and sweeps nothing', async () => {
    const { p, calls } = ports(plan({ userId: null, accounts: [] }));
    await erasePerson(p, { email: 'a@example.com' });
    expect(calls).toEqual([
      'plan',
      'mailRecords:count:1',
      'apply',
      'mailRecords:delete:1',
      'recount',
      'mailRecords:count:1',
    ]);
  });

  it('an apply that throws stops before the Auth delete', async () => {
    const { p, calls } = ports(plan(), {
      async apply() {
        calls.push('apply');
        throw new Error('waitlist deleted: counted 1, changed 2; nothing was committed');
      },
    });
    await expect(erasePerson(p, { userId: 'u1' })).rejects.toThrow(/nothing was committed/);
    expect(calls).toEqual(['plan', 'mailRecords:count:1', 'apply']);
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
    expect(calls).toEqual([
      'plan',
      'mailRecords:count:1',
      'apply',
      'mailRecords:delete:1',
      'deleteAuthUser:u1',
    ]);
    calls.length = 0;
    const second = await erasePerson(p, { userId: 'u1' });
    expect(second.ok).toBe(true);
    expect(calls).toEqual([
      'plan',
      'mailRecords:count:1',
      'apply',
      'mailRecords:delete:1',
      'deleteAuthUser:u1',
      'sweepAuditLog',
      'recount',
      'mailRecords:count:1',
    ]);
  });
});

describe('the rows found by address hash (CC-28 D9)', () => {
  it('with no mail pepper the plan refuses, and nothing is counted, removed or applied', async () => {
    const { p, calls } = ports(
      plan({ storage: objects, refusals: ['1 x'], refusalCodes: ['storage'] }),
      {
        mailPepper: null,
      },
    );
    const result = await erasePerson(p, { userId: 'u1' });
    expect(result).toEqual({ ok: false, refusals: ['1 x', MAIL_PEPPER_REFUSAL] });
    expect(calls).toEqual(['plan']);
  });

  it('the plan carries the refusal by its own code, so the purge and the script both stop on it', async () => {
    const { p } = ports(plan(), { mailPepper: null });
    const planned = await planWithMail(p, { userId: 'u1' });
    expect(planned.refusalCodes).toEqual(['mail_pepper']);
    expect(planned.refusals).toEqual([MAIL_PEPPER_REFUSAL]);
  });

  it('hashes every address of the plan under the pepper, each mailbox once', async () => {
    const seen: string[][] = [];
    const { p } = ports(
      plan({ emails: ['a@example.com', 'b@example.com', 'A@example.com', 'a+news@example.com'] }),
      {
        async mailRecords(hashes) {
          seen.push([...hashes]);
          return { email_sends: 3, email_suppressions_kept: 2 };
        },
      },
    );
    const planned = await planWithMail(p, { userId: 'u1' });
    const a = hashMailAddress(PEPPER, 'a@example.com');
    const b = hashMailAddress(PEPPER, 'b@example.com');
    const news = hashMailAddress(PEPPER, 'a+news@example.com');
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    // `A@` is `a@` lower-cased; `a+news@` is an address of its own, hashed as written.
    expect(seen).toEqual([[a, b, news].sort()]);
    expect(planned.counts[MAIL_SENDS_KEY]).toBe(3);
    expect(planned.kept[MAIL_KEPT_KEY]).toBe(2);
  });

  it('deletes by the same hashes after the apply and before the Auth delete, and counts them again after', async () => {
    const asked: [string[], boolean][] = [];
    let left = 4;
    const { p, calls } = ports(plan(), {
      async mailRecords(hashes, apply) {
        calls.push(`mailRecords:${apply ? 'delete' : 'count'}:${hashes.length}`);
        asked.push([[...hashes], apply]);
        const n = left;
        if (apply) left = 0;
        return { email_sends: n, email_suppressions_kept: 1 };
      },
    });
    const result = await erasePerson(p, { userId: 'u1' });
    const h = [hashMailAddress(PEPPER, 'a@example.com')];
    expect(asked).toEqual([
      [h, false],
      [h, true],
      [h, false],
    ]);
    expect(calls.indexOf('mailRecords:delete:1')).toBe(calls.indexOf('apply') + 1);
    expect(calls.indexOf('deleteAuthUser:u1')).toBe(calls.indexOf('mailRecords:delete:1') + 1);
    expect(result.ok && result.before.counts[MAIL_SENDS_KEY]).toBe(4);
    expect(result.ok && result.after.counts[MAIL_SENDS_KEY]).toBe(0);
  });

  it('the apply is given the plan the SQL returned, without the hash counts', async () => {
    const first = plan();
    let expected: ErasurePlan | null = null;
    const { p } = ports(first, {
      async apply(_t, e) {
        expected = e;
      },
    });
    await erasePerson(p, { userId: 'u1' });
    expect(expected).toEqual(first);
  });
});
