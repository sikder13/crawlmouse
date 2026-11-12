/**
 * The claim of an anonymous check (CC-25 D8) against every applied migration in PGlite.
 */
import type { PGlite } from '@electric-sql/pglite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GATES } from '../../lib/entitlement-v2';
import { claimCheck, type ClaimDeps } from '../../lib/auth/claim';
import type { DoorStore } from '../../lib/auth/door-store';
import { scheduleFor } from '../../lib/auth/schedule';
import { firstAuditId, firstAuditRequester } from '../../lib/v2/pipeline/first-audit';
import { claimKeep } from '../../lib/v2/pipeline/keep';
import { memoryEvidenceStore } from '../../lib/v2/pipeline/test-support/memory-evidence';
import { sqlKeepStore } from '../../lib/v2/pipeline/test-support/sql-keep-store';
import { sqlPipelineStore } from '../../lib/v2/pipeline/test-support/sql-store';
import {
  asService,
  storedCheck,
  storedPaths,
} from '../../lib/v2/pipeline/test-support/stored-check';
import {
  accountOf,
  anonymousCheck,
  count,
  doorDb,
  pgliteDoorStore,
  signUp,
} from './_lib/door-pglite';

const NOW = new Date('2026-11-05T12:00:00.000Z');
const LATER = new Date('2026-11-06T12:00:00.000Z');
/** A day from the real clock, for accounts whose tier is read at the real time. */
const LATER_REAL = () => new Date(Date.now() + 24 * 60 * 60 * 1000);

let db: PGlite;
beforeEach(async () => {
  db = await doorDb();
}, 60_000);
afterEach(async () => {
  await db?.close();
});

const deps = (): ClaimDeps => ({ store: pgliteDoorStore(db), now: () => NOW });

async function site(siteId: string) {
  const { rows } = await db.query<Record<string, unknown>>(
    `select account_id, owner_seat_id, schedule_cadence, schedule_iso_weekday, schedule_hour_local
       from public.sites where id = $1`,
    [siteId],
  );
  return rows[0]!;
}

/** The account on a no-card Pro trial ending at `endsAt`, as `apply_entitlement_transition` writes one. */
async function asProTrial(accountId: string, endsAt: Date) {
  await db.query(
    `update public.accounts set state = 'pro_trial', tier = 'pro', trial_variant = 'no_card',
            trial_ends_at = $2, trial_used_at = $3, site_limit = 5, seat_limit = 2, competitor_limit = 1,
            state_history = state_history || jsonb_build_array(jsonb_build_object('state','pro_trial','since','2026-10-20T00:00:00.000Z'))
      where id = $1`,
    [accountId, endsAt, new Date('2026-10-21T00:00:00Z')],
  );
}

async function ownerSeat(accountId: string) {
  const { rows } = await db.query<{ id: string }>(
    `select id from public.seats where account_id = $1 and role = 'owner'`,
    [accountId],
  );
  return rows[0]!.id;
}

