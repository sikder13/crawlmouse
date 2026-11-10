/**
 * Our clock (CC-03 D9) against every migration on PGlite: the events the machine takes from us,
 * applied to accounts the machine itself put in a trial or past due; the sweep's narrowing read run
 * through the same PostgREST calls production makes; and the two Inngest functions driven over the
 * app's clock, with the effects captured where they would be sent.
 */
import type { PGlite } from '@electric-sql/pglite';
import type { SupabaseClient } from '@supabase/supabase-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPastDueSweepFn } from '../../../../inngest/past-due-sweep';
import { createTrialLifecycleFn } from '../../../../inngest/trial-lifecycle';
import { asRole } from '../../__tests__/helpers/pglite-migrations';
import { doorDb, pgliteEntitlementStore } from '../../__tests__/v2/_lib/door-pglite';
import {
  applyClockEvent,
  billingClock,
  supabaseSweepReads,
  sweepCandidates,
  type ClockDeps,
  type SweepReads,
} from './clock';
import type { EffectSinks, InngestSend } from './effects';
import { applyEntitlementTransition, type EntitlementStore } from './state-machine-apply';
import type { EntitlementEvent } from './state-machine';

const DAY = 86_400_000;
// After any wall-clock time this suite runs at: the account's first history entry is the database's now().
const T = Date.parse('2099-01-01T00:00:00.000Z');
const at = (ms: number) => new Date(T + ms);
const TRIAL_END = '2099-01-15T00:00:00.000Z';
const REMINDER_AT = '2099-01-12T00:00:00.000Z';
const PAST_DUE_SINCE = '2099-01-02T00:00:00.000Z';
const GRACE_ENDS = Date.parse('2099-01-09T00:00:00.000Z');

let db: PGlite;
let store: EntitlementStore;
beforeEach(async () => {
  db = await doorDb();
  store = pgliteEntitlementStore(db);
}, 60_000);
afterEach(async () => {
  await db?.close();
});

async function newAccount(): Promise<string> {
  // Two statements: the sign-up trigger's rows are not visible to the statement that fires it.
  const user = await db.query<{ id: string }>(
    `insert into auth.users (id, email) values (gen_random_uuid(), gen_random_uuid() || '@example.com')
     returning id`,
  );
  const { rows } = await db.query<{ a: string }>(
    `select default_account_id as a from public.users where id = $1`,
    [user.rows[0]!.id],
  );
  return rows[0]!.a;
}

async function apply(accountId: string, ...events: EntitlementEvent[]): Promise<void> {
  for (const e of events) {
    const r = await applyEntitlementTransition(store, accountId, e);
    if (r.transition.outcome !== 'applied') throw new Error(`setup event ${e.type} was ignored`);
  }
}

const checkout = (subscriptionId: string, when: Date): EntitlementEvent => ({
  type: 'checkout_completed',
  at: when,
  plan: 'pro',
  subscriptionId,
  subscriptionStatus: 'active',
  extras: { seats: 0, sites: 0 },
});

/** A no-card Pro trial the machine started at T: it ends at TRIAL_END. */
async function noCardTrial(): Promise<string> {
  const id = await newAccount();
  await apply(id, { type: 'trial_started', at: at(0), variant: 'no_card' });
  return id;
}

/** A Pro account whose invoice failed at `since`. */
async function pastDue(since = new Date(PAST_DUE_SINCE)) {
  const id = await newAccount();
  const subscriptionId = `sub_${id.replaceAll('-', '')}`;
  await apply(id, checkout(subscriptionId, at(0)), {
    type: 'invoice_payment_failed',
    at: since,
    subscriptionId,
  });
  return id;
}

async function stateOf(accountId: string) {
  const { rows } = await db.query<{ state: string; tier: string; v: number }>(
    `select state, tier, entitlement_version as v from public.accounts where id = $1`,
    [accountId],
  );
  return rows[0]!;
}

