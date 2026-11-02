import { randomUUID } from 'node:crypto';
import type { PGlite } from '@electric-sql/pglite';
import { AccountSchema, instant } from '@crawlmouse/types/v2';
import fc from 'fast-check';
import { beforeAll, describe, expect, it } from 'vitest';
import { applyAllMigrations, freshDb } from '../../__tests__/helpers/pglite-migrations';
import {
  EntitlementConflictError,
  applyEntitlementTransition,
  snapshotFromRow,
  supabaseEntitlementStore,
  type AccountRow,
  type EntitlementStore,
  type TransitionParams,
} from './state-machine-apply';
import { FREE_START, next, type EntitlementEvent } from './state-machine';

/**
 * applyEntitlementTransition against the real migration on PGlite: the database accepts what the
 * machine produces, writes it in one transaction, removes seats beyond the limit, bounds the history,
 * and refuses a write based on a stale read.
 */

/** The same RPC PostgREST would call, through PGlite with named arguments. */
function pgliteStore(db: PGlite): EntitlementStore {
  return {
    async load(accountId) {
      const { rows } = await db.query<AccountRow>(`select * from public.accounts where id = $1`, [accountId]);
      return rows[0] ? snapshotFromRow(rows[0]) : null;
    },
    async commit(params: TransitionParams) {
      const keys = Object.keys(params) as (keyof TransitionParams)[];
      const args = keys.map((k, i) => `${k} => $${i + 1}`).join(', ');
      try {
        const { rows } = await db.query<{ v: number }>(
          `select public.apply_entitlement_transition(${args}) as v`,
          keys.map((k) => params[k]),
        );
        return rows[0]!.v;
      } catch (err) {
        if ((err as { code?: string }).code === '40001') throw new EntitlementConflictError(params.p_account_id);
        throw err;
      }
    },
  };
}

async function signUp(db: PGlite): Promise<string> {
  const id = randomUUID();
  await db.query(`insert into auth.users (id, email) values ($1, $2)`, [id, `${id}@example.com`]);
  const { rows } = await db.query<{ a: string }>(`select default_account_id as a from public.users where id = $1`, [id]);
  return rows[0]!.a;
}

async function row(db: PGlite, accountId: string): Promise<AccountRow> {
  return (await db.query<AccountRow>(`select * from public.accounts where id = $1`, [accountId])).rows[0]!;
}

// After any wall-clock time this suite runs at, because handle_new_user stamps the first history entry
// with the database clock and history is ordered.
const T = Date.parse('2099-01-01T00:00:00.000Z');
const DAY = 86_400_000;
const at = (days: number) => new Date(T + days * DAY);