describe('claimCheck', () => {
  it('takes an unowned site for the caller, clears the check expiry, and schedules it for the tier', async () => {
    const user = await signUp(db, 'keeper@example.com');
    const { checkId, siteId } = await anonymousCheck(db, 'example-outfitter.com', LATER);
    const r = await claimCheck(deps(), { checkId, userId: user });
    expect(r).toEqual({ ok: true, siteId });
    const a = await accountOf(db, user);
    const s = await site(siteId);
    const expected = scheduleFor('free', true, NOW, 'UTC')!;
    expect(s).toEqual({
      account_id: a.id,
      owner_seat_id: await ownerSeat(a.id),
      schedule_cadence: expected.cadence,
      schedule_iso_weekday: expected.iso_weekday,
      schedule_hour_local: expected.hour_local,
    });
    expect(GATES.free.schedule).toBe('monthly_first_site_only');
    expect(s.schedule_cadence).toBe('monthly');
    expect(
      await count(db, `select 1 from public.checks where id = $1 and expires_at is null`, [
        checkId,
      ]),
    ).toBe(1);
  });

  it('a second claim of the same check is a 409', async () => {
    const user = await signUp(db, 'twice@example.com');
    const { checkId } = await anonymousCheck(db, 'twice.example.com', LATER);
    expect((await claimCheck(deps(), { checkId, userId: user })).ok).toBe(true);
    expect(await claimCheck(deps(), { checkId, userId: user })).toEqual({
      ok: false,
      status: 409,
      code: 'already_claimed',
    });
  });

  it("a check of another account's site is a 404: the id is a capability, not a resource to confirm", async () => {
    const owner = await signUp(db, 'owner@example.com');
    const other = await signUp(db, 'other@example.com');
    const { checkId } = await anonymousCheck(db, 'owned.example.com', LATER);
    await claimCheck(deps(), { checkId, userId: owner });
    expect(await claimCheck(deps(), { checkId, userId: other })).toEqual({
      ok: false,
      status: 404,
      code: 'not_found',
    });
  });

  it('an unknown check is a 404', async () => {
    const user = await signUp(db, 'nobody@example.com');
    expect(
      await claimCheck(deps(), { checkId: '00000000-0000-4000-8000-000000000000', userId: user }),
    ).toEqual({ ok: false, status: 404, code: 'not_found' });
  });

  it('a check whose site the account already owns is a 409', async () => {
    const user = await signUp(db, 'mine@example.com');
    const a = await accountOf(db, user);
    const { checkId, siteId } = await anonymousCheck(db, 'mine.example.com', null);
    await db.query(`update public.sites set account_id = $2 where id = $1`, [siteId, a.id]);
    expect(await claimCheck(deps(), { checkId, userId: user })).toEqual({
      ok: false,
      status: 409,
      code: 'already_claimed',
    });
  });

  it('a half-finished claim (site taken, expiry still set) is completed, not refused', async () => {
    const user = await signUp(db, 'half@example.com');
    const a = await accountOf(db, user);
    const { checkId, siteId } = await anonymousCheck(db, 'half.example.com', LATER);
    await db.query(`update public.sites set account_id = $2 where id = $1`, [siteId, a.id]);
    expect(await claimCheck(deps(), { checkId, userId: user })).toEqual({ ok: true, siteId });
    expect(
      await count(db, `select 1 from public.checks where id = $1 and expires_at is null`, [
        checkId,
      ]),
    ).toBe(1);
  });

  it('an expired check is a 410', async () => {
    const user = await signUp(db, 'late@example.com');
    const { checkId } = await anonymousCheck(db, 'late.example.com', NOW);
    expect(await claimCheck(deps(), { checkId, userId: user })).toEqual({
      ok: false,
      status: 410,
      code: 'expired',
    });
  });

  it('a host the account already keeps is a 409 host_kept, and leaves the anonymous site alone', async () => {
    const user = await signUp(db, 'dupe@example.com');
    const first = await anonymousCheck(db, 'dupe.example.com', LATER);
    expect((await claimCheck(deps(), { checkId: first.checkId, userId: user })).ok).toBe(true);
    // Free keeps one site; a Pro trial gives room, so the host rule, not the limit, decides.
    await asProTrial((await accountOf(db, user)).id, LATER);
    const second = await anonymousCheck(db, 'dupe.example.com', LATER);
    expect(await claimCheck(deps(), { checkId: second.checkId, userId: user })).toEqual({
      ok: false,
      status: 409,
      code: 'host_kept',
    });
    expect((await site(second.siteId)).account_id).toBeNull();
  });

  it('an account at its site limit is a 409 site_limit', async () => {
    const user = await signUp(db, 'full@example.com');
    const one = await anonymousCheck(db, 'one.example.com', LATER);
    const two = await anonymousCheck(db, 'two.example.com', LATER);
    expect((await claimCheck(deps(), { checkId: one.checkId, userId: user })).ok).toBe(true);
    expect(await claimCheck(deps(), { checkId: two.checkId, userId: user })).toEqual({
      ok: false,
      status: 409,
      code: 'site_limit',
    });
  });

  it('a user with no v2 account is a 409 no_account', async () => {
    const user = await signUp(db, 'v1@example.com');
    await db.query(`update public.users set default_account_id = null where id = $1`, [user]);
    const { checkId } = await anonymousCheck(db, 'v1.example.com', LATER);
    expect(await claimCheck(deps(), { checkId, userId: user })).toEqual({
      ok: false,
      status: 409,
      code: 'no_account',
    });
  });

  it('an account marked for deletion is a 409 no_account, and its site stays unowned (spec 27b)', async () => {
    const user = await signUp(db, 'leaving@example.com');
    const a = await accountOf(db, user);
    await db.query(
      `update public.accounts set deletion_confirmed_at = $2, purge_after = $2::timestamptz + interval '7 days'
        where id = $1`,
      [a.id, NOW],
    );
    const { checkId, siteId } = await anonymousCheck(db, 'leaving.example.com', LATER);
    expect(await claimCheck(deps(), { checkId, userId: user })).toEqual({
      ok: false,
      status: 409,
      code: 'no_account',
    });
    expect((await site(siteId)).account_id).toBeNull();
  });

  it('an expired no-card trial claims as Free: one site, whatever its stored limit', async () => {
    const user = await signUp(db, 'lapsed@example.com');
    const a = await accountOf(db, user);
    await asProTrial(a.id, new Date('2026-11-04T00:00:00Z'));
    const one = await anonymousCheck(db, 'one.lapsed.com', LATER);
    const two = await anonymousCheck(db, 'two.lapsed.com', LATER);
    expect((await claimCheck(deps(), { checkId: one.checkId, userId: user })).ok).toBe(true);
    expect(await claimCheck(deps(), { checkId: two.checkId, userId: user })).toEqual({
      ok: false,
      status: 409,
      code: 'site_limit',
    });
    expect((await site(one.siteId)).schedule_cadence).toBe('monthly');
  });

  it('a half-finished claim is finished even after the check would have expired: the site was taken first', async () => {
    const user = await signUp(db, 'halfgone@example.com');
    const a = await accountOf(db, user);
    const { checkId, siteId } = await anonymousCheck(db, 'halfgone.example.com', NOW);
    await db.query(`update public.sites set account_id = $2 where id = $1`, [siteId, a.id]);
    expect(await claimCheck(deps(), { checkId, userId: user })).toEqual({ ok: true, siteId });
    expect(
      await count(db, `select 1 from public.checks where id = $1 and expires_at is null`, [
        checkId,
      ]),
    ).toBe(1);
  });

  it('a Pro trial account gets the weekly schedule', async () => {
    const user = await signUp(db, 'trial@example.com');
    const a = await accountOf(db, user);
    await asProTrial(a.id, LATER);
    const { checkId, siteId } = await anonymousCheck(db, 'weekly.example.com', LATER);
    expect((await claimCheck(deps(), { checkId, userId: user })).ok).toBe(true);
    expect((await site(siteId)).schedule_cadence).toBe('weekly');
  });
});

