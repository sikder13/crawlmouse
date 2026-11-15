/**
 * The first-login hook (CC-25 D4 as amended, D5 as amended, D6; CC-06c) against every applied
 * migration in PGlite: the trigger that makes the account, `start_trial_with_ledger`, `trial_ledger`
 * and the sites constraints. Each store call is its own transaction, as a PostgREST request is.
 * Prior ledger rows are dated from the database's clock, which the trial function reads.
 */
import type { PGlite } from '@electric-sql/pglite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fc from 'fast-check';
import { GATES } from '../../lib/entitlement-v2';
import { FUNNEL_EVENTS } from '../../lib/analytics-events';
import { TRIAL_DAYS } from '../../lib/billing/state-machine';
import { hashLedgerValue, ledgerValues } from '../../lib/auth/ledger';
import { MalformedTrialDecisionError } from '../../lib/auth/trial-decision';
import {
  isFirstLogin,
  runFirstLogin,
  type FirstLoginDeps,
  type FirstLoginInput,
} from '../../lib/auth/first-login';
import { readMigration } from '../helpers/pglite-migrations';
import {
  accountOf,
  count,
  doorDb,
  pgliteDoorStore,
  pgliteEntitlementStore,
  signUp,
} from './_lib/door-pglite';

const PEPPER = 'k'.repeat(40);
const NOW = new Date('2026-11-05T12:00:00.000Z');
const CONFIRMED = {
  emailConfirmedAt: '2026-11-05T11:59:58.000Z',
  lastSignInAt: '2026-11-05T11:59:58.120Z',
};

let db: PGlite;
beforeEach(async () => {
  db = await doorDb();
}, 60_000);
// Each test and each property run clones a database; an unclosed clone holds its memory until the
// worker dies.
afterEach(async () => {
  await db?.close();
});

function deps(over: Partial<FirstLoginDeps> = {}): FirstLoginDeps & {
  report: ReturnType<typeof vi.fn>;
  dispatch: ReturnType<typeof vi.fn<FirstLoginDeps['dispatch']>>;
} {
  return {
    store: pgliteDoorStore(db),
    entitlement: pgliteEntitlementStore(db),
    admit: async () => true,
    report: vi.fn(),
    pepper: PEPPER,
    now: () => NOW,
    dispatch: vi.fn<FirstLoginDeps['dispatch']>(async () => {}),
    ...over,
  } as FirstLoginDeps & {
    report: ReturnType<typeof vi.fn>;
    dispatch: ReturnType<typeof vi.fn<FirstLoginDeps['dispatch']>>;
  };
}

async function input(email: string, over: Partial<FirstLoginInput> = {}): Promise<FirstLoginInput> {
  const userId = await signUp(db, email);
  return {
    userId,
    email,
    ...CONFIRMED,
    device: `dev-${email}`,
    ip: '203.0.113.7',
    signup: null,
    ...over,
  };
}

const ledgerRows = (accountId: string) =>
  count(db, `select 1 from public.trial_ledger where account_id = $1`, [accountId]);

/** A prior trial on these values, recorded by another account `daysAgo` days before the database's now(). */
async function priorTrial(
  values: { email: string; device: string | null; ip: string },
  daysAgo: number,
) {
  const other = await signUp(db, `prior-${Math.random()}@example.org`);
  const { id } = await accountOf(db, other);
  for (const v of ledgerValues(values)) {
    await db.query(
      `insert into public.trial_ledger (kind, value_hash, account_id, trial_kind, created_at)
       values ($1, $2, $3, 'pro', now() - make_interval(days => $4))`,
      [v.kind, hashLedgerValue(PEPPER, v.kind, v.value), id, daysAgo],
    );
  }
}

