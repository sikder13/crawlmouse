/**
 * The viewer (CC-26b D2): what the signed-in screens and routes know about the caller. Run on
 * PGlite with every migration applied, through the PostgREST stand-in as the caller
 * (`authenticated`, so row security and column grants apply) and as the service role.
 */
import { randomUUID } from 'node:crypto';
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GATES } from '../../entitlement-v2';
import { applyAllMigrations, freshDb } from '../../../__tests__/helpers/pglite-migrations';
import { postgrestOver } from '../../../__tests__/helpers/postgrest-pglite';
import { personalAccount, signUp } from '../../../__tests__/helpers/v2-check-tables';
import { readEntitlement, readViewer, type ViewerResult } from './viewer-read';

let db: PGlite;
const NOW = new Date('2026-11-10T12:00:00.000Z');

// Closed when the file ends: a PGlite holds its memory outside the JS heap until then.
afterAll(async () => {
  await db?.close();
});

beforeAll(async () => {
  db = await freshDb();
  await applyAllMigrations(db);
}, 300_000);

interface Person {
  userId: string;
  email: string;
}

async function person(tag: string): Promise<Person> {
  const email = `${tag}-${randomUUID().slice(0, 8)}@example.com`;
  return { userId: await signUp(db, email), email };
}

const read = (p: Person, now = NOW): Promise<ViewerResult> =>
  readViewer(
    {
      session: postgrestOver(db, { as: { userId: p.userId } }),
      admin: postgrestOver(db),
      now: () => now,
    },
    { id: p.userId, email: p.email },
  );

async function addSeat(
  accountId: string,
  p: Person,
  role: 'account_manager' | 'developer',
  status: 'active' | 'removed' = 'active',
): Promise<string> {
  const id = randomUUID();
  await db.query(
    `insert into public.seats (id, account_id, user_id, invited_email, role, status, accepted_at, removed_at)
     values ($1, $2, $3, $4, $5, $6, now(), case when $6 = 'removed' then now() end)`,
    [id, accountId, p.userId, p.email, role, status],
  );
  return id;
}

/** Every string the result holds, at any depth. */
function strings(v: unknown): string[] {
  if (typeof v === 'string') return [v];
  if (v instanceof Date) return [v.toISOString()];
  if (Array.isArray(v)) return v.flatMap(strings);
  if (v !== null && typeof v === 'object') return Object.values(v).flatMap(strings);
  return [];
}

