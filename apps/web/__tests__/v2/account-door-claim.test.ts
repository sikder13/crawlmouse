/**
 * The claim of an anonymous check (CC-25 D8) against every applied migration in PGlite.
 */
import type { PGlite } from '@electric-sql/pglite';
import { beforeEach, describe, expect, it } from 'vitest';
import { GATES } from '../../lib/entitlement-v2';
import { claimCheck, type ClaimDeps } from '../../lib/auth/claim';
import { scheduleFor } from '../../lib/auth/schedule';
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

let db: PGlite;
beforeEach(async () => {
  db = await doorDb();
}, 60_000);

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
