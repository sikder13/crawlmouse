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
  toTransitionParams,
  type AccountRow,
  type EntitlementStore,
  type TransitionParams,
} from './state-machine-apply';
import { FREE_START, type EntitlementEvent } from './state-machine';

/**
 * applyEntitlementTransition against the real migration on PGlite: the database accepts what the
 * machine produces, writes it in one transaction, removes seats beyond the limit, bounds the history,
 * and refuses a write, or an ignore, decided on a stale read.
 */

const conflict = (err: unknown, accountId: string): never => {
  if ((err as { code?: string }).code === '40001') throw new EntitlementConflictError(accountId);
  throw err;
};

/** The same RPCs PostgREST would call, through PGlite with named arguments. */
function pgliteStore(db: PGlite): EntitlementStore {
  return {
    async load(accountId) {
      const { rows } = await db.query<AccountRow>(`select * from public.accounts where id = $1`, [
        accountId,
      ]);
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
        return conflict(err, params.p_account_id);
      }
    },
    async confirm(accountId, version) {
      try {
        await db.query(`select public.assert_entitlement_version($1, $2)`, [accountId, version]);
      } catch (err) {
        conflict(err, accountId);
      }
    },
  };
}

async function signUp(db: PGlite): Promise<string> {
  const id = randomUUID();
  await db.query(`insert into auth.users (id, email) values ($1, $2)`, [id, `${id}@example.com`]);
  const { rows } = await db.query<{ a: string }>(
    `select default_account_id as a from public.users where id = $1`,
    [id],
  );
  return rows[0]!.a;
}

async function row(db: PGlite, accountId: string): Promise<AccountRow> {
  return (await db.query<AccountRow>(`select * from public.accounts where id = $1`, [accountId]))
    .rows[0]!;
}

// After any wall-clock time this suite runs at, because handle_new_user stamps the first history entry
// with the database clock and history is ordered.
const T = Date.parse('2099-01-01T00:00:00.000Z');
const DAY = 86_400_000;
const at = (days: number) => new Date(T + days * DAY);