describe('applyEntitlementTransition on the real schema', () => {
  let db: PGlite;
  let store: EntitlementStore;
  beforeAll(async () => {
    db = await freshDb();
    await applyAllMigrations(db);
    store = pgliteStore(db);
  }, 120_000);

  it('starts from the snapshot handle_new_user creates', async () => {
    const account = await signUp(db);
    expect(await store.load(account)).toEqual({ version: 0, snapshot: FREE_START });
  });

  it('writes a trial: state, tier, limits, trial fields, one more history entry and the version', async () => {
    const account = await signUp(db);
    const result = await applyEntitlementTransition(store, account, { type: 'trial_started', at: at(0), variant: 'no_card' });
    expect(result.transition.outcome).toBe('applied');
    expect(result.version).toBe(1);
    const r = await row(db, account);
    expect({
      state: r.state,
      tier: r.tier,
      seat_limit: r.seat_limit,
      site_limit: r.site_limit,
      competitor_limit: r.competitor_limit,
      trial_variant: r.trial_variant,
      trial_ends_at: new Date(r.trial_ends_at!).toISOString(),
      entitlement_version: r.entitlement_version,
    }).toEqual({
      state: 'pro_trial',
      tier: 'pro',
      seat_limit: 2,
      site_limit: 5,
      competitor_limit: 1,
      trial_variant: 'no_card',
      trial_ends_at: '2099-01-15T00:00:00.000Z',
      entitlement_version: 1,
    });
    expect(r.state_history.map((h) => h.state)).toEqual(['free', 'pro_trial']);
    expect(r.state_history[1]!.since).toBe('2099-01-01T00:00:00.000Z');
  });

  it('returns the site effects separately, for the caller to apply until migration 003', async () => {
    const account = await signUp(db);
    await applyEntitlementTransition(store, account, { type: 'trial_started', at: at(0), variant: 'no_card' });
    const expired = await applyEntitlementTransition(store, account, { type: 'trial_expired', at: at(14) });
    expect(expired.siteEffects).toEqual(['pause_others']);
    expect((await row(db, account)).state).toBe('free');
  });

  it('writes nothing for an ignored event', async () => {
    const account = await signUp(db);
    const before = await row(db, account);
    const result = await applyEntitlementTransition(store, account, { type: 'invoice_paid', at: at(1) });
    expect(result.transition.outcome).toBe('ignored');
    expect(result.version).toBe(0);
    expect(await row(db, account)).toEqual(before);
  });

  it('refuses a commit based on a stale read, and changes nothing', async () => {
    const account = await signUp(db);
    const stale = (await store.load(account))!;
    await applyEntitlementTransition(store, account, { type: 'checkout_completed', at: at(1), plan: 'pro' });
    const before = await row(db, account);
    const racing: EntitlementStore = { load: async () => stale, commit: store.commit };
    await expect(
      applyEntitlementTransition(racing, account, { type: 'checkout_completed', at: at(1), plan: 'agency' }),
    ).rejects.toBeInstanceOf(EntitlementConflictError);
    expect(await row(db, account)).toEqual(before);
  });

  it('throws for an account that does not exist', async () => {
    await expect(
      applyEntitlementTransition(store, randomUUID(), { type: 'invoice_paid', at: at(1) }),
    ).rejects.toThrow(/not found/);
  });

  it('is one transaction: a write the CHECKs refuse leaves the account and its seats as they were', async () => {
    const account = await signUp(db);
    const before = await row(db, account);
    const bad: TransitionParams = {
      p_account_id: account,
      p_expected_version: 0,
      p_state: 'pro',
      p_tier: 'free', // does not match the state
      p_past_due_tier: null,
      p_past_due_since: null,
      p_trial_variant: null,
      p_trial_ends_at: null,
      p_trial_used_at: null,
      p_disputed_at: null,
      p_seat_limit: 1,
      p_site_limit: 1,
      p_competitor_limit: 0,
      p_at: at(1).toISOString(),
    };
    await expect(store.commit(bad)).rejects.toMatchObject({ code: '23514' });
    expect(await row(db, account)).toEqual(before);
  });

  it('removes the newest non-owner seats beyond the new seat limit, never the owner', async () => {
    const account = await signUp(db);
    await applyEntitlementTransition(store, account, { type: 'checkout_completed', at: at(1), plan: 'agency' });
    await applyEntitlementTransition(store, account, {
      type: 'subscription_updated',
      at: at(2),
      status: 'active',
      plan: 'agency',
      cancelAtPeriodEnd: false,
      extras: { seats: 2, sites: 0 },
    });
    // Owner plus six members, accepted one day apart: seven active seats, the limit is 5 + 2.
    const members: string[] = [];
    for (let i = 0; i < 6; i++) {
      const user = randomUUID();
      await db.query(`insert into public.users (id, email) values ($1, $2)`, [user, `${user}@example.com`]);
      await db.query(
        `insert into public.seats (account_id, user_id, invited_email, role, status, accepted_at)
         values ($1, $2, $3, 'developer', 'active', $4)`,
        [account, user, `${user}@example.com`, at(3 + i).toISOString()],
      );
      members.push(user);
    }
    await applyEntitlementTransition(store, account, {
      type: 'subscription_updated',
      at: at(10),
      status: 'active',
      plan: 'pro',
      cancelAtPeriodEnd: false,
      extras: { seats: 0, sites: 0 },
    });
    const { rows } = await db.query<{ user_id: string; role: string; status: string; removed_at: Date | null }>(
      `select user_id, role, status, removed_at from public.seats where account_id = $1`,
      [account],
    );
    const active = rows.filter((r) => r.status === 'active');
    expect(active.map((r) => r.role).sort()).toEqual(['developer', 'owner']);
    expect(active.find((r) => r.role === 'developer')!.user_id).toBe(members[0]); // the oldest member stays
    const removed = rows.filter((r) => r.status === 'removed').map((r) => r.user_id);
    expect(removed.sort()).toEqual(members.slice(1).sort());
    for (const r of rows.filter((x) => x.status === 'removed')) expect(r.removed_at!.toISOString()).toBe(at(10).toISOString());
  });

  it('keeps the latest 200 history entries, in strictly increasing time, within the contract', async () => {
    const account = await signUp(db);
    await applyEntitlementTransition(store, account, { type: 'checkout_completed', at: at(0), plan: 'pro' });
    // pro → past_due → pro, 110 times: 220 state changes after the first two entries.
    for (let i = 0; i < 110; i++) {
      await applyEntitlementTransition(store, account, { type: 'invoice_payment_failed', at: new Date(T + DAY + i * 2000) });
      await applyEntitlementTransition(store, account, { type: 'invoice_paid', at: new Date(T + DAY + i * 2000 + 1000) });
    }
    const history = (await row(db, account)).state_history;
    expect(history).toHaveLength(200);
    expect(history[history.length - 1]!.state).toBe('pro');
    expect(AccountSchema.shape.state_history.safeParse(history).success).toBe(true);
    for (let i = 1; i < history.length; i++) {
      expect(instant(history[i]!.since)).toBeGreaterThan(instant(history[i - 1]!.since));
    }
  }, 120_000);

  it('separates two transitions stamped with the same instant, so history stays strictly increasing', async () => {
    const account = await signUp(db);
    await applyEntitlementTransition(store, account, { type: 'checkout_completed', at: at(0), plan: 'pro' });
    await applyEntitlementTransition(store, account, { type: 'invoice_payment_failed', at: at(0) });
    const history = (await row(db, account)).state_history;
    const [, paid, failed] = history;
    expect(instant(failed!.since)).toBeGreaterThan(instant(paid!.since));
  });
});