describe('readViewer', () => {
  it('reads the owner of a new Free account: its account, owner seat, tier and limits', async () => {
    const owner = await person('owner');
    const { accountId, seatId } = await personalAccount(db, owner.userId);
    const r = await read(owner);
    expect(r.kind).toBe('viewer');
    if (r.kind !== 'viewer') return;
    expect(r.viewer.userId).toBe(owner.userId);
    expect(r.viewer.email).toBe(owner.email);
    expect(r.viewer.seat).toEqual({ id: seatId, role: 'owner', theme: 'system' });
    expect(r.viewer.account.id).toBe(accountId);
    expect(r.viewer.account.state).toBe('free');
    expect(r.viewer.tier).toBe('free');
    expect(r.viewer.gates).toBe(GATES.free);
    expect(r.viewer.limits).toEqual({ sites: 1, seats: 1, competitorsPerSite: 0 });
  });

  it('reads a developer member: the account they sit on, with their own seat and role', async () => {
    const owner = await person('owner');
    const dev = await person('dev');
    const { accountId } = await personalAccount(db, owner.userId);
    // The developer's sign-up made them an account of their own; take their seat on it away, so
    // the owner's account is the only one they sit on.
    const own = await personalAccount(db, dev.userId);
    await db.query(`update public.seats set status = 'removed', removed_at = now() where id = $1`, [
      own.seatId,
    ]);
    const seatId = await addSeat(accountId, dev, 'developer');
    const r = await read(dev);
    expect(r.kind).toBe('viewer');
    if (r.kind !== 'viewer') return;
    expect(r.viewer.account.id).toBe(accountId);
    expect(r.viewer.seat).toEqual({ id: seatId, role: 'developer', theme: 'system' });
  });

  it('a stranger sees no account and no string of another account, even with a forged default', async () => {
    const owner = await person('owner');
    const stranger = await person('stranger');
    const victim = await personalAccount(db, owner.userId);
    const theirs = await personalAccount(db, stranger.userId);
    await db.query(`update public.seats set status = 'removed', removed_at = now() where id = $1`, [
      theirs.seatId,
    ]);
    // A default pointing at an account they do not sit on (as a bad write could leave it).
    await db.query(`update public.users set default_account_id = $1 where id = $2`, [
      victim.accountId,
      stranger.userId,
    ]);
    const r = await read(stranger);
    expect(r).toEqual({ kind: 'no_account', userId: stranger.userId });
    const seen = strings(r);
    expect(seen).not.toContain(victim.accountId);
    expect(seen).not.toContain(victim.seatId);
    expect(seen).not.toContain(owner.email);
  });

  it('a removed seat gives no account', async () => {
    const owner = await person('owner');
    const { seatId } = await personalAccount(db, owner.userId);
    await db.query(`update public.seats set status = 'removed', removed_at = now() where id = $1`, [
      seatId,
    ]);
    expect(await read(owner)).toEqual({ kind: 'no_account', userId: owner.userId });
  });

  it('with two accounts, the default one is read; with no usable default, neither is guessed', async () => {
    const a = await person('a');
    const b = await person('b');
    const mine = await personalAccount(db, a.userId);
    const other = await personalAccount(db, b.userId);
    await addSeat(other.accountId, a, 'account_manager');

    const r = await read(a);
    expect(r.kind === 'viewer' && r.viewer.account.id).toBe(mine.accountId);

    await db.query(`update public.users set default_account_id = $1 where id = $2`, [
      other.accountId,
      a.userId,
    ]);
    const r2 = await read(a);
    expect(r2.kind === 'viewer' && r2.viewer.account.id).toBe(other.accountId);
    expect(r2.kind === 'viewer' && r2.viewer.seat.role).toBe('account_manager');

    await db.query(`update public.users set default_account_id = null where id = $1`, [a.userId]);
    expect(await read(a)).toEqual({ kind: 'ambiguous', userId: a.userId });
  });

  it('a no-card trial past its end reads as Free, with Free limits', async () => {
    const owner = await person('trial');
    const { accountId } = await personalAccount(db, owner.userId);
    const start = new Date(NOW.getTime() - 20 * 86_400_000);
    const end = new Date(start.getTime() + 14 * 86_400_000);
    await db.query(
      `update public.accounts set state = 'pro_trial', tier = 'pro', trial_variant = 'no_card',
         trial_ends_at = $2::timestamptz, trial_used_at = $3::timestamptz, site_limit = 5, seat_limit = 2, competitor_limit = 1,
         state_history = state_history || jsonb_build_array(jsonb_build_object('state', 'pro_trial', 'since', $3::text))
       where id = $1`,
      [accountId, end.toISOString(), start.toISOString()],
    );
    const during = await read(owner, new Date(start.getTime() + 86_400_000));
    expect(during.kind === 'viewer' && during.viewer.tier).toBe('pro');
    expect(during.kind === 'viewer' && during.viewer.limits).toEqual({
      sites: 5,
      seats: 2,
      competitorsPerSite: 1,
    });
    const after = await read(owner);
    expect(after.kind === 'viewer' && after.viewer.tier).toBe('free');
    expect(after.kind === 'viewer' && after.viewer.gates).toBe(GATES.free);
    expect(after.kind === 'viewer' && after.viewer.limits).toEqual({
      sites: 1,
      seats: 1,
      competitorsPerSite: 0,
    });
  });

  it('a deleted account gives no account', async () => {
    const owner = await person('gone');
    const { accountId } = await personalAccount(db, owner.userId);
    await db.query(`update public.accounts set deleted_at = now() where id = $1`, [accountId]);
    expect(await read(owner)).toEqual({ kind: 'no_account', userId: owner.userId });
  });
  it('with two seats, a forged default naming neither account is not followed', async () => {
    const a = await person('two');
    const b = await person('other');
    const c = await person('victim');
    const mine = await personalAccount(db, a.userId);
    const other = await personalAccount(db, b.userId);
    const victim = await personalAccount(db, c.userId);
    await addSeat(other.accountId, a, 'developer');
    await db.query(`update public.users set default_account_id = $1 where id = $2`, [
      victim.accountId,
      a.userId,
    ]);
    const r = await read(a);
    expect(r).toEqual({ kind: 'ambiguous', userId: a.userId });
    const seen = strings(r);
    expect(seen).not.toContain(victim.accountId);
    expect(seen).not.toContain(mine.accountId);
  });
});

describe('readEntitlement', () => {
  it("reads each account a user sits on at that account's own tier", async () => {
    const u = await person('both');
    const p = await person('pro-owner');
    const free = await personalAccount(db, u.userId);
    const pro = await personalAccount(db, p.userId);
    await db.query(
      `update public.accounts set state = 'pro', tier = 'pro', site_limit = 5, seat_limit = 2,
         competitor_limit = 1, current_subscription_id = 'sub_026b',
         state_history = state_history || jsonb_build_array(jsonb_build_object('state', 'pro', 'since', now()::text))
       where id = $1`,
      [pro.accountId],
    );
    await addSeat(pro.accountId, u, 'developer');
    const session = postgrestOver(db, { as: { userId: u.userId } });
    const onFree = await readEntitlement(session, free.accountId, NOW);
    const onPro = await readEntitlement(session, pro.accountId, NOW);
    expect(onFree?.tier).toBe('free');
    expect(onFree?.gates).toBe(GATES.free);
    expect(onPro?.tier).toBe('pro');
    expect(onPro?.gates).toBe(GATES.pro);
    expect(onPro?.limits).toEqual({ sites: 5, seats: 2, competitorsPerSite: 1 });
  });

  it('is null for an account the caller does not sit on', async () => {
    const u = await person('outsider');
    const o = await person('insider');
    await personalAccount(db, u.userId);
    const theirs = await personalAccount(db, o.userId);
    const session = postgrestOver(db, { as: { userId: u.userId } });
    expect(await readEntitlement(session, theirs.accountId, NOW)).toBeNull();
  });
});