const checkout = (
  plan: 'pro' | 'agency',
  subscriptionId: string,
  when: Date,
  subscriptionStatus: 'active' | 'canceled' = 'active',
): EntitlementEvent => ({
  type: 'checkout_completed',
  at: when,
  plan,
  subscriptionId,
  subscriptionStatus,
  extras: { seats: 0, sites: 0 },
});
const active = (
  subscriptionId: string,
  plan: 'pro' | 'agency',
  when: Date,
  extras = { seats: 0, sites: 0 },
): EntitlementEvent => ({
  type: 'subscription_updated',
  at: when,
  subscriptionId,
  status: 'active',
  plan,
  cancelAtPeriodEnd: false,
  extras,
});

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
    const result = await applyEntitlementTransition(store, account, {
      type: 'trial_started',
      at: at(0),
      variant: 'no_card',
    });
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
      // A no-card trial starts on our clock, which does not move the last change.
      entitlement_changed_at: r.entitlement_changed_at,
      entitlement_version: r.entitlement_version,
    }).toEqual({
      state: 'pro_trial',
      tier: 'pro',
      seat_limit: 2,
      site_limit: 5,
      competitor_limit: 1,
      trial_variant: 'no_card',
      trial_ends_at: '2099-01-15T00:00:00.000Z',
      entitlement_changed_at: null,
      entitlement_version: 1,
    });
    expect(r.state_history.map((h) => h.state)).toEqual(['free', 'pro_trial']);
    expect(r.state_history[1]!.since).toBe('2099-01-01T00:00:00.000Z');
  });

  it('returns the site effects separately, for the caller to apply until migration 003', async () => {
    const account = await signUp(db);
    await applyEntitlementTransition(store, account, {
      type: 'trial_started',
      at: at(0),
      variant: 'no_card',
    });
    const expired = await applyEntitlementTransition(store, account, {
      type: 'trial_expired',
      at: at(14),
    });
    expect(expired.siteEffects).toEqual(['pause_others']);
    expect((await row(db, account)).state).toBe('free');
  });

  it('writes nothing for an ignored event', async () => {
    const account = await signUp(db);
    const before = await row(db, account);
    const result = await applyEntitlementTransition(store, account, {
      type: 'recorded_only',
      at: at(1),
      stripeType: 'invoice.paid',
    });
    expect(result.transition.outcome).toBe('ignored');
    expect(result.version).toBe(0);
    expect(await row(db, account)).toEqual(before);
  });

  it('writes nothing for an applied event that changes nothing, and still returns its effects', async () => {
    const account = await signUp(db);
    await applyEntitlementTransition(store, account, {
      type: 'trial_started',
      at: at(0),
      variant: 'no_card',
    });
    const before = await row(db, account);
    const reminder = await applyEntitlementTransition(store, account, {
      type: 'trial_reminder_due',
      at: at(11),
    });
    expect(reminder.transition.effects).toEqual([{ kind: 'email', template: 'trial_reminder' }]);
    expect(reminder.version).toBe(1);
    expect(await row(db, account)).toEqual(before);
  });

  it('refuses a commit based on a stale read, and changes nothing', async () => {
    const account = await signUp(db);
    const stale = (await store.load(account))!;
    await applyEntitlementTransition(store, account, checkout('pro', 'sub_A', at(1)));
    const before = await row(db, account);
    const racing: EntitlementStore = { ...store, load: async () => stale };
    await expect(
      applyEntitlementTransition(racing, account, checkout('agency', 'sub_B', at(1))),
    ).rejects.toBeInstanceOf(EntitlementConflictError);
    expect(await row(db, account)).toEqual(before);
  });

  it('refuses an ignore decided on a stale read, so a racing revoke is retried, not dropped', async () => {
    // The deletion is read while the account is still Free (so it would be ignored), and the
    // checkout for the same subscription commits in between.
    const account = await signUp(db);
    const stale = (await store.load(account))!;
    await applyEntitlementTransition(store, account, checkout('pro', 'sub_A', at(1)));
    const racing: EntitlementStore = { ...store, load: async () => stale };
    const deletion: EntitlementEvent = {
      type: 'subscription_deleted',
      at: at(2),
      subscriptionId: 'sub_A',
    };
    await expect(applyEntitlementTransition(racing, account, deletion)).rejects.toBeInstanceOf(
      EntitlementConflictError,
    );
    // The retry reads the current account and applies it.
    await applyEntitlementTransition(store, account, deletion);
    expect((await row(db, account)).state).toBe('free');
  });

  it('a delayed deletion of a cancelled subscription leaves a re-subscribed customer on the plan', async () => {
    const account = await signUp(db);
    const steps: EntitlementEvent[] = [
      checkout('pro', 'sub_A', at(1)),
      {
        type: 'subscription_updated',
        at: at(10),
        subscriptionId: 'sub_A',
        status: 'canceled',
        plan: 'pro',
        cancelAtPeriodEnd: false,
        extras: { seats: 0, sites: 0 },
      },
      checkout('pro', 'sub_B', at(11)),
      active('sub_B', 'pro', at(11)),
      { type: 'subscription_deleted', at: at(10), subscriptionId: 'sub_A' },
    ];
    for (const e of steps) await applyEntitlementTransition(store, account, e);
    const r = await row(db, account);
    expect({ state: r.state, tier: r.tier, sub: r.current_subscription_id }).toEqual({
      state: 'pro',
      tier: 'pro',
      sub: 'sub_B',
    });
  });

  it('a checkout delivered after its own subscription ended grants nothing', async () => {
    // The deletion arrives first and is ignored (the account does not follow sub_X yet); the
    // retried checkout then carries the subscription's live status, which is canceled.
    const account = await signUp(db);
    await applyEntitlementTransition(store, account, {
      type: 'subscription_deleted',
      at: at(1),
      subscriptionId: 'sub_X',
    });
    await applyEntitlementTransition(
      store,
      account,
      checkout('agency', 'sub_X', at(0), 'canceled'),
    );
    const r = await row(db, account);
    expect({ state: r.state, sub: r.current_subscription_id }).toEqual({
      state: 'free',
      sub: null,
    });
  });

  it('the version check refuses a null version instead of reporting a retryable conflict', async () => {
    const account = await signUp(db);
    await expect(
      db.query(`select public.assert_entitlement_version($1, null)`, [account]),
    ).rejects.toMatchObject({ code: '22004' });
  });

  it('writes the time mark of a revoke that changes nothing else', async () => {
    const account = await signUp(db);
    await applyEntitlementTransition(store, account, checkout('pro', 'sub_A', at(0)));
    const failure = (day: number): EntitlementEvent => ({
      type: 'invoice_payment_failed',
      at: at(day),
      subscriptionId: 'sub_A',
    });
    await applyEntitlementTransition(store, account, failure(1));
    const marked = await applyEntitlementTransition(store, account, failure(3));
    const r = await row(db, account);
    expect(marked.version).toBe(3);
    expect({
      state: r.state,
      since: new Date(r.past_due_since!).toISOString(),
      changed: new Date(r.entitlement_changed_at!).toISOString(),
    }).toEqual({ state: 'past_due', since: at(1).toISOString(), changed: at(3).toISOString() });
  });

  it('throws for an account that does not exist', async () => {
    await expect(
      applyEntitlementTransition(store, randomUUID(), { type: 'trial_expired', at: at(1) }),
    ).rejects.toThrow(/not found/);
  });

  const params = (account: string, over: Partial<TransitionParams> = {}): TransitionParams => ({
    ...toTransitionParams(
      account,
      0,
      { ...FREE_START, state: 'pro', tier: 'pro', subscriptionId: 'sub_A', lastChangeAt: at(1) },
      at(1),
    ),
    ...over,
  });

  it('is one transaction: a write the CHECKs refuse leaves the account and its seats as they were', async () => {
    const account = await signUp(db);
    const before = await row(db, account);
    await expect(store.commit(params(account, { p_tier: 'free' }))).rejects.toMatchObject({
      code: '23514',
    });
    expect(await row(db, account)).toEqual(before);
  });

  it('refuses a null version or a null time instead of skipping the check', async () => {
    const account = await signUp(db);
    await expect(
      store.commit(params(account, { p_expected_version: null as unknown as number })),
    ).rejects.toMatchObject({ code: '22004' });
    await expect(
      store.commit(params(account, { p_at: null as unknown as string })),
    ).rejects.toMatchObject({ code: '22004' });
    expect((await row(db, account)).entitlement_version).toBe(0);
  });

  it('never clears trial_used_at or disputed_at, whatever the caller sends', async () => {
    const account = await signUp(db);
    await applyEntitlementTransition(store, account, {
      type: 'trial_started',
      at: at(0),
      variant: 'no_card',
    });
    await applyEntitlementTransition(store, account, { type: 'dispute_created', at: at(1) });
    const marked = await row(db, account);
    await store.commit({
      ...params(account, { p_expected_version: marked.entitlement_version }),
      p_trial_used_at: null,
      p_disputed_at: null,
    });
    const r = await row(db, account);
    expect(r.trial_used_at).toEqual(marked.trial_used_at);
    expect(r.disputed_at).toEqual(marked.disputed_at);
  });

  it('never moves entitlement_changed_at backwards, whatever the caller sends', async () => {
    const account = await signUp(db);
    await applyEntitlementTransition(store, account, checkout('pro', 'sub_A', at(5)));
    await store.commit({
      ...params(account, { p_expected_version: 1 }),
      p_changed_at: at(1).toISOString(),
    });
    expect(new Date((await row(db, account)).entitlement_changed_at!).toISOString()).toBe(
      at(5).toISOString(),
    );
  });

  it('removes the newest non-owner seats beyond the new seat limit, never the owner', async () => {
    const account = await signUp(db);
    await applyEntitlementTransition(store, account, checkout('agency', 'sub_A', at(1)));
    await applyEntitlementTransition(
      store,
      account,
      active('sub_A', 'agency', at(2), { seats: 2, sites: 0 }),
    );
    // Owner plus six members, accepted one day apart: seven active seats, the limit is 5 + 2.
    const members: string[] = [];
    for (let i = 0; i < 6; i++) {
      const user = randomUUID();
      await db.query(`insert into public.users (id, email) values ($1, $2)`, [
        user,
        `${user}@example.com`,
      ]);
      await db.query(
        `insert into public.seats (account_id, user_id, invited_email, role, status, accepted_at)
         values ($1, $2, $3, 'developer', 'active', $4)`,
        [account, user, `${user}@example.com`, at(3 + i).toISOString()],
      );
      members.push(user);
    }
    await applyEntitlementTransition(store, account, active('sub_A', 'pro', at(10)));
    const { rows } = await db.query<{
      user_id: string;
      role: string;
      status: string;
      removed_at: Date | null;
    }>(`select user_id, role, status, removed_at from public.seats where account_id = $1`, [
      account,
    ]);
    const activeSeats = rows.filter((r) => r.status === 'active');
    expect(activeSeats.map((r) => r.role).sort()).toEqual(['developer', 'owner']);
    expect(activeSeats.find((r) => r.role === 'developer')!.user_id).toBe(members[0]); // the oldest member stays
    const removed = rows.filter((r) => r.status === 'removed').map((r) => r.user_id);
    expect(removed.sort()).toEqual(members.slice(1).sort());
    for (const r of rows.filter((x) => x.status === 'removed'))
      expect(r.removed_at!.toISOString()).toBe(at(10).toISOString());
  });

  it('appends no history entry when the state does not change', async () => {
    const account = await signUp(db);
    await applyEntitlementTransition(store, account, checkout('agency', 'sub_A', at(1)));
    const before = (await row(db, account)).state_history.length;
    await applyEntitlementTransition(
      store,
      account,
      active('sub_A', 'agency', at(2), { seats: 3, sites: 0 }),
    );
    const r = await row(db, account);
    expect(r.seat_limit).toBe(8); // the transition was written
    expect(r.state_history).toHaveLength(before);
  });

  it('keeps the latest 200 history entries, in strictly increasing time, within the contract', async () => {
    const account = await signUp(db);
    await applyEntitlementTransition(store, account, checkout('pro', 'sub_A', at(0)));
    // pro → past_due → pro, 110 times: 220 state changes after the first two entries.
    for (let i = 0; i < 110; i++) {
      await applyEntitlementTransition(store, account, {
        type: 'invoice_payment_failed',
        at: new Date(T + DAY + i * 2000),
        subscriptionId: 'sub_A',
      });
      await applyEntitlementTransition(
        store,
        account,
        active('sub_A', 'pro', new Date(T + DAY + i * 2000 + 1000)),
      );
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
    await applyEntitlementTransition(store, account, checkout('pro', 'sub_A', at(0)));
    await applyEntitlementTransition(store, account, {
      type: 'invoice_payment_failed',
      at: at(0),
      subscriptionId: 'sub_A',
    });
    const history = (await row(db, account)).state_history;
    const [, paid, failed] = history;
    expect(instant(failed!.since)).toBeGreaterThan(instant(paid!.since));
  });
});

