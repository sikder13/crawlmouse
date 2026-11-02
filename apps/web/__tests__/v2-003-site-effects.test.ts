import { randomUUID } from 'node:crypto';
import type { PGlite } from '@electric-sql/pglite';
import fc from 'fast-check';
import { beforeAll, describe, expect, it } from 'vitest';
import { planSites, type PlannedSite, type SiteChange } from '../lib/billing/state-machine-sites';
import { GATES } from '../lib/entitlement-v2';
import { applyAllMigrations, freshDb } from './helpers/pglite-migrations';
import { personalAccount, signUp } from './helpers/v2-check-tables';

/**
 * Migration 003 extends apply_entitlement_transition with the site effects CC-02 planned in
 * apps/web/lib/billing/state-machine-sites.ts: pause_others, pause_over_limit and resume, applied to
 * the account's primary sites (not staging, not removed) in the same transaction as the account row.
 *
 * Two kinds of evidence, because agreement alone is not correctness (OPERATING-RULES §10): the SQL
 * agrees with `planSites` over generated site sets, and named cases pin rows computed by hand.
 *
 * The database keeps a paused site's schedule (cadence, weekday, hour) and records the pause in
 * `paused_reason`; the planner models a paused site as `schedule = null`. A site's planner schedule
 * is therefore its cadence when it is not paused, and null when it is.
 */

let db: PGlite;

beforeAll(async () => {
  db = await freshDb();
  await applyAllMigrations(db);
}, 120_000);

type Plan = { state: 'free' | 'pro' | 'agency'; siteLimit: number };
const FREE: Plan = { state: 'free', siteLimit: GATES.free.sites };
const PRO: Plan = { state: 'pro', siteLimit: GATES.pro.sites };
const agency = (siteLimit: number): Plan => ({ state: 'agency', siteLimit });

async function transition(accountId: string, to: Plan): Promise<void> {
  const { rows } = await db.query<{ v: number }>(
    `select entitlement_version as v from public.accounts where id = $1`,
    [accountId],
  );
  const paid = to.state !== 'free';
  await db.query(
    `select public.apply_entitlement_transition($1, $2, $3, $4, null, null, null, null, null, null,
                                                $5, $6, $7, now(), $8, null)`,
    [
      accountId,
      rows[0]!.v,
      to.state,
      to.state,
      GATES[to.state].seats,
      to.siteLimit,
      GATES[to.state].competitorsPerSite,
      paid ? `sub_${to.state}` : null,
    ],
  );
}

async function newAccount(plan: Plan, timezone = 'UTC'): Promise<string> {
  const { accountId } = await personalAccount(
    db,
    await signUp(db, `fx-${randomUUID()}@example.com`),
  );
  await db.query(`update public.accounts set timezone = $2 where id = $1`, [accountId, timezone]);
  if (plan.state !== 'free') await transition(accountId, plan);
  return accountId;
}

interface SiteRow {
  id: string;
  created_at: string;
  schedule_cadence: 'weekly' | 'monthly' | 'on_deploy' | null;
  schedule_iso_weekday: number | null;
  schedule_hour_local: number | null;
  paused_reason: 'trial_ended' | 'over_limit' | 'user' | null;
  staging_of_site_id?: string | null;
  removed_at?: string | null;
  updated_at?: string;
}