describe('isFirstLogin: the verify that confirmed the email', () => {
  it('is true when the confirmation and this sign-in are the same moment, within 5 s', () => {
    expect(isFirstLogin(CONFIRMED.emailConfirmedAt, CONFIRMED.lastSignInAt)).toBe(true);
    expect(isFirstLogin('2026-11-05T11:00:00Z', '2026-11-05T11:00:05Z')).toBe(true);
  });

  it('is false for a later sign-in, an unconfirmed user or a missing timestamp', () => {
    expect(isFirstLogin('2026-11-05T11:00:00Z', '2026-11-05T11:00:05.001Z')).toBe(false);
    expect(isFirstLogin('2026-10-01T00:00:00Z', '2026-11-05T11:00:00Z')).toBe(false);
    expect(isFirstLogin(null, '2026-11-05T11:00:00Z')).toBe(false);
    expect(isFirstLogin('2026-11-05T11:00:00Z', null)).toBe(false);
    expect(isFirstLogin('not a date', 'not a date')).toBe(false);
  });
});

describe('runFirstLogin', () => {
  it('starts the 14-day no-card Pro trial and writes three ledger rows', async () => {
    const i = await input('new@example.com');
    const r = await runFirstLogin(deps(), i);
    expect(r.trial).toBe('started');
    const a = await accountOf(db, i.userId);
    expect(a.state).toBe('pro_trial');
    expect(a.trial_variant).toBe('no_card');
    expect(a.trial_ends_at!.getTime() - NOW.getTime()).toBe(TRIAL_DAYS * 86_400_000);
    expect(a.site_limit).toBe(GATES.pro.sites);
    expect(await ledgerRows(a.id)).toBe(3);
    expect(r.events).toEqual([
      { name: 'trial_started', props: { kind: 'pro', variant: 'no_card' } },
    ]);
  });

  it('records one row per value it knows: no device and no IP leaves the email alone', async () => {
    const i = await input('bare@example.com', { device: null, ip: 'unknown' });
    expect((await runFirstLogin(deps(), i)).trial).toBe('started');
    expect(await ledgerRows((await accountOf(db, i.userId)).id)).toBe(1);
  });

  it('is refused by a trial on the same normalised email 11 months ago, and stays Free', async () => {
    await priorTrial({ email: 'ada@gmail.com', device: null, ip: 'unknown' }, 330);
    const i = await input('A.D.A+new@gmail.com');
    const r = await runFirstLogin(deps(), i);
    expect(r.trial).toBe('denied');
    const a = await accountOf(db, i.userId);
    expect(a.state).toBe('free');
    expect(await ledgerRows(a.id)).toBe(0);
    expect(r.events).toEqual([]);
  });

  it('is refused by two trials from this device in the last 30 days', async () => {
    await priorTrial({ email: 'one@example.org', device: 'shared-dev', ip: 'unknown' }, 3);
    await priorTrial({ email: 'two@example.org', device: 'shared-dev', ip: 'unknown' }, 9);
    const i = await input('three@example.com', { device: 'shared-dev' });
    expect((await runFirstLogin(deps(), i)).trial).toBe('denied');
  });

  it('is not refused by the network alone, however many trials it has had', async () => {
    for (let n = 0; n < 4; n++) {
      await priorTrial(
        { email: `office${n}@example.org`, device: `d${n}`, ip: '203.0.113.50' },
        n + 1,
      );
    }
    const i = await input('colleague@example.com', { device: 'fresh-dev', ip: '203.0.113.7' });
    expect((await runFirstLogin(deps(), i)).trial).toBe('started');
  });

  it('two strangers on one /24 signing up back to back both get the trial', async () => {
    // The network's rows refuse nothing without a row of this browser's device.
    const a = await input('alice@example.com', { device: 'dev-a', ip: '203.0.113.7' });
    const b = await input('bob@example.org', { device: 'dev-b', ip: '203.0.113.99' });
    const ra = await runFirstLogin(deps(), a);
    const rb = await runFirstLogin(deps(), b);
    expect([ra.trial, rb.trial]).toEqual(['started', 'started']);
  });

  it('a refused account is not offered the trial again at a later login from elsewhere', async () => {
    await priorTrial({ email: 'farm@example.com', device: null, ip: 'unknown' }, 10);
    const i = await input('farm@example.com');
    expect((await runFirstLogin(deps(), i)).trial).toBe('denied');
    const later = {
      ...i,
      ip: '198.51.100.9',
      device: 'home-dev',
      lastSignInAt: '2026-11-06T09:00:00Z',
    };
    expect((await runFirstLogin(deps(), later)).trial).toBe('not_first');
    expect((await accountOf(db, i.userId)).state).toBe('free');
  });

  it('an account whose email was confirmed at an earlier sign-in gets no trial now', async () => {
    const i = await input('v1-era@example.com', {
      emailConfirmedAt: '2026-08-01T10:00:00Z',
      lastSignInAt: '2026-11-05T11:59:59Z',
    });
    expect((await runFirstLogin(deps(), i)).trial).toBe('not_first');
    expect((await accountOf(db, i.userId)).state).toBe('free');
  });

  it('does nothing for a user without a v2 account (pre-001, before 20261116000002 runs)', async () => {
    const i = await input('old@example.com');
    await db.query(`update public.users set default_account_id = null where id = $1`, [i.userId]);
    const r = await runFirstLogin(deps(), i);
    expect(r).toEqual({ trial: 'no_account', siteId: null, events: [] });
    expect(await count(db, `select 1 from public.trial_ledger`)).toBe(0);
  });

  it('a pre-001 user given an account by 20261116000002 gets no trial at their first v2 sign-in', async () => {
    // As production holds them: an auth row and a users row from before 001, the trigger held off.
    const userId = '9e1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d';
    await db.exec(`alter table auth.users disable trigger on_auth_user_created`);
    await db.query(`insert into auth.users (id, email) values ($1, 'v1-user@example.com')`, [
      userId,
    ]);
    await db.query(`insert into public.users (id, email) values ($1, 'v1-user@example.com')`, [
      userId,
    ]);
    await db.exec(`alter table auth.users enable trigger on_auth_user_created`);
    await db.exec(readMigration('20261116000002_v2_036_account_backfill.sql'));
    const { id: accountId } = await accountOf(db, userId);
    // Confirmed at the v1 sign-up, months before this sign-in.
    const r = await runFirstLogin(deps(), {
      userId,
      email: 'v1-user@example.com',
      emailConfirmedAt: '2026-06-20T09:00:00Z',
      lastSignInAt: '2026-11-05T11:59:59Z',
      device: 'dev-v1-user',
      ip: '203.0.113.7',
      signup: null,
    });
    expect(r).toEqual({ trial: 'not_first', siteId: null, events: [] });
    expect((await accountOf(db, userId)).state).toBe('free');
    expect(await ledgerRows(accountId)).toBe(0);
  });

  // Questions Q19: a pre-001 user who never confirmed their email has never signed in. Their first
  // confirmed sign-in is a sign-up's in every respect the door reads, so it gets a sign-up's trial.
  it('a pre-001 user who never confirmed, given an account by 20261116000002, gets the trial a sign-up gets', async () => {
    const userId = '9e1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5e';
    await db.exec(`alter table auth.users disable trigger on_auth_user_created`);
    await db.query(`insert into auth.users (id, email) values ($1, 'v1-unconfirmed@example.com')`, [
      userId,
    ]);
    await db.query(
      `insert into public.users (id, email) values ($1, 'v1-unconfirmed@example.com')`,
      [userId],
    );
    await db.exec(`alter table auth.users enable trigger on_auth_user_created`);
    await db.exec(readMigration('20261116000002_v2_036_account_backfill.sql'));
    const { id: accountId } = await accountOf(db, userId);
    // The magic link confirms the address and signs in at once.
    const r = await runFirstLogin(deps(), {
      userId,
      email: 'v1-unconfirmed@example.com',
      emailConfirmedAt: '2026-11-17T12:00:00Z',
      lastSignInAt: '2026-11-17T12:00:00Z',
      device: 'dev-v1-unconfirmed',
      ip: '203.0.113.8',
      signup: null,
    });
    expect(r.trial).toBe('started');
    expect(await ledgerRows(accountId)).toBeGreaterThan(0);
  });

  it('without a pepper: no ledger read or write, no trial, a Sentry signal with ids only', async () => {
    const i = await input('nopepper@example.com');
    const store = pgliteDoorStore(db);
    const startTrial = vi.spyOn(store, 'startTrial');
    const d = deps({ pepper: null, store });
    const r = await runFirstLogin(d, i);
    expect(r.trial).toBe('no_pepper');
    expect(startTrial).not.toHaveBeenCalled();
    expect((await accountOf(db, i.userId)).state).toBe('free');
    expect(d.report).toHaveBeenCalledWith('trial-ledger-no-pepper', {
      accountId: (await accountOf(db, i.userId)).id,
    });
    expect(JSON.stringify(d.report.mock.calls)).not.toContain('nopepper@example.com');
  });

  it('adds the named first site with the tier schedule and the owner seat, and says so', async () => {
    const i = await input('site@example.com', {
      signup: { site: 'Acme-Outdoors.com', tz: 'Asia/Kolkata' },
    });
    const r = await runFirstLogin(deps(), i);
    expect(r.siteId).not.toBeNull();
    const { rows } = await db.query<Record<string, unknown>>(
      `select s.host, s.schedule_cadence, s.schedule_iso_weekday, s.schedule_hour_local,
              s.owner_seat_id = se.id as owner, a.timezone
         from public.sites s join public.accounts a on a.id = s.account_id
         join public.seats se on se.account_id = a.id and se.role = 'owner'
        where s.id = $1`,
      [r.siteId],
    );
    // 12:00 UTC on Thursday 5 November is 17:30 Thursday in Kolkata.
    expect(rows[0]).toEqual({
      host: 'acme-outdoors.com',
      schedule_cadence: 'weekly',
      schedule_iso_weekday: 4,
      schedule_hour_local: 6,
      owner: true,
      timezone: 'Asia/Kolkata',
    });
    expect(r.events).toContainEqual({ name: 'site_added', props: { n: 1 } });
  });

  it('a refused (Free) account still gets its first site, monthly', async () => {
    await priorTrial({ email: 'freesite@example.com', device: null, ip: 'unknown' }, 1);
    const i = await input('freesite@example.com', { signup: { site: 'example.net' } });
    const r = await runFirstLogin(deps(), i);
    expect(r.trial).toBe('denied');
    const { rows } = await db.query<{ c: string }>(
      `select schedule_cadence as c from public.sites where id = $1`,
      [r.siteId],
    );
    expect(rows[0]!.c).toBe('monthly');
  });

  it('a site the SSRF guard refuses is skipped and reported; the sign-in result stands', async () => {
    const i = await input('ssrf@example.com', { signup: { site: 'internal.example.com' } });
    const d = deps({ admit: async () => false });
    const r = await runFirstLogin(d, i);
    expect(r.trial).toBe('started');
    expect(r.siteId).toBeNull();
    expect(d.report).toHaveBeenCalledWith('first-site-refused', expect.objectContaining({}));
  });

  it('re-validates what the cookie carried: a bad host or zone is dropped, not trusted', async () => {
    const i = await input('forged@example.com', { signup: { site: '10.0.0.1', tz: 'Not/AZone' } });
    const r = await runFirstLogin(deps(), i);
    expect(r.siteId).toBeNull();
    expect((await accountOf(db, i.userId)).timezone).toBe('UTC');
  });

  it('attaches no site beyond the tier the account is on now, whatever its stored limit says', async () => {
    // A no-card trial that ended yesterday, not yet expired by the sweep: state pro_trial, limit 5,
    // one site kept. Its tier now is Free, which keeps one site.
    const i = await input('lapsed@example.com', { signup: { site: 'second.example.com' } });
    const a = await accountOf(db, i.userId);
    await db.query(
      `update public.accounts set state = 'pro_trial', tier = 'pro', trial_variant = 'no_card',
              trial_ends_at = $2, trial_used_at = $3, site_limit = 5, seat_limit = 2, competitor_limit = 1,
              state_history = state_history || jsonb_build_array(jsonb_build_object('state','pro_trial','since','2026-10-20T00:00:00.000Z'))
        where id = $1`,
      [a.id, new Date('2026-11-04T00:00:00Z'), new Date('2026-10-21T00:00:00Z')],
    );
    await db.query(`insert into public.sites (account_id, host) values ($1, 'first.example.com')`, [
      a.id,
    ]);
    const r = await runFirstLogin(deps(), i);
    expect(r.siteId).toBeNull();
    expect(await count(db, `select 1 from public.sites where account_id = $1`, [a.id])).toBe(1);
  });

  it('a later sign-in that names a site attaches it, and decides no trial', async () => {
    const i = await input('returning@example.com', {
      emailConfirmedAt: '2026-08-01T10:00:00Z',
      lastSignInAt: '2026-11-05T11:59:59Z',
      signup: { site: 'another.example.com', tz: 'Asia/Kolkata' },
    });
    const store = pgliteDoorStore(db);
    const startTrial = vi.spyOn(store, 'startTrial');
    const r = await runFirstLogin(deps({ store }), i);
    expect(r.trial).toBe('not_first');
    expect(r.siteId).not.toBeNull();
    expect(r.events).toEqual([{ name: 'site_added', props: { n: 1 } }]);
    expect(startTrial).not.toHaveBeenCalled();
    // The zone is a first-login setting; a later sign-in leaves it.
    expect((await accountOf(db, i.userId)).timezone).toBe('UTC');
  });

  it('a later sign-in on a paid account with a site kept adds the second, weekly, as site 2', async () => {
    const i = await input('second@example.com', {
      emailConfirmedAt: '2026-08-01T10:00:00Z',
      lastSignInAt: '2026-11-05T11:59:59Z',
      signup: { site: 'two.example.com' },
    });
    const a = await accountOf(db, i.userId);
    await db.query(
      `update public.accounts set state = 'pro_trial', tier = 'pro', trial_variant = 'no_card',
              trial_ends_at = $2, trial_used_at = $3, site_limit = 5, seat_limit = 2, competitor_limit = 1,
              state_history = state_history || jsonb_build_array(jsonb_build_object('state','pro_trial','since','2026-11-01T00:00:00.000Z'))
        where id = $1`,
      [a.id, new Date('2026-11-15T00:00:00Z'), new Date('2026-11-01T00:00:00Z')],
    );
    await db.query(`insert into public.sites (account_id, host) values ($1, 'one.example.com')`, [
      a.id,
    ]);
    const r = await runFirstLogin(deps(), i);
    expect(r.events).toEqual([{ name: 'site_added', props: { n: 2 } }]);
    const { rows } = await db.query<Record<string, unknown>>(
      `select schedule_cadence, schedule_iso_weekday, schedule_hour_local from public.sites where id = $1`,
      [r.siteId],
    );
    expect(rows[0]).toEqual({
      schedule_cadence: 'weekly',
      schedule_iso_weekday: 4,
      schedule_hour_local: 6,
    });
  });

  it('every event name it emits is a funnel event', () => {
    for (const name of ['trial_started', 'site_added']) expect(FUNNEL_EVENTS).toContain(name);
  });
});