describe('the database accepts every snapshot the machine reaches, and returns it unchanged', () => {
  const STATUSES = ['active', 'past_due', 'canceled', 'unpaid', 'trialing', 'paused'] as const;
  const sub = fc.constantFrom('sub_A', 'sub_B');
  const plan = fc.constantFrom('pro' as const, 'agency' as const);
  const draft: fc.Arbitrary<(at: Date) => EntitlementEvent> = fc.oneof(
    fc.constant((t: Date) => ({ type: 'trial_started', at: t, variant: 'no_card' }) as const),
    sub.map(
      (id) => (t: Date) =>
        ({
          type: 'trial_started',
          at: t,
          variant: 'card_required',
          trialEnd: new Date(t.getTime() + 14 * DAY),
          subscriptionId: id,
          subscriptionStatus: 'trialing',
        }) as const,
    ),
    sub.map(
      (id) => (t: Date) =>
        ({
          type: 'agency_trial_started',
          at: t,
          trialEnd: new Date(t.getTime() + 14 * DAY),
          subscriptionId: id,
          subscriptionStatus: 'trialing',
        }) as const,
    ),
    fc.constant((t: Date) => ({ type: 'trial_expired', at: t }) as const),
    fc.tuple(plan, sub).map(
      ([p, id]) =>
        (t: Date) =>
          checkout(p, id, t),
    ),
    fc
      .tuple(
        fc.constantFrom(...STATUSES),
        plan,
        fc.integer({ min: 0, max: 10 }),
        fc.integer({ min: 0, max: 25 }),
        sub,
      )
      .map(
        ([status, p, seats, sites, id]) =>
          (t: Date) =>
            ({
              type: 'subscription_updated',
              at: t,
              subscriptionId: id,
              status,
              plan: p,
              cancelAtPeriodEnd: false,
              extras: p === 'agency' ? { seats, sites } : { seats: 0, sites: 0 },
            }) as const,
      ),
    sub.map(
      (id) => (t: Date) => ({ type: 'invoice_payment_failed', at: t, subscriptionId: id }) as const,
    ),
    fc.constant((t: Date) => ({ type: 'past_due_lapsed', at: t }) as const),
    fc.constant((t: Date) => ({ type: 'dispute_created', at: t }) as const),
    sub.map(
      (id) => (t: Date) => ({ type: 'subscription_deleted', at: t, subscriptionId: id }) as const,
    ),
  );

  it('for generated sequences of up to 12 events', async () => {
    const db = await freshDb();
    await applyAllMigrations(db);
    const store = pgliteStore(db);
    let applied = 0;
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.tuple(draft, fc.integer({ min: -1, max: 15 })), { maxLength: 12 }),
        async (steps) => {
          const account = await signUp(db);
          let day = 0;
          for (const [make, gap] of steps) {
            day += gap;
            const result = await applyEntitlementTransition(store, account, make(at(day)));
            if (result.transition.outcome === 'applied') applied++;
            expect((await store.load(account))!.snapshot).toEqual(result.transition.state);
          }
        },
      ),
      { numRuns: 40 },
    );
    expect(applied, 'no generated event was ever applied').toBeGreaterThan(0);
  }, 300_000);
});