describe('the database accepts every snapshot the machine reaches, and returns it unchanged', () => {
  const STATUSES = ['active', 'past_due', 'canceled', 'unpaid', 'trialing'] as const;
  const draft: fc.Arbitrary<(at: Date) => EntitlementEvent> = fc.oneof(
    fc.constant((t: Date) => ({ type: 'trial_started', at: t, variant: 'no_card' }) as const),
    fc.constant((t: Date) => ({ type: 'trial_started', at: t, variant: 'card_required', trialEnd: new Date(t.getTime() + 14 * DAY) }) as const),
    fc.constant((t: Date) => ({ type: 'agency_trial_started', at: t, trialEnd: new Date(t.getTime() + 14 * DAY) }) as const),
    fc.constant((t: Date) => ({ type: 'trial_expired', at: t }) as const),
    fc.constantFrom('pro' as const, 'agency' as const).map((plan) => (t: Date) => ({ type: 'checkout_completed', at: t, plan }) as const),
    fc
      .tuple(fc.constantFrom(...STATUSES), fc.constantFrom('pro' as const, 'agency' as const), fc.integer({ min: 0, max: 10 }), fc.integer({ min: 0, max: 25 }))
      .map(([status, plan, seats, sites]) => (t: Date) =>
        ({
          type: 'subscription_updated',
          at: t,
          status,
          plan,
          cancelAtPeriodEnd: false,
          extras: plan === 'agency' ? { seats, sites } : { seats: 0, sites: 0 },
        }) as const,
      ),
    fc.constant((t: Date) => ({ type: 'invoice_payment_failed', at: t }) as const),
    fc.constant((t: Date) => ({ type: 'invoice_paid', at: t }) as const),
    fc.constant((t: Date) => ({ type: 'past_due_lapsed', at: t }) as const),
    fc.constant((t: Date) => ({ type: 'dispute_created', at: t }) as const),
    fc.constant((t: Date) => ({ type: 'subscription_deleted', at: t }) as const),
  );

  it('for generated sequences of up to 12 events', async () => {
    const db = await freshDb();
    await applyAllMigrations(db);
    const store = pgliteStore(db);
    let applied = 0;
    await fc.assert(
      fc.asyncProperty(fc.array(fc.tuple(draft, fc.integer({ min: 0, max: 15 })), { maxLength: 12 }), async (steps) => {
        const account = await signUp(db);
        let day = 0;
        for (const [make, gap] of steps) {
          day += gap;
          const result = await applyEntitlementTransition(store, account, make(at(day)));
          if (result.transition.outcome === 'applied') applied++;
          expect((await store.load(account))!.snapshot).toEqual(result.transition.state);
        }
      }),
      { numRuns: 40 },
    );
    expect(applied, 'no generated event was ever applied').toBeGreaterThan(0);
  }, 300_000);
});