/** The PostgREST calls `supabaseSweepReads` makes, run as SQL on PGlite as the service role. */
function postgrestOver(pg: PGlite): SupabaseClient {
  const ident = (s: string) => {
    if (!/^[a-z_]+$/.test(s)) throw new Error(`not an identifier: ${s}`);
    return s;
  };
  return {
    from(table: string) {
      const where: string[] = [];
      const params: unknown[] = [];
      const order: string[] = [];
      let columns = '*';
      let limit: number | null = null;
      const filter = (op: string) => (column: string, value: unknown) => {
        params.push(value);
        where.push(`${ident(column)} ${op} $${params.length}`);
        return builder;
      };
      const builder = {
        select(cols: string) {
          columns = cols
            .split(',')
            .map((c) => ident(c.trim()))
            .join(', ');
          return builder;
        },
        eq: filter('='),
        lt: filter('<'),
        lte: filter('<='),
        order(column: string, opts: { ascending: boolean }) {
          order.push(`${ident(column)} ${opts.ascending ? 'asc' : 'desc'}`);
          return builder;
        },
        limit(n: number) {
          limit = n;
          return builder;
        },
        then(resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) {
          const sql =
            `select ${columns} from public.${ident(table)}` +
            (where.length > 0 ? ` where ${where.join(' and ')}` : '') +
            (order.length > 0 ? ` order by ${order.join(', ')}` : '') +
            (limit === null ? '' : ` limit ${limit}`);
          return asRole(pg, 'service_role', null, (tx) =>
            tx.query<Record<string, unknown>>(sql, params),
          )
            .then(
              ({ rows }) => ({
                // PostgREST answers timestamps as strings.
                data: rows.map((r) =>
                  Object.fromEntries(
                    Object.entries(r).map(([k, v]) => [k, v instanceof Date ? v.toISOString() : v]),
                  ),
                ),
                error: null,
              }),
              (e: Error) => ({ data: null, error: { message: e.message } }),
            )
            .then(resolve, reject);
        },
      };
      return builder;
    },
  } as unknown as SupabaseClient;
}

function sinks() {
  const sent: InngestSend[][] = [];
  const s = {
    send: vi.fn<EffectSinks['send']>(async (events) => {
      sent.push([...events]);
    }),
    cancel: vi.fn<EffectSinks['cancel']>(async () => {}),
    alert: vi.fn<EffectSinks['alert']>(async () => {}),
  };
  return { sinks: s, sent };
}

function deps(now: number, over: Partial<ClockDeps> = {}): ClockDeps {
  return {
    store,
    reads: supabaseSweepReads(postgrestOver(db)),
    sinks: sinks().sinks,
    now: () => now,
    ...over,
  };
}

