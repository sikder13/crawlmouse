/**
 * The first-login hook (CC-25 D4 as amended, D5 as amended, D6) against every applied migration in
 * PGlite: the trigger that makes the account, `apply_entitlement_transition`, `trial_ledger`, the
 * sites constraints and `increment_rate_limit`. Each store call is its own transaction, as a
 * PostgREST request is.
 */
import type { PGlite } from '@electric-sql/pglite';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import fc from 'fast-check';
import { GATES } from '../../lib/entitlement-v2';
import { FUNNEL_EVENTS } from '../../lib/analytics-events';
import { TRIAL_DAYS } from '../../lib/billing/state-machine';
import { hashLedgerValue, ledgerValues } from '../../lib/auth/ledger';
import {
  isFirstLogin,
  runFirstLogin,
  type FirstLoginDeps,
  type FirstLoginInput,
} from '../../lib/auth/first-login';
import {
  accountOf,
  count,
  doorDb,
  pgliteDoorStore,
  pgliteEntitlementStore,
  pgliteSerialize,
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

function deps(
  over: Partial<FirstLoginDeps> = {},
): FirstLoginDeps & { report: ReturnType<typeof vi.fn> } {
  return {
    store: pgliteDoorStore(db),
    entitlement: pgliteEntitlementStore(db),
    serialize: pgliteSerialize(db),
    admit: async () => true,
    report: vi.fn(),
    pepper: PEPPER,
    now: () => NOW,
    ...over,
  } as FirstLoginDeps & { report: ReturnType<typeof vi.fn> };
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

/** A prior trial on these values, recorded by another account `daysAgo` days ago. */
async function priorTrial(
  values: { email: string; device: string | null; ip: string },
  daysAgo: number,
) {
  const other = await signUp(db, `prior-${Math.random()}@example.org`);
  const { id } = await accountOf(db, other);
  const at = new Date(NOW.getTime() - daysAgo * 86_400_000);
  for (const v of ledgerValues(values)) {
    await db.query(
      `insert into public.trial_ledger (kind, value_hash, account_id, trial_kind, created_at)
       values ($1, $2, $3, 'pro', $4)`,
      [v.kind, hashLedgerValue(PEPPER, v.kind, v.value), id, at],
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

  it('does nothing for a user without a v2 account (the eleven pre-001 users)', async () => {
    const i = await input('old@example.com');
    await db.query(`update public.users set default_account_id = null where id = $1`, [i.userId]);
    const r = await runFirstLogin(deps(), i);
    expect(r).toEqual({ trial: 'no_account', siteId: null, events: [] });
    expect(await count(db, `select 1 from public.trial_ledger`)).toBe(0);
  });

  it('without a pepper: no ledger read or write, no trial, a Sentry signal with ids only', async () => {
    const i = await input('nopepper@example.com');
    const store = pgliteDoorStore(db);
    const priorLedger = vi.spyOn(store, 'priorLedger');
    const insertLedger = vi.spyOn(store, 'insertLedger');
    const d = deps({ pepper: null, store });
    const r = await runFirstLogin(d, i);
    expect(r.trial).toBe('no_pepper');
    expect(priorLedger).not.toHaveBeenCalled();
    expect(insertLedger).not.toHaveBeenCalled();
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

  it('every event name it emits is a funnel event', () => {
    for (const name of ['trial_started', 'site_added']) expect(FUNNEL_EVENTS).toContain(name);
  });
});

describe('runFirstLogin under interleaving (JS-level; PGlite never contends on a lock)', () => {
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
      serialize: s.scheduleFunction(d.serialize),
    });
    // waitFor keeps releasing scheduled calls until both runs settle.
    return s.waitFor(
      Promise.all([
        runFirstLogin(scheduled(deps(over)), a),
        runFirstLogin(scheduled(deps(over)), b),
      ]),
    );
  }

  it('with the buckets bypassed, the version check alone still gives one trial and three rows', async () => {
    await fc.assert(
      fc.asyncProperty(fc.scheduler(), async (s) => {
        db = await doorDb();
        const i = await input('cas@example.com');
        const results = await interleave(s, i, i, { serialize: async () => true });
        expect(results.filter((r) => r.trial === 'started')).toHaveLength(1);
        expect(await ledgerRows((await accountOf(db, i.userId)).id)).toBe(3);
      }),
      { numRuns: 12 },
    );
  }, 600_000);

  it('two runs for one account: one trial, one site, one set of ledger rows', async () => {
    await fc.assert(
      fc.asyncProperty(fc.scheduler(), async (s) => {
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

  it('two accounts whose emails normalise to one, on different devices: at most one trial', async () => {
    await fc.assert(
      fc.asyncProperty(fc.scheduler(), async (s) => {
        db = await doorDb();
        const a = await input('ada.lovelace@gmail.com', { device: 'dev-a', ip: 'unknown' });
        const b = await input('adalovelace+2@gmail.com', { device: 'dev-b', ip: 'unknown' });
        await interleave(s, a, b);
        expect(
          await count(db, `select 1 from public.accounts where state = 'pro_trial'`),
        ).toBeLessThanOrEqual(1);
      }),
      { numRuns: 12 },
    );
  }, 600_000);

  it('two accounts sharing a device: at most one trial', async () => {
    await fc.assert(
      fc.asyncProperty(fc.scheduler(), async (s) => {
        db = await doorDb();
        // One prior trial on the device: a second would be refused, so a third concurrent one must be too.
        await priorTrial({ email: 'first@example.org', device: 'shared', ip: 'unknown' }, 2);
        const a = await input('a@example.com', { device: 'shared' });
        const b = await input('b@example.com', { device: 'shared' });
        await interleave(s, a, b);
        expect(
          await count(db, `select 1 from public.accounts where state = 'pro_trial'`),
        ).toBeLessThanOrEqual(1);
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