describe('the started trial’s effects are dispatched (CC-03 D9b)', () => {
  // 14 days after NOW, written out.
  const TRIAL_END = '2026-11-19T12:00:00.000Z';

  it('a started trial dispatches trial.started with the trial’s end, and entitlement.changed', async () => {
    const i = await input('dispatch@example.com');
    const d = deps();
    expect((await runFirstLogin(d, i)).trial).toBe('started');
    const { id } = await accountOf(db, i.userId);
    expect(d.dispatch.mock.calls).toEqual([
      [
        [
          {
            kind: 'send',
            id: `trial.started:${id}:trial-start`,
            name: 'trial.started',
            data: { accountId: id, trialEndsAt: TRIAL_END, variant: 'no_card' },
          },
          {
            kind: 'send',
            id: `entitlement.changed:${id}:trial-start`,
            name: 'entitlement.changed',
            data: { accountId: id, from: 'free', to: 'pro_trial' },
          },
        ],
      ],
    ]);
    // The end it announces is the end the database holds.
    expect((await accountOf(db, i.userId)).trial_ends_at!.toISOString()).toBe(TRIAL_END);
  });

  it('denied: a ledger row refused it, and nothing is dispatched', async () => {
    await priorTrial({ email: 'refused@example.com', device: null, ip: 'unknown' }, 5);
    const i = await input('refused@example.com');
    const d = deps();
    expect((await runFirstLogin(d, i)).trial).toBe('denied');
    expect(d.dispatch).not.toHaveBeenCalled();
  });

  it('not_eligible, decided by next() or by the trial function: nothing is dispatched', async () => {
    const disputed = await input('noteligible@example.com');
    await db.query(`update public.accounts set disputed_at = now() where id = $1`, [
      (await accountOf(db, disputed.userId)).id,
    ]);
    const byNext = deps();
    expect((await runFirstLogin(byNext, disputed)).trial).toBe('not_eligible');
    expect(byNext.dispatch).not.toHaveBeenCalled();

    const i = await input('fn-noteligible@example.com');
    const store = {
      ...pgliteDoorStore(db),
      startTrial: async () => ({ outcome: 'not_eligible' as const, hits: [] as [] }),
    };
    const byFunction = deps({ store });
    expect((await runFirstLogin(byFunction, i)).trial).toBe('not_eligible');
    expect(byFunction.dispatch).not.toHaveBeenCalled();
  });

  it('failed: the trial function errored, and nothing is dispatched', async () => {
    const i = await input('dispatch-failed@example.com');
    const store = {
      ...pgliteDoorStore(db),
      startTrial: () => Promise.reject(Object.assign(new Error('rpc failed'), { code: '55P03' })),
    };
    const d = deps({ store });
    expect((await runFirstLogin(d, i)).trial).toBe('failed');
    expect(d.dispatch).not.toHaveBeenCalled();
  });

  it('not_first, no_pepper and no_account: nothing is dispatched', async () => {
    const later = await input('later@example.com', {
      emailConfirmedAt: '2026-08-01T10:00:00Z',
      lastSignInAt: '2026-11-05T11:59:59Z',
    });
    const noPepper = await input('pepperless@example.com');
    const noAccount = await input('pre001@example.com');
    await db.query(`update public.users set default_account_id = null where id = $1`, [
      noAccount.userId,
    ]);
    const cases = [
      [later, deps(), 'not_first'],
      [noPepper, deps({ pepper: null }), 'no_pepper'],
      [noAccount, deps(), 'no_account'],
    ] as const;
    for (const [i, d, outcome] of cases) {
      expect((await runFirstLogin(d, i)).trial).toBe(outcome);
      expect(d.dispatch).not.toHaveBeenCalled();
    }
  });

  it('a dispatch that throws is reported with the account id only, and the trial still started', async () => {
    const i = await input('send-down@example.com');
    const d = deps({
      dispatch: vi.fn(async () => {
        throw new Error('inngest send failed for send-down@example.com');
      }),
    });
    const r = await runFirstLogin(d, i);
    const a = await accountOf(db, i.userId);
    expect(r.trial).toBe('started');
    expect(r.events).toEqual([
      { name: 'trial_started', props: { kind: 'pro', variant: 'no_card' } },
    ]);
    expect(a.state).toBe('pro_trial');
    expect(d.report).toHaveBeenCalledWith('trial-dispatch-failed', { accountId: a.id });
    expect(JSON.stringify(d.report.mock.calls)).not.toContain('send-down@example.com');
  });
});