describe('applyClockEvent on the real schema', () => {
  it('the reminder of a no-card trial plans one email.requested, keyed by the trial’s end, and writes nothing', async () => {
    const id = await noCardTrial();
    const before = await stateOf(id);
    const r = await applyClockEvent(store, id, {
      type: 'trial_reminder_due',
      at: new Date(REMINDER_AT),
    });
    expect(r).toEqual({
      outcome: 'applied',
      reason: null,
      planned: [
        {
          kind: 'send',
          id: `email.requested:trial_reminder:${id}:trial-reminder:${TRIAL_END}`,
          name: 'email.requested',
          data: { accountId: id, template: 'trial_reminder' },
        },
      ],
    });
    expect(await stateOf(id)).toEqual(before);
  });

  it('the expiry at the trial’s end moves it to Free and plans entitlement.changed', async () => {
    const id = await noCardTrial();
    const r = await applyClockEvent(store, id, { type: 'trial_expired', at: new Date(TRIAL_END) });
    expect(r).toEqual({
      outcome: 'applied',
      reason: null,
      planned: [
        {
          kind: 'send',
          id: `entitlement.changed:${id}:trial-expired:${TRIAL_END}`,
          name: 'entitlement.changed',
          data: { accountId: id, from: 'pro_trial', to: 'free' },
        },
      ],
    });
    expect(await stateOf(id)).toMatchObject({ state: 'free', tier: 'free' });
  });

  it('an expiry after a paid checkout is a recorded no-op: ignored, “not a no-card trial”', async () => {
    const id = await noCardTrial();
    await apply(id, checkout('sub_paid', at(2 * DAY)));
    const before = await stateOf(id);
    const r = await applyClockEvent(store, id, { type: 'trial_expired', at: new Date(TRIAL_END) });
    expect(r).toEqual({ outcome: 'ignored', reason: 'not a no-card trial', planned: [] });
    expect(await stateOf(id)).toEqual(before);
    expect(before).toMatchObject({ state: 'pro', tier: 'pro' });
  });

  it('a lapse after the grace plans entitlement.changed keyed by when the account fell past due', async () => {
    const id = await pastDue();
    const r = await applyClockEvent(store, id, {
      type: 'past_due_lapsed',
      at: new Date(GRACE_ENDS),
    });
    expect(r.planned).toEqual([
      {
        kind: 'send',
        id: `entitlement.changed:${id}:past-due-lapsed:${PAST_DUE_SINCE}`,
        name: 'entitlement.changed',
        data: { accountId: id, from: 'past_due', to: 'free' },
      },
    ]);
    expect(await stateOf(id)).toMatchObject({ state: 'free', tier: 'free' });
  });

  it('what it returns is small and survives JSON unchanged, as an Inngest step output must', async () => {
    const id = await noCardTrial();
    const r = await applyClockEvent(store, id, { type: 'trial_expired', at: new Date(TRIAL_END) });
    const json = JSON.stringify(r);
    expect(JSON.parse(json)).toEqual(r);
    expect(json.length).toBeLessThan(4096);
  });
});

describe('the sweep’s narrowing read (supabaseSweepReads through PostgREST’s calls)', () => {
  const candidatesAt = (now: number, limit = 100) =>
    sweepCandidates(supabaseSweepReads(postgrestOver(db)), new Date(now), limit);

  it('lists a past-due account 7 days + 1 ms after it fell past due', async () => {
    const id = await pastDue();
    expect(await candidatesAt(GRACE_ENDS + 1)).toEqual([{ accountId: id, kind: 'lapse' }]);
  });

  it('leaves out a past-due account 7 days − 1 ms after it fell past due', async () => {
    await pastDue();
    expect(await candidatesAt(GRACE_ENDS - 1)).toEqual([]);
  });

  it('lists a no-card trial from its end on, and not a millisecond before', async () => {
    const id = await noCardTrial();
    expect(await candidatesAt(Date.parse(TRIAL_END) - 1)).toEqual([]);
    expect(await candidatesAt(Date.parse(TRIAL_END))).toEqual([{ accountId: id, kind: 'expire' }]);
  });

  it('leaves out trials on Stripe’s clock (a card trial, an Agency trial) and accounts in no trial', async () => {
    const card = await newAccount();
    await apply(card, {
      type: 'trial_started',
      at: at(0),
      variant: 'card_required',
      trialEnd: new Date(TRIAL_END),
      subscriptionId: 'sub_card',
      subscriptionStatus: 'trialing',
    });
    const agency = await newAccount();
    await apply(agency, {
      type: 'agency_trial_started',
      at: at(0),
      trialEnd: new Date(TRIAL_END),
      subscriptionId: 'sub_agency',
      subscriptionStatus: 'trialing',
    });
    await newAccount();
    const paid = await newAccount();
    await apply(paid, checkout('sub_pro', at(0)));
    expect(await candidatesAt(Date.parse(TRIAL_END) + 30 * DAY)).toEqual([]);
  });

  it('lists the longest overdue first, across both kinds, at most `limit`', async () => {
    // At T + 30 days: `early`'s grace ended at T + 8 days, the trial at T + 14, `late`'s grace at T + 17.
    const late = await pastDue(at(10 * DAY));
    const trial = await noCardTrial();
    const early = await pastDue(at(DAY));
    const sweepAt = T + 30 * DAY;
    expect(await candidatesAt(sweepAt)).toEqual([
      { accountId: early, kind: 'lapse' },
      { accountId: trial, kind: 'expire' },
      { accountId: late, kind: 'lapse' },
    ]);
    expect(await candidatesAt(sweepAt, 2)).toEqual([
      { accountId: early, kind: 'lapse' },
      { accountId: trial, kind: 'expire' },
    ]);
  });

  it('a read that fails throws, so the step fails and is retried', async () => {
    const broken = {
      from: () => ({
        select: () => broken.from(),
        eq: () => broken.from(),
        lt: () => broken.from(),
        lte: () => broken.from(),
        order: () => broken.from(),
        limit: () => Promise.resolve({ data: null, error: { message: 'connection refused' } }),
      }),
    };
    await expect(
      sweepCandidates(supabaseSweepReads(broken as unknown as SupabaseClient), at(0), 100),
    ).rejects.toThrow('connection refused');
  });
});

