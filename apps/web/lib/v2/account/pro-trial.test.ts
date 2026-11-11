/**
 * The dashboard's trial start on the database (CC-26b D7): the door's decision through the door's
 * own stores, run on PGlite with every migration applied (the PostgREST stand-in as the caller and
 * as the service role). The route's guards are app/api/billing/pro-trial/start/route.test.ts's.
 */
import { randomUUID } from 'node:crypto';
import type { PGlite } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { applyAllMigrations, freshDb } from '../../../__tests__/helpers/pglite-migrations';
import { postgrestOver } from '../../../__tests__/helpers/postgrest-pglite';
import { personalAccount, signUp } from '../../../__tests__/helpers/v2-check-tables';
import type { FirstLoginDeps } from '../../auth/first-login';
import { supabaseDoorStore } from '../../auth/stores';
import { supabaseEntitlementStore } from '../../billing/state-machine-apply';
import { ownedAccount, startProTrial } from './pro-trial';

let db: PGlite;

beforeAll(async () => {
  db = await freshDb();
  await applyAllMigrations(db);
}, 300_000);

function deps(): FirstLoginDeps & { dispatch: ReturnType<typeof vi.fn> } {
  const admin = postgrestOver(db);
  return {
    store: supabaseDoorStore(admin),
    entitlement: supabaseEntitlementStore(admin),
    admit: async () => true,
    report: () => undefined,
    pepper: 'p'.repeat(40),
    now: () => new Date(),
    dispatch: vi.fn(async () => undefined),
  };
}

async function owner(tag: string) {
  const email = `${tag}-${randomUUID().slice(0, 8)}@example.com`;
  const userId = await signUp(db, email);
  const { accountId } = await personalAccount(db, userId);
  return { userId, email, accountId };
}

const start = async (
  o: { userId: string; email: string; accountId: string },
  d = deps(),
  device = randomUUID(),
  ip = `198.51.${Math.floor(Math.random() * 250)}.7`,
) => {
  const account = await ownedAccount(
    postgrestOver(db, { as: { userId: o.userId } }),
    o.accountId,
    o.userId,
  );
  if (!account) throw new Error('not the owner');
  return { answer: await startProTrial(d, account, { ...o, device, ip }), d };
};

describe('starting the Pro trial for a Free account', () => {
  it('starts it: the account is on its no-card trial, the ledger holds its rows, effects are sent', async () => {
    const o = await owner('start');
    const { answer, d } = await start(o);
    expect(answer).toEqual({ outcome: 'started', variant: 'no_card' });
    const { rows } = await db.query<{ state: string; trial_variant: string; used: boolean }>(
      `select state, trial_variant, trial_used_at is not null as used from public.accounts where id = $1`,
      [o.accountId],
    );
    expect(rows[0]).toEqual({ state: 'pro_trial', trial_variant: 'no_card', used: true });
    const { rows: ledger } = await db.query<{ kind: string }>(
      `select kind from public.trial_ledger where account_id = $1 order by kind`,
      [o.accountId],
    );
    expect(ledger.map((r) => r.kind)).toEqual(['device', 'email', 'ip24']);
    expect(d.dispatch).toHaveBeenCalledTimes(1);
  });

  it('a second start is not eligible, and changes nothing', async () => {
    const o = await owner('again');
    await start(o);
    const { answer, d } = await start(o);
    expect(answer).toMatchObject({ outcome: 'not_eligible', status: 409, error: 'not_eligible' });
    expect(d.dispatch).not.toHaveBeenCalled();
  });

  it('a device that already gave two trials this month is refused by the ledger', async () => {
    const device = randomUUID();
    await start(await owner('d1'), deps(), device);
    await start(await owner('d2'), deps(), device);
    const third = await owner('d3');
    const { answer, d } = await start(third, deps(), device);
    expect(answer).toMatchObject({ outcome: 'denied', status: 409, error: 'refused' });
    expect(d.dispatch).not.toHaveBeenCalled();
    const { rows } = await db.query<{ state: string }>(
      `select state from public.accounts where id = $1`,
      [third.accountId],
    );
    expect(rows[0]!.state).toBe('free');
  });
});

describe('ownedAccount', () => {
  it('is null for a member who is not the owner, and for a stranger', async () => {
    const o = await owner('own');
    const devId = await signUp(db, `dev-${randomUUID().slice(0, 8)}@example.com`);
    await db.query(
      `insert into public.seats (account_id, user_id, invited_email, role, status, accepted_at)
       values ($1, $2, 'dev@example.com', 'developer', 'active', now())`,
      [o.accountId, devId],
    );
    const stranger = await signUp(db, `x-${randomUUID().slice(0, 8)}@example.com`);
    const as = (userId: string) => postgrestOver(db, { as: { userId } });
    expect(await ownedAccount(as(o.userId), o.accountId, o.userId)).toMatchObject({
      accountId: o.accountId,
      state: 'free',
    });
    expect(await ownedAccount(as(devId), o.accountId, devId)).toBeNull();
    expect(await ownedAccount(as(stranger), o.accountId, stranger)).toBeNull();
  });
});