/** `store`, recording the name of each method called. */
function recording(store: DoorStore): { store: DoorStore; calls: string[] } {
  const calls: string[] = [];
  const wrapped = Object.fromEntries(
    Object.entries(store).map(([name, fn]) => [
      name,
      (...args: unknown[]) => {
        calls.push(name);
        return (fn as (...a: unknown[]) => unknown)(...args);
      },
    ]),
  ) as unknown as DoorStore;
  return { store: wrapped, calls };
}

describe('claimCheck without keep (V2_CHECKS_PUBLIC unset): the two writes, as before CC-22b', () => {
  it('reads the check and the member, counts the sites, takes the site, clears the expiry', async () => {
    const user = await signUp(db, 'pinned@example.com');
    const { checkId, siteId } = await anonymousCheck(db, 'pinned.example.com', LATER);
    const { store, calls } = recording(pgliteDoorStore(db));
    expect(await claimCheck({ store, now: () => NOW }, { checkId, userId: user })).toEqual({
      ok: true,
      siteId,
    });
    expect(calls).toEqual([
      'loadCheck',
      'loadMember',
      'countActiveSites',
      'takeSite',
      'clearExpiry',
    ]);
  });
});

describe('claimCheck with keep (V2_CHECKS_PUBLIC=1): one transaction, with the evidence move', () => {
  // keep_check reads the database's clock, so these checks expire relative to the real one.
  const SOON = () => new Date(Date.now() + 60 * 60 * 1000);
  const evidence = () => memoryEvidenceStore();

  function keepDeps(memory = evidence(), over: Partial<ClaimDeps> = {}) {
    const { store, calls } = recording(pgliteDoorStore(db));
    const reported: string[] = [];
    const report: ClaimDeps['report'] = (signal) => void reported.push(signal);
    const deps: ClaimDeps = {
      store,
      now: () => new Date(),
      keep: claimKeep({ store: sqlKeepStore(asService(db)), evidence: memory, report }),
      report,
      ...over,
    };
    return { deps, calls, reported, memory };
  }

  it('takes the site with its owner seat and schedule, clears the expiry and moves the evidence, without takeSite or clearExpiry', async () => {
    const user = await signUp(db, 'keeps@example.com');
    const { deps, calls, memory } = keepDeps();
    const check = await storedCheck(db, memory, { host: 'keeps.example.com', expiresAt: SOON() });
    expect(await claimCheck(deps, { checkId: check.checkId, userId: user })).toEqual({
      ok: true,
      siteId: check.siteId,
    });
    expect(calls).toEqual(['loadCheck', 'loadMember', 'countActiveSites']);
    const a = await accountOf(db, user);
    const expected = scheduleFor('free', true, new Date(), 'UTC')!;
    expect(await site(check.siteId)).toEqual({
      account_id: a.id,
      owner_seat_id: await ownerSeat(a.id),
      schedule_cadence: expected.cadence,
      schedule_iso_weekday: expected.iso_weekday,
      schedule_hour_local: expected.hour_local,
    });
    expect(
      await count(db, `select 1 from public.checks where id = $1 and expires_at is null`, [
        check.checkId,
      ]),
    ).toBe(1);
    const stored = await storedPaths(db, check.checkId);
    expect(stored).toHaveLength(3);
    for (const path of stored) {
      expect(path.startsWith(`${a.id}/${check.siteId}/${check.checkId}/`), path).toBe(true);
      expect(memory.objects.has(path), path).toBe(true);
    }
    expect([...memory.objects.keys()].filter((k) => k.startsWith('anon/'))).toEqual([]);
    expect(
      await count(db, `select 1 from public.sites where id = $1 and updated_at > created_at`, [
        check.siteId,
      ]),
    ).toBe(1);
  });

  it('a second claim of the same check is a 409 already_claimed', async () => {
    const user = await signUp(db, 'keeps-twice@example.com');
    const { deps, memory } = keepDeps();
    const check = await storedCheck(db, memory, { host: 'twice.example.com', expiresAt: SOON() });
    expect((await claimCheck(deps, { checkId: check.checkId, userId: user })).ok).toBe(true);
    expect(await claimCheck(deps, { checkId: check.checkId, userId: user })).toEqual({
      ok: false,
      status: 409,
      code: 'already_claimed',
    });
  });

  it('a check the database’s clock says has expired is a 410, though the caller’s clock does not: nothing is written and no copy stays', async () => {
    const user = await signUp(db, 'late-db@example.com');
    const memory = evidence();
    const check = await storedCheck(db, memory, {
      host: 'late-db.example.com',
      expiresAt: new Date(Date.now() - 1000),
    });
    // The caller's clock is an hour slow: the claim's own test passes.
    const { deps } = keepDeps(memory, { now: () => new Date(Date.now() - 60 * 60 * 1000) });
    const before = [...memory.objects.keys()].sort();
    expect(await claimCheck(deps, { checkId: check.checkId, userId: user })).toEqual({
      ok: false,
      status: 410,
      code: 'expired',
    });
    expect((await site(check.siteId)).account_id).toBeNull();
    expect([...memory.objects.keys()].sort()).toEqual(before);
    expect(
      await count(db, `select 1 from public.checks where id = $1 and expires_at is not null`, [
        check.checkId,
      ]),
    ).toBe(1);
  });

  it('a host the account already keeps is refused before any object is read or copied', async () => {
    const user = await signUp(db, 'keeps-dupe@example.com');
    const memory = evidence();
    const { deps } = keepDeps(memory);
    const first = await storedCheck(db, memory, { host: 'dupe.example.com', expiresAt: SOON() });
    expect((await claimCheck(deps, { checkId: first.checkId, userId: user })).ok).toBe(true);
    await asProTrial((await accountOf(db, user)).id, LATER_REAL());
    const second = await storedCheck(db, memory, { host: 'dupe.example.com', expiresAt: SOON() });
    const touched: string[] = [];
    const watched = {
      ...memory,
      list: async (dir: string) => (touched.push('list'), memory.list(dir)),
      get: async (path: string) => (touched.push('get'), memory.get(path)),
      put: async (path: string, bytes: Uint8Array) => (
        touched.push('put'),
        memory.put(path, bytes)
      ),
    };
    expect(
      await claimCheck(keepDeps(watched).deps, { checkId: second.checkId, userId: user }),
    ).toEqual({ ok: false, status: 409, code: 'host_kept' });
    expect(touched).toEqual([]);
    expect((await site(second.siteId)).account_id).toBeNull();
  });

  it('an account at its site limit is refused before any object is read or copied', async () => {
    const user = await signUp(db, 'keeps-full@example.com');
    const memory = evidence();
    const { deps } = keepDeps(memory);
    const one = await storedCheck(db, memory, { host: 'one.keeps.example', expiresAt: SOON() });
    const two = await storedCheck(db, memory, { host: 'two.keeps.example', expiresAt: SOON() });
    expect((await claimCheck(deps, { checkId: one.checkId, userId: user })).ok).toBe(true);
    const before = new Map(memory.objects);
    expect(await claimCheck(deps, { checkId: two.checkId, userId: user })).toEqual({
      ok: false,
      status: 409,
      code: 'site_limit',
    });
    expect(memory.objects).toEqual(before);
  });

  it('a half-finished claim from before the flag (site taken, expiry still set) is still completed', async () => {
    const user = await signUp(db, 'keeps-half@example.com');
    const a = await accountOf(db, user);
    const { deps, calls } = keepDeps();
    const { checkId, siteId } = await anonymousCheck(db, 'keeps-half.example.com', NOW);
    await db.query(`update public.sites set account_id = $2 where id = $1`, [siteId, a.id]);
    expect(await claimCheck(deps, { checkId, userId: user })).toEqual({ ok: true, siteId });
    expect(calls).toEqual(['loadCheck', 'loadMember', 'clearExpiry']);
    expect(
      await count(db, `select 1 from public.checks where id = $1 and expires_at is null`, [
        checkId,
      ]),
    ).toBe(1);
  });

  describe('the first audit of the kept site', () => {
    function withFirstAudit(memory = evidence()) {
      const sent: { id: string }[] = [];
      const firstAudit = firstAuditRequester({
        request: {
          store: sqlPipelineStore(db),
          send: async (event) => void sent.push(event),
          now: Date.now,
        },
        hasLiveOrGradedCheck: (siteId) => sqlKeepStore(asService(db)).hasLiveOrGradedCheck(siteId),
        limits: { global: async () => true, domain: async () => true },
        paused: () => false,
      });
      return { ...keepDeps(memory, { firstAudit }), sent };
    }
    const checks = async (siteId: string) =>
      (
        await db.query<{ id: string; status: string }>(
          `select id, status from public.checks where site_id = $1 order by status`,
          [siteId],
        )
      ).rows;

    it('a claimed check that failed: the site gets one first audit', async () => {
      const user = await signUp(db, 'keeps-failed@example.com');
      const { deps, memory, sent } = withFirstAudit();
      const check = await storedCheck(db, memory, {
        host: 'failed.keeps.example',
        expiresAt: SOON(),
        status: 'failed',
      });
      expect((await claimCheck(deps, { checkId: check.checkId, userId: user })).ok).toBe(true);
      expect(await checks(check.siteId)).toEqual([
        { id: check.checkId, status: 'failed' },
        { id: firstAuditId(check.siteId), status: 'queued' },
      ]);
      expect(sent).toHaveLength(1);
    });

    it('a claimed check that is waiting or has run: no second check', async () => {
      const user = await signUp(db, 'keeps-live@example.com');
      await asProTrial((await accountOf(db, user)).id, LATER_REAL());
      for (const status of ['queued', 'running'] as const) {
        const { deps, memory, sent } = withFirstAudit();
        const check = await storedCheck(db, memory, {
          host: `${status}.keeps.example`,
          expiresAt: SOON(),
          status,
        });
        expect((await claimCheck(deps, { checkId: check.checkId, userId: user })).ok).toBe(true);
        expect(await checks(check.siteId)).toEqual([{ id: check.checkId, status }]);
        expect(sent).toEqual([]);
      }
    });

    it('a first audit that throws is reported and the claim stands', async () => {
      const user = await signUp(db, 'keeps-throws@example.com');
      const memory = evidence();
      const { deps, reported } = keepDeps(memory, {
        firstAudit: async () => {
          throw new Error('inngest unavailable');
        },
      });
      const check = await storedCheck(db, memory, {
        host: 'throws.keeps.example',
        expiresAt: SOON(),
      });
      expect(await claimCheck(deps, { checkId: check.checkId, userId: user })).toEqual({
        ok: true,
        siteId: check.siteId,
      });
      expect(reported).toEqual(['first-audit-failed']);
      expect((await site(check.siteId)).account_id).toBe((await accountOf(db, user)).id);
    });

    it('a refused claim requests none', async () => {
      const user = await signUp(db, 'keeps-refused@example.com');
      const { deps, memory, sent } = withFirstAudit();
      const check = await storedCheck(db, memory, {
        host: 'refused.keeps.example',
        expiresAt: new Date(Date.now() - 1000),
      });
      expect((await claimCheck(deps, { checkId: check.checkId, userId: user })).ok).toBe(false);
      expect(sent).toEqual([]);
    });
  });
});