describe('supabaseEntitlementStore', () => {
  it('reads the account by id and calls the RPC with the parameters it was given', async () => {
    const calls: unknown[] = [];
    const fake = {
      from: (table: string) => ({
        select: (cols: string) => ({
          eq: (col: string, value: string) => ({
            maybeSingle: async () => {
              calls.push(['select', table, cols, col, value]);
              return { data: null, error: null };
            },
          }),
        }),
      }),
      rpc: async (fn: string, params: unknown) => {
        calls.push(['rpc', fn, params]);
        return { data: 7, error: null };
      },
    };
    const store = supabaseEntitlementStore(fake as never);
    expect(await store.load('acc')).toBeNull();
    const params = { p_account_id: 'acc' } as TransitionParams;
    expect(await store.commit(params)).toBe(7);
    expect(calls).toEqual([
      ['select', 'accounts', expect.stringContaining('entitlement_version'), 'id', 'acc'],
      ['rpc', 'apply_entitlement_transition', params],
    ]);
  });

  it('turns a version conflict into EntitlementConflictError and rethrows anything else', async () => {
    const failing = (code: string) =>
      supabaseEntitlementStore({ rpc: async () => ({ data: null, error: { code, message: 'x' } }) } as never);
    await expect(failing('40001').commit({ p_account_id: 'a' } as TransitionParams)).rejects.toBeInstanceOf(
      EntitlementConflictError,
    );
    await expect(failing('23514').commit({ p_account_id: 'a' } as TransitionParams)).rejects.not.toBeInstanceOf(
      EntitlementConflictError,
    );
  });
});

describe('snapshotFromRow', () => {
  it('derives Agency extras from the written limits, and refuses limits that match no plan', () => {
    const base = (next(FREE_START, { type: 'checkout_completed', at: at(0), plan: 'agency' }).state);
    expect(base.extras).toEqual({ seats: 0, sites: 0 });
    const agencyRow = {
      state: 'agency',
      tier: 'agency',
      trial_variant: null,
      trial_ends_at: null,
      trial_used_at: null,
      past_due_tier: null,
      past_due_since: null,
      disputed_at: null,
      seat_limit: 8,
      site_limit: 30,
      competitor_limit: 3,
      entitlement_version: 4,
      state_history: [],
    } as unknown as AccountRow;
    expect(snapshotFromRow(agencyRow).snapshot.extras).toEqual({ seats: 3, sites: 5 });
    expect(() => snapshotFromRow({ ...agencyRow, tier: 'pro', state: 'pro' } as AccountRow)).toThrow(/limits/);
  });
});