describe('supabaseEntitlementStore', () => {
  it('reads the account by id and calls the RPCs with the parameters it was given', async () => {
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
      rpc: async (fn: string, args: unknown) => {
        calls.push(['rpc', fn, args]);
        return { data: 7, error: null };
      },
    };
    const store = supabaseEntitlementStore(fake as never);
    expect(await store.load('acc')).toBeNull();
    const commitParams = { p_account_id: 'acc' } as TransitionParams;
    expect(await store.commit(commitParams)).toBe(7);
    await store.confirm('acc', 3);
    expect(calls).toEqual([
      ['select', 'accounts', expect.stringContaining('current_subscription_id'), 'id', 'acc'],
      ['rpc', 'apply_entitlement_transition', commitParams],
      ['rpc', 'assert_entitlement_version', { p_account_id: 'acc', p_expected_version: 3 }],
    ]);
  });

  it('turns a version conflict into EntitlementConflictError and rethrows anything else', async () => {
    const failing = (code: string) =>
      supabaseEntitlementStore({
        rpc: async () => ({ data: null, error: { code, message: 'x' } }),
      } as never);
    await expect(
      failing('40001').commit({ p_account_id: 'a' } as TransitionParams),
    ).rejects.toBeInstanceOf(EntitlementConflictError);
    await expect(failing('40001').confirm('a', 1)).rejects.toBeInstanceOf(EntitlementConflictError);
    await expect(
      failing('23514').commit({ p_account_id: 'a' } as TransitionParams),
    ).rejects.not.toBeInstanceOf(EntitlementConflictError);
    await expect(failing('P0002').confirm('a', 1)).rejects.not.toBeInstanceOf(
      EntitlementConflictError,
    );
  });
});

describe('snapshotFromRow', () => {
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
    current_subscription_id: 'sub_A',
    entitlement_changed_at: '2099-01-01T00:00:00.000Z',
    state_history: [],
  } as unknown as AccountRow;

  it('derives Agency extras from the written limits', () => {
    expect(snapshotFromRow(agencyRow).snapshot).toMatchObject({
      extras: { seats: 3, sites: 5 },
      subscriptionId: 'sub_A',
      lastChangeAt: new Date('2099-01-01T00:00:00.000Z'),
    });
  });

  it('refuses limits that match no plan', () => {
    expect(() =>
      snapshotFromRow({ ...agencyRow, tier: 'pro', state: 'pro' } as AccountRow),
    ).toThrow(/limits/);
    expect(() => snapshotFromRow({ ...agencyRow, competitor_limit: 1 })).toThrow(/limits/);
    expect(() => snapshotFromRow({ ...agencyRow, seat_limit: 4 })).toThrow(/limits/);
  });
});