/** Runs a handler with every step at once, through JSON, and no sleeping. */
function steps() {
  const ran: string[] = [];
  const step = {
    run: async (id: string, fn: () => unknown) => {
      ran.push(id);
      return JSON.parse(JSON.stringify((await fn()) ?? null)) as unknown;
    },
    sleepUntil: async () => {},
  };
  return { step, ran };
}

type Handler = (ctx: { event?: unknown; step: unknown }) => Promise<unknown>;
const handler = (fn: unknown) => (fn as { fn: Handler }).fn;

const trialStarted = (accountId: string) => ({
  name: 'trial.started',
  data: { accountId, trialEndsAt: TRIAL_END, variant: 'no_card' },
});

describe('trialLifecycleFn over the app clock', () => {
  it('a no-card trial: the reminder sends one email.requested, the end moves it to Free', async () => {
    const id = await noCardTrial();
    const { sinks: s, sent } = sinks();
    const run = handler(
      createTrialLifecycleFn(() => billingClock(deps(Date.parse(REMINDER_AT), { sinks: s }))),
    );
    const out = await run({ event: trialStarted(id), step: steps().step });
    expect(sent.map((batch) => batch.map((e) => e.name))).toEqual([
      ['email.requested'],
      ['entitlement.changed'],
    ]);
    expect(sent[0]).toEqual([
      {
        id: `email.requested:trial_reminder:${id}:trial-reminder:${TRIAL_END}`,
        name: 'email.requested',
        data: { accountId: id, template: 'trial_reminder' },
      },
    ]);
    expect(out).toEqual({ remind: 'applied', expire: 'applied' });
    expect(await stateOf(id)).toMatchObject({ state: 'free', tier: 'free' });
  });

  it('a trial converted before the reminder: nothing is sent and the account stays on its plan', async () => {
    const id = await noCardTrial();
    await apply(id, checkout('sub_paid', at(DAY)));
    const { sinks: s } = sinks();
    const run = handler(
      createTrialLifecycleFn(() => billingClock(deps(Date.parse(REMINDER_AT), { sinks: s }))),
    );
    expect(await run({ event: trialStarted(id), step: steps().step })).toEqual({
      remind: 'ignored',
      expire: 'ignored',
    });
    expect(s.send).not.toHaveBeenCalled();
    expect(await stateOf(id)).toMatchObject({ state: 'pro', tier: 'pro' });
  });

  it('a failed send after the expiry is retried with the recorded plan; entitlement.changed is not lost', async () => {
    const id = await noCardTrial();
    const { sinks: s, sent } = sinks();
    let failNext = true;
    s.send.mockImplementation(async (events) => {
      if (failNext && events.some((e) => e.name === 'entitlement.changed')) {
        failNext = false;
        throw new Error('inngest send failed');
      }
      sent.push([...events]);
    });
    const memo = new Map<string, unknown>();
    const step = {
      run: async (sid: string, fn: () => unknown) => {
        if (memo.has(sid)) return memo.get(sid);
        const out = JSON.parse(JSON.stringify((await fn()) ?? null)) as unknown;
        memo.set(sid, out);
        return out;
      },
      sleepUntil: async () => {},
    };
    const run = handler(
      createTrialLifecycleFn(() => billingClock(deps(Date.parse(REMINDER_AT), { sinks: s }))),
    );
    await expect(run({ event: trialStarted(id), step })).rejects.toThrow('inngest send failed');
    expect(await stateOf(id)).toMatchObject({ state: 'free' });
    // The retry: the expiry is recorded, so it is not applied again (which would now be ignored and
    // plan nothing); its plan is sent.
    await run({ event: trialStarted(id), step });
    // The reminder went out once, before the failure; the expiry's plan once, on the retry.
    expect(sent.map((batch) => batch.map((e) => e.name))).toEqual([
      ['email.requested'],
      ['entitlement.changed'],
    ]);
    expect(sent.at(-1)).toEqual([
      {
        id: `entitlement.changed:${id}:trial-expired:${TRIAL_END}`,
        name: 'entitlement.changed',
        data: { accountId: id, from: 'pro_trial', to: 'free' },
      },
    ]);
  });
});