async function insertSites(accountId: string, sites: SiteRow[]): Promise<void> {
  for (const s of sites) {
    await db.query(
      `insert into public.sites (id, account_id, host, created_at, schedule_cadence, schedule_iso_weekday,
                                 schedule_hour_local, paused_reason, staging_of_site_id, removed_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        s.id,
        accountId,
        `${s.id}.example`,
        s.created_at,
        s.schedule_cadence,
        s.schedule_iso_weekday,
        s.schedule_hour_local,
        s.paused_reason,
        s.staging_of_site_id ?? null,
        s.removed_at ?? null,
      ],
    );
  }
}

async function readSites(accountId: string): Promise<Map<string, SiteRow>> {
  const { rows } = await db.query<SiteRow & { created_at: Date }>(
    `select id, created_at, schedule_cadence, schedule_iso_weekday, schedule_hour_local, paused_reason,
            updated_at::text as updated_at
       from public.sites where account_id = $1`,
    [accountId],
  );
  return new Map(
    rows.map((r) => [r.id, { ...r, created_at: new Date(r.created_at).toISOString() }]),
  );
}

/**
 * The planner's view of a site. planSites has no on_deploy cadence; a running on_deploy site is
 * given to it as a running weekly one, so its pause decisions apply, and the database keeps the
 * cadence itself (checked separately below).
 */
const planned = (s: SiteRow): PlannedSite => ({
  id: s.id,
  createdAt: new Date(s.created_at),
  schedule:
    s.paused_reason !== null
      ? null
      : s.schedule_cadence === 'on_deploy'
        ? 'weekly'
        : s.schedule_cadence,
  pausedReason: s.paused_reason,
});

function applyChanges(sites: PlannedSite[], changes: SiteChange[]): Map<string, SiteChange> {
  const out = new Map(
    sites.map((s) => [s.id, { id: s.id, schedule: s.schedule, pausedReason: s.pausedReason }]),
  );
  for (const c of changes) out.set(c.id, c);
  return out;
}

const DAY = 86_400_000;
const BASE = Date.parse('2026-10-01T09:00:00.000Z');

/** A primary site in one of the states a site can be in when an entitlement changes. */
const siteArb = fc
  .record({
    day: fc.integer({ min: 0, max: 4 }), // few days, so creation ties happen
    kind: fc.constantFrom(
      'weekly',
      'monthly',
      'unscheduled',
      'paused_trial',
      'paused_over',
      'paused_user',
      'paused_unscheduled',
      'on_deploy',
      'paused_on_deploy',
    ),
  })
  .map(({ day, kind }): SiteRow => {
    const cadence =
      kind === 'monthly'
        ? 'monthly'
        : kind === 'unscheduled' || kind === 'paused_unscheduled'
          ? null
          : kind === 'on_deploy' || kind === 'paused_on_deploy'
            ? 'on_deploy'
            : 'weekly';
    const timed = cadence === 'weekly' || cadence === 'monthly';
    const reason =
      kind === 'paused_trial' || kind === 'paused_unscheduled' || kind === 'paused_on_deploy'
        ? 'trial_ended'
        : kind === 'paused_over'
          ? 'over_limit'
          : kind === 'paused_user'
            ? 'user'
            : null;
    return {
      id: randomUUID(),
      created_at: new Date(BASE + day * DAY).toISOString(),
      schedule_cadence: cadence,
      schedule_iso_weekday: timed ? 3 : null,
      schedule_hour_local: timed ? 7 : null,
      paused_reason: reason,
    };
  });
const sitesArb = fc.array(siteArb, { minLength: 1, maxLength: 9 });

/**
 * Asserts the database's sites after the transition are what the planner says, field by field.
 * `before` is the rows as read back from the database before the transition, updated_at included.
 */
async function expectAgreement(
  accountId: string,
  before: Map<string, SiteRow>,
  expected: Map<string, SiteChange>,
) {
  const after = await readSites(accountId);
  for (const s of before.values()) {
    const got = after.get(s.id)!;
    const want = expected.get(s.id)!;
    expect(got.paused_reason, `${s.id} reason`).toBe(want.pausedReason);
    if (s.schedule_cadence === 'on_deploy') {
      // planSites does not model it: the cadence stays, with no weekday or hour.
      expect([got.schedule_cadence, got.schedule_iso_weekday, got.schedule_hour_local]).toEqual([
        'on_deploy',
        null,
        null,
      ]);
    } else {
      expect(planned(got).schedule, `${s.id} schedule`).toBe(want.schedule);
      if (got.schedule_cadence !== null) {
        // A kept schedule keeps its weekday and hour; a new one gets the creation weekday and 06:00.
        expect(got.schedule_iso_weekday).toBe(
          s.schedule_iso_weekday ?? ((new Date(s.created_at).getUTCDay() + 6) % 7) + 1,
        );
        expect(got.schedule_hour_local).toBe(s.schedule_hour_local ?? 6);
      }
    }
    // A site the planner leaves alone is not written at all: updated_at included.
    if (planned(s).schedule === want.schedule && s.paused_reason === want.pausedReason) {
      expect(got, `${s.id} untouched`).toEqual(s);
    }
  }
}

/** Insert the sites, read them back, and the planner's expectation for `effect`. */
async function prepare(
  account: string,
  sites: SiteRow[],
  effect: 'resume' | 'pause_others' | 'pause_over_limit',
  tier: 'free' | 'pro' | 'agency',
  limit: number,
) {
  await insertSites(account, sites);
  const before = await readSites(account);
  const plan = [...before.values()].map(planned);
  return { before, expected: applyChanges(plan, planSites(effect, plan, tier, limit)) };
}

describe('apply_entitlement_transition applies the site effects planSites plans', () => {
  it('resume (Free → Pro): agrees with planSites', async () => {
    await fc.assert(
      fc.asyncProperty(sitesArb, async (sites) => {
        const account = await newAccount(FREE);
        const { before, expected } = await prepare(account, sites, 'resume', 'pro', PRO.siteLimit);
        await transition(account, PRO);
        await expectAgreement(account, before, expected);
      }),
      { numRuns: 40 },
    );
  }, 120_000);

  it('pause_others (Pro → Free): agrees with planSites', async () => {
    await fc.assert(
      fc.asyncProperty(sitesArb, async (sites) => {
        const account = await newAccount(PRO);
        const { before, expected } = await prepare(
          account,
          sites,
          'pause_others',
          'free',
          FREE.siteLimit,
        );
        await transition(account, FREE);
        await expectAgreement(account, before, expected);
      }),
      { numRuns: 40 },
    );
  }, 120_000);

  it('pause_over_limit (Agency, site limit falls): agrees with planSites', async () => {
    await fc.assert(
      fc.asyncProperty(sitesArb, fc.integer({ min: 1, max: 9 }), async (sites, limit) => {
        const account = await newAccount(agency(10));
        const { before, expected } = await prepare(
          account,
          sites,
          'pause_over_limit',
          'agency',
          limit,
        );
        await transition(account, agency(limit));
        await expectAgreement(account, before, expected);
      }),
      { numRuns: 40 },
    );
  }, 120_000);

  it('resume (Agency, site limit rises): agrees with planSites', async () => {
    await fc.assert(
      fc.asyncProperty(sitesArb, fc.integer({ min: 1, max: 8 }), async (sites, limit) => {
        const account = await newAccount(agency(limit));
        const { before, expected } = await prepare(account, sites, 'resume', 'agency', limit + 1);
        await transition(account, agency(limit + 1));
        await expectAgreement(account, before, expected);
      }),
      { numRuns: 40 },
    );
  }, 120_000);
});

describe('apply_entitlement_transition site effects, computed by hand', () => {
  const at = (d: number) => new Date(BASE + d * DAY).toISOString();
  const row = (
    d: number,
    cadence: SiteRow['schedule_cadence'],
    reason: SiteRow['paused_reason'],
    extra: Partial<SiteRow> = {},
  ): SiteRow => ({
    id: randomUUID(),
    created_at: at(d),
    schedule_cadence: cadence,
    schedule_iso_weekday: cadence === null ? null : 2,
    schedule_hour_local: cadence === null ? null : 9,
    paused_reason: reason,
    ...extra,
  });
  const state = (r: SiteRow | undefined) => [
    r?.schedule_cadence,
    r?.schedule_iso_weekday,
    r?.schedule_hour_local,
    r?.paused_reason,
  ];

  it('Pro → Free: the oldest site goes monthly, the rest pause as trial_ended keeping their schedule', async () => {
    const account = await newAccount(PRO);
    const [a, b, c] = [row(0, 'weekly', null), row(1, 'weekly', null), row(2, 'monthly', null)];
    await insertSites(account, [a, b, c]);
    await transition(account, FREE);
    const s = await readSites(account);
    expect(state(s.get(a.id))).toEqual(['monthly', 2, 9, null]);
    expect(state(s.get(b.id))).toEqual(['weekly', 2, 9, 'trial_ended']);
    expect(state(s.get(c.id))).toEqual(['monthly', 2, 9, 'trial_ended']);
  });

  it('Pro → Free: a user-paused oldest site keeps the exception, so no site keeps a check', async () => {
    const account = await newAccount(PRO);
    const [a, b] = [row(0, 'weekly', 'user'), row(1, 'weekly', null)];
    await insertSites(account, [a, b]);
    await transition(account, FREE);
    const s = await readSites(account);
    expect(state(s.get(a.id))).toEqual(['weekly', 2, 9, 'user']);
    expect(state(s.get(b.id))).toEqual(['weekly', 2, 9, 'trial_ended']);
  });

  it('Free → Pro: paused sites start again weekly; an unscheduled one gets its creation weekday at 06:00 local', async () => {
    // 2026-10-20T02:00Z is Tuesday in UTC and Monday 22:00 in Indianapolis (EDT, UTC−4).
    const account = await newAccount(FREE, 'America/Indiana/Indianapolis');
    const a = row(0, 'monthly', null);
    const b = row(1, 'weekly', 'trial_ended');
    const c = row(0, null, 'trial_ended', { created_at: '2026-10-20T02:00:00.000Z' });
    await insertSites(account, [a, b, c]);
    await transition(account, PRO);
    const s = await readSites(account);
    expect(state(s.get(a.id))).toEqual(['weekly', 2, 9, null]);
    expect(state(s.get(b.id))).toEqual(['weekly', 2, 9, null]);
    expect(state(s.get(c.id))).toEqual(['weekly', 1, 6, null]);
  });

  it('Agency 10 → 3: the newest running sites beyond 3 pause as over_limit; an already-paused one keeps its reason', async () => {
    const account = await newAccount(agency(10));
    const sites = [
      row(0, 'weekly', null),
      row(1, 'weekly', null),
      row(2, 'weekly', null),
      row(3, 'weekly', null),
      row(4, 'weekly', 'trial_ended'),
    ];
    await insertSites(account, sites);
    await transition(account, agency(3));
    const s = await readSites(account);
    expect(sites.map((x) => s.get(x.id)!.paused_reason)).toEqual([
      null,
      null,
      null,
      'over_limit',
      'trial_ended',
    ]);
  });

  it('staging and removed sites are never touched, and do not count towards the order', async () => {
    const account = await newAccount(PRO);
    const prod = row(1, 'weekly', null);
    const staging = row(0, 'weekly', null, { staging_of_site_id: prod.id });
    const removed = row(0, 'weekly', null, { removed_at: at(3) });
    const second = row(2, 'weekly', null);
    await insertSites(account, [prod, staging, removed, second]);
    await transition(account, FREE);
    const s = await readSites(account);
    expect(state(s.get(staging.id))).toEqual(['weekly', 2, 9, null]);
    expect(state(s.get(removed.id))).toEqual(['weekly', 2, 9, null]);
    expect(state(s.get(prod.id))).toEqual(['monthly', 2, 9, null]);
    expect(state(s.get(second.id))).toEqual(['weekly', 2, 9, 'trial_ended']);
  });

  it('a transition that changes neither the tier nor the site limit leaves every site alone', async () => {
    const account = await newAccount(PRO);
    const sites = [row(0, 'weekly', null), row(1, 'weekly', 'trial_ended')];
    await insertSites(account, sites);
    const before = await readSites(account);
    const { rows } = await db.query<{ v: number }>(
      `select entitlement_version as v from public.accounts where id = $1`,
      [account],
    );
    await db.query(
      `select public.apply_entitlement_transition($1, $2, 'past_due', 'pro', 'pro', now(), null, null, null, null,
                                                  2, 5, 1, now(), 'sub_pro', null)`,
      [account, rows[0]!.v],
    );
    expect(await readSites(account)).toEqual(before);
  });

  it('a stale version changes no site', async () => {
    const account = await newAccount(PRO);
    const site = row(0, 'weekly', null);
    await insertSites(account, [site, row(1, 'weekly', null)]);
    await expect(
      db.query(
        `select public.apply_entitlement_transition($1, 999, 'free', 'free', null, null, null, null, null, null,
                                                    1, 1, 0, now(), null, null)`,
        [account],
      ),
    ).rejects.toThrow(/expected 999/);
    expect(state((await readSites(account)).get(site.id))).toEqual(['weekly', 2, 9, null]);
  });
  it('a creation-time tie is broken by id, in both orders the ids can take', async () => {
    for (const [first, second] of [
      ['00000000-0000-4000-8000-000000000001', 'ffffffff-ffff-4fff-bfff-fffffffffff1'],
      ['ffffffff-ffff-4fff-bfff-fffffffffff2', '00000000-0000-4000-8000-000000000002'],
    ] as const) {
      const account = await newAccount(PRO);
      await insertSites(account, [
        row(0, 'weekly', null, { id: first }),
        row(0, 'weekly', null, { id: second }),
      ]);
      await transition(account, FREE);
      const s = await readSites(account);
      const low = first < second ? first : second;
      const high = first < second ? second : first;
      expect([s.get(low)!.paused_reason, s.get(high)!.paused_reason]).toEqual([
        null,
        'trial_ended',
      ]);
    }
  });

  it('created_at is compared to the millisecond, as planSites compares Dates', async () => {
    // Same millisecond, 0.8 ms apart: the later-by-microseconds site has the lower id and keeps the check.
    const account = await newAccount(PRO);
    const early = row(0, 'weekly', null, {
      id: 'ffffffff-ffff-4fff-bfff-fffffffffff3',
      created_at: '2026-10-01T09:00:00.000100Z',
    });
    const late = row(0, 'weekly', null, {
      id: '00000000-0000-4000-8000-000000000003',
      created_at: '2026-10-01T09:00:00.000900Z',
    });
    await insertSites(account, [early, late]);
    await transition(account, FREE);
    const s = await readSites(account);
    expect([s.get(late.id)!.paused_reason, s.get(early.id)!.paused_reason]).toEqual([
      null,
      'trial_ended',
    ]);
    const plan = planSites('pause_others', [early, late].map(planned), 'free', 1);
    expect(plan).toEqual([
      { id: late.id, schedule: 'monthly', pausedReason: null },
      { id: early.id, schedule: null, pausedReason: 'trial_ended' },
    ]);
  });

  it('a site checked on deploy keeps its cadence through pause and resume', async () => {
    const account = await newAccount(PRO);
    const first = row(0, 'weekly', null);
    const deploy = row(1, 'on_deploy', null, {
      schedule_iso_weekday: null,
      schedule_hour_local: null,
    });
    await insertSites(account, [first, deploy]);
    await transition(account, FREE);
    expect(state((await readSites(account)).get(deploy.id))).toEqual([
      'on_deploy',
      null,
      null,
      'trial_ended',
    ]);
    await transition(account, PRO);
    expect(state((await readSites(account)).get(deploy.id))).toEqual([
      'on_deploy',
      null,
      null,
      null,
    ]);
  });

  it('an account time zone Postgres does not know falls back to UTC instead of failing the transition', async () => {
    const account = await newAccount(FREE, 'Mars/Olympus_Mons');
    const site = row(0, null, 'trial_ended', { created_at: '2026-10-20T02:00:00.000Z' }); // Tuesday in UTC
    await insertSites(account, [site]);
    await transition(account, PRO);
    expect(state((await readSites(account)).get(site.id))).toEqual(['weekly', 2, 6, null]);
  });
});