describe('a trial decision that cannot be made is reported, and the account stays Free (D10)', () => {
  async function failing(startTrial: () => Promise<never>) {
    const i = await input(`fail-${Math.random()}@example.com`);
    const store = { ...pgliteDoorStore(db), startTrial };
    const d = deps({ store });
    const r = await runFirstLogin(d, i);
    const a = await accountOf(db, i.userId);
    return { r, d, a };
  }
  const sqlError = (code: string) => () =>
    Promise.reject(Object.assign(new Error('rpc failed'), { code }));

  it('a lock timeout: trial-decision-failed with reason lock_timeout', async () => {
    const { r, d, a } = await failing(sqlError('55P03'));
    expect(r.trial).toBe('failed');
    expect(r.events).toEqual([]);
    expect(a.state).toBe('free');
    expect(d.report).toHaveBeenCalledWith('trial-decision-failed', {
      accountId: a.id,
      reason: 'lock_timeout',
    });
  });

  it('any other error: reason rpc_error, with its SQLSTATE', async () => {
    const { r, d, a } = await failing(sqlError('PGRST202'));
    expect(r.trial).toBe('failed');
    expect(a.state).toBe('free');
    expect(d.report).toHaveBeenCalledWith('trial-decision-failed', {
      accountId: a.id,
      reason: 'rpc_error',
      code: 'PGRST202',
    });
  });

  it('an answer that is not a decision: reason malformed_result', async () => {
    const { r, d, a } = await failing(() => Promise.reject(new MalformedTrialDecisionError()));
    expect(r.trial).toBe('failed');
    expect(a.state).toBe('free');
    expect(d.report).toHaveBeenCalledWith('trial-decision-failed', {
      accountId: a.id,
      reason: 'malformed_result',
    });
  });

  it('a revoked grant, through the real function: reason rpc_error, code 42501', async () => {
    await db.exec(
      `revoke execute on function public.start_trial_with_ledger(uuid, jsonb, jsonb) from service_role`,
    );
    const i = await input('revoked@example.com');
    const d = deps();
    const r = await runFirstLogin(d, i);
    const a = await accountOf(db, i.userId);
    expect(r.trial).toBe('failed');
    expect(a.state).toBe('free');
    expect(await ledgerRows(a.id)).toBe(0);
    expect(d.report).toHaveBeenCalledWith('trial-decision-failed', {
      accountId: a.id,
      reason: 'rpc_error',
      code: '42501',
    });
  });

  it('a stale version is a lost race, not a failure: not_first, nothing reported', async () => {
    const i = await input('stale@example.com');
    const base = pgliteDoorStore(db);
    const store = {
      ...base,
      async startTrial(...args: Parameters<typeof base.startTrial>) {
        await db.query(
          `update public.accounts set entitlement_version = entitlement_version + 1 where id = $1`,
          [args[0]],
        );
        return base.startTrial(...args);
      },
    };
    const d = deps({ store });
    const r = await runFirstLogin(d, i);
    expect(r.trial).toBe('not_first');
    expect(d.report).not.toHaveBeenCalled();
    expect((await accountOf(db, i.userId)).state).toBe('free');
  });

  it('an account next() will not give a trial (disputed) is not_eligible, and the function is not called', async () => {
    const i = await input('disputed@example.com');
    await db.query(`update public.accounts set disputed_at = now() where id = $1`, [
      (await accountOf(db, i.userId)).id,
    ]);
    const store = pgliteDoorStore(db);
    const startTrial = vi.spyOn(store, 'startTrial');
    const r = await runFirstLogin(deps({ store }), i);
    expect(r.trial).toBe('not_eligible');
    expect(startTrial).not.toHaveBeenCalled();
  });
});