describe('pastDueSweepFn over the app clock', () => {
  it('expires a no-card trial whose end has passed, with the id the lifecycle’s expiry would send', async () => {
    const trial = await noCardTrial();
    const { sinks: s, sent } = sinks();
    const run = handler(
      createPastDueSweepFn(() =>
        billingClock(deps(Date.parse(TRIAL_END) + 3_600_000, { sinks: s })),
      ),
    );
    expect(await run({ step: steps().step })).toEqual({ swept: 1, applied: 1, ignored: 0 });
    expect(await stateOf(trial)).toMatchObject({ state: 'free', tier: 'free' });
    expect(sent).toEqual([
      [
        {
          id: `entitlement.changed:${trial}:trial-expired:${TRIAL_END}`,
          name: 'entitlement.changed',
          data: { accountId: trial, from: 'pro_trial', to: 'free' },
        },
      ],
    ]);
  });

  it('at the boundary: 7 days + 1 ms lapses, 7 days − 1 ms is not even looked at', async () => {
    const lapsing = await pastDue();
    // Fell past due 2 ms after `lapsing`: at the sweep it is 1 ms inside its grace.
    const inGrace = await pastDue(new Date(Date.parse(PAST_DUE_SINCE) + 2));
    const { sinks: s } = sinks();
    const run = handler(
      createPastDueSweepFn(() => billingClock(deps(GRACE_ENDS + 1, { sinks: s }))),
    );
    const { step, ran } = steps();
    expect(await run({ step })).toEqual({ swept: 1, applied: 1, ignored: 0 });
    expect(ran).toEqual(['now', 'candidates', `lapse-${lapsing}`, `lapse-effects-${lapsing}`]);
    expect(await stateOf(lapsing)).toMatchObject({ state: 'free' });
    expect(await stateOf(inGrace)).toMatchObject({ state: 'past_due', tier: 'pro' });
  });

  it('a read widened past the grace is still stopped by the machine: the account stays past due', async () => {
    const inGrace = await pastDue();
    const everyPastDue: SweepReads = {
      pastDueBefore: async () => [{ accountId: inGrace, at: new Date(PAST_DUE_SINCE) }],
      noCardTrialsEndedBy: async () => [],
    };
    const { sinks: s } = sinks();
    const run = handler(
      createPastDueSweepFn(() =>
        billingClock(deps(GRACE_ENDS - 1, { sinks: s, reads: everyPastDue })),
      ),
    );
    expect(await run({ step: steps().step })).toEqual({ swept: 1, applied: 0, ignored: 1 });
    expect(await stateOf(inGrace)).toMatchObject({ state: 'past_due', tier: 'pro' });
    expect(s.send).not.toHaveBeenCalled();
  });
});

describe('billingClock.dispatch', () => {
  it('refuses a recorded plan that is not a plan, and sends nothing', async () => {
    const { sinks: s } = sinks();
    const clock = billingClock(deps(T, { sinks: s }));
    await expect(
      clock.dispatch([{ kind: 'send', id: 'x', name: 'trial.started', data: {} }]),
    ).rejects.toThrow();
    expect(s.send).not.toHaveBeenCalled();
  });
});