describe('runFirstLogin under interleaving of its calls', () => {
  // JS-level only. PGlite runs each call as one serial transaction, so these stay green with the
  // function's locks removed: two transactions racing inside the function are
  // scripts/db/trial-race.test.ts, against CI's Postgres service.
  /** Two runs whose store calls the scheduler interleaves in any order. */
  async function interleave(
    s: fc.Scheduler,
    a: FirstLoginInput,
    b: FirstLoginInput,
    over: Partial<FirstLoginDeps> = {},
  ): Promise<Awaited<ReturnType<typeof runFirstLogin>>[]> {
    const scheduled = (d: FirstLoginDeps): FirstLoginDeps => ({
      ...over,
      ...d,
      store: wrap(d.store, s),
      entitlement: wrap(d.entitlement, s),
      // Not deps()'s vi.fn: a mock keeps the `this` of each call, here these deps and their store, so
      // every run's database clone would stay alive until the worker ends (about 10 GB over these
      // properties). These runs assert nothing about dispatch.
      dispatch: async () => {},
    });
    // waitFor keeps releasing scheduled calls until both runs settle.
    return s.waitFor(
      Promise.all([
        runFirstLogin(scheduled(deps(over)), a),
        runFirstLogin(scheduled(deps(over)), b),
      ]),
    );
  }

  it('two runs for one account: one trial, one site, one set of ledger rows', async () => {
    await fc.assert(
      fc.asyncProperty(fc.scheduler(), async (s) => {
        await db?.close();
        db = await doorDb();
        const i = await input('race@example.com', { signup: { site: 'race.example.com' } });
        const results = await interleave(s, i, i);
        const a = await accountOf(db, i.userId);
        expect(a.state).toBe('pro_trial');
        expect(results.filter((r) => r.trial === 'started')).toHaveLength(1);
        expect(await ledgerRows(a.id)).toBe(3);
        expect(await count(db, `select 1 from public.sites where account_id = $1`, [a.id])).toBe(1);
        expect(await count(db, `select 1 from public.accounts where state = 'pro_trial'`)).toBe(1);
      }),
      { numRuns: 12 },
    );
  }, 600_000);

  it('two accounts whose emails normalise to one, on different devices: one trial', async () => {
    await fc.assert(
      fc.asyncProperty(fc.scheduler(), async (s) => {
        await db?.close();
        db = await doorDb();
        const a = await input('ada.lovelace@gmail.com', { device: 'dev-a', ip: 'unknown' });
        const b = await input('adalovelace+2@gmail.com', { device: 'dev-b', ip: 'unknown' });
        await interleave(s, a, b);
        expect(await count(db, `select 1 from public.accounts where state = 'pro_trial'`)).toBe(1);
      }),
      { numRuns: 12 },
    );
  }, 600_000);

  it('two accounts sharing a device that has one trial already: one more trial', async () => {
    await fc.assert(
      fc.asyncProperty(fc.scheduler(), async (s) => {
        await db?.close();
        db = await doorDb();
        // One prior trial on the device: the first of these two is allowed and the second refused.
        await priorTrial({ email: 'first@example.org', device: 'shared', ip: 'unknown' }, 2);
        const a = await input('a@example.com', { device: 'shared' });
        const b = await input('b@example.com', { device: 'shared' });
        await interleave(s, a, b);
        expect(await count(db, `select 1 from public.accounts where state = 'pro_trial'`)).toBe(1);
      }),
      { numRuns: 12 },
    );
  }, 600_000);
});

/** Every method of `target` scheduled, so its calls resolve in the scheduler's order. */
function wrap<T extends object>(target: T, s: fc.Scheduler): T {
  const out = {} as T;
  for (const key of Object.keys(target) as (keyof T)[]) {
    const v = target[key];
    out[key] = (typeof v === 'function' ? s.scheduleFunction(v.bind(target)) : v) as T[keyof T];
  }
  return out;
}
