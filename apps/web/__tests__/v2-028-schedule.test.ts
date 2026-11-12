import { randomUUID } from 'node:crypto';
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyAllMigrations, asRole, freshDb } from './helpers/pglite-migrations';
import { personalAccount, signUp } from './helpers/v2-check-tables';

/**
 * Migration 028, section B (docs/specs/v2/28-monitoring.md, D4): when a site falls due, the triggers
 * that keep sites.next_check_at, and the claim. Two ticks racing are scripts/db/monitoring-race.test.ts's.
 * Expected instants below are written out by hand from a calendar, not computed by the function under
 * test.
 */

let db: PGlite;

beforeAll(async () => {
  db = await freshDb();
  await applyAllMigrations(db);
}, 300_000);
afterAll(async () => db.close());

async function next(
  cadence: string | null,
  weekday: number | null,
  hour: number | null,
  offset: number | null,
  tz: string | null,
  after: string,
): Promise<string | null> {
  const { rows } = await db.query<{ v: Date | null }>(
    `select public.next_check_after($1, $2::smallint, $3::smallint, $4::smallint, $5, $6::timestamptz) v`,
    [cadence, weekday, hour, offset, tz, after],
  );
  return rows[0]!.v?.toISOString() ?? null;
}

describe('next_check_after: when a schedule falls due', () => {
  // 2026-11-13 is a Friday. ISO weekdays: 1 Monday … 7 Sunday.
  it.each([
    [
      'weekly, Monday 06:00 UTC, from a Friday',
      'weekly',
      1,
      6,
      0,
      'UTC',
      '2026-11-13T10:00:00Z',
      '2026-11-16T06:00:00.000Z',
    ],
    [
      'weekly, the same day before the time',
      'weekly',
      5,
      11,
      15,
      'UTC',
      '2026-11-13T10:00:00Z',
      '2026-11-13T11:15:00.000Z',
    ],
    [
      'weekly, the same day at the time: a week on',
      'weekly',
      5,
      10,
      0,
      'UTC',
      '2026-11-13T10:00:00Z',
      '2026-11-20T10:00:00.000Z',
    ],
    [
      'weekly in New York (UTC−5 in November)',
      'weekly',
      1,
      6,
      30,
      'America/New_York',
      '2026-11-13T10:00:00Z',
      '2026-11-16T11:30:00.000Z',
    ],
    [
      'weekly in Tokyo, where Monday 06:00 is Sunday 21:00 UTC',
      'weekly',
      1,
      6,
      0,
      'Asia/Tokyo',
      '2026-11-13T10:00:00Z',
      '2026-11-15T21:00:00.000Z',
    ],
    [
      'monthly, first Monday, from mid-November: December 7',
      'monthly',
      1,
      6,
      0,
      'UTC',
      '2026-11-13T10:00:00Z',
      '2026-12-07T06:00:00.000Z',
    ],
    [
      'monthly, first Friday: November 6 has passed, December 4',
      'monthly',
      5,
      9,
      0,
      'UTC',
      '2026-11-13T10:00:00Z',
      '2026-12-04T09:00:00.000Z',
    ],
    [
      'monthly, first Sunday, from October 31: November 1',
      'monthly',
      7,
      8,
      0,
      'UTC',
      '2026-10-31T23:00:00Z',
      '2026-11-01T08:00:00.000Z',
    ],
    [
      'an unknown zone reads as UTC',
      'weekly',
      1,
      6,
      0,
      'Mars/Olympus',
      '2026-11-13T10:00:00Z',
      '2026-11-16T06:00:00.000Z',
    ],
    [
      'a null zone reads as UTC',
      'weekly',
      1,
      6,
      0,
      null,
      '2026-11-13T10:00:00Z',
      '2026-11-16T06:00:00.000Z',
    ],
  ])('%s', async (_, cadence, wd, h, off, tz, after, want) => {
    expect(await next(cadence, wd as number, h as number, off as number, tz, after)).toBe(want);
  });

  it.each([
    ['on_deploy', 'on_deploy', 1, 6],
    ['no cadence', null, 1, 6],
    ['no weekday', 'weekly', null, 6],
    ['no hour', 'weekly', 1, null],
  ])('answers null for %s', async (_, cadence, wd, h) => {
    expect(await next(cadence, wd, h, 0, 'UTC', '2026-11-13T10:00:00Z')).toBeNull();
  });

  describe('daylight saving, at both transitions', () => {
    // US 2027: clocks go forward Sunday March 14 at 02:00 (EST→EDT) and back Sunday November 7 at 02:00.
    it('spring: a Sunday 02:30 New York schedule, which does not exist that day, runs at 03:30 EDT', async () => {
      expect(await next('weekly', 7, 2, 30, 'America/New_York', '2027-03-13T12:00:00Z')).toBe(
        '2027-03-14T07:30:00.000Z',
      );
    });
    it('spring: the week after, 02:30 EDT', async () => {
      expect(await next('weekly', 7, 2, 30, 'America/New_York', '2027-03-15T12:00:00Z')).toBe(
        '2027-03-21T06:30:00.000Z',
      );
    });
    it('autumn: a Sunday 01:30 New York schedule, which happens twice, runs once, at the later (EST) instant', async () => {
      expect(await next('weekly', 7, 1, 30, 'America/New_York', '2027-11-06T12:00:00Z')).toBe(
        '2027-11-07T06:30:00.000Z',
      );
    });
    it('autumn: from between the two 01:30s, the schedule is not run a second time that day', async () => {
      // 05:45Z is 01:45 EDT, after the first 01:30 (05:30Z) and before the second (06:30Z).
      const got = await next('weekly', 7, 1, 30, 'America/New_York', '2027-11-07T05:45:00Z');
      expect(['2027-11-07T06:30:00.000Z', '2027-11-14T06:30:00.000Z']).toContain(got);
    });
    // UK 2027: forward Sunday March 28 at 01:00 (GMT→BST), back Sunday October 31 at 02:00.
    it('London spring: Sunday 01:15 does not exist, runs at 02:15 BST', async () => {
      expect(await next('weekly', 7, 1, 15, 'Europe/London', '2027-03-27T12:00:00Z')).toBe(
        '2027-03-28T01:15:00.000Z',
      );
    });
    it('London autumn: Sunday 01:15 happens twice, runs at the later (GMT) instant', async () => {
      expect(await next('weekly', 7, 1, 15, 'Europe/London', '2027-10-30T12:00:00Z')).toBe(
        '2027-10-31T01:15:00.000Z',
      );
    });
    it('a Monday 06:00 schedule keeps its local hour across the change: UTC moves by an hour', async () => {
      expect(await next('weekly', 1, 6, 0, 'America/New_York', '2027-11-05T12:00:00Z')).toBe(
        '2027-11-08T11:00:00.000Z',
      );
      expect(await next('weekly', 1, 6, 0, 'America/New_York', '2027-10-29T12:00:00Z')).toBe(
        '2027-11-01T10:00:00.000Z',
      );
    });
  });
});

// ─── sites and accounts ─────────────────────────────────────────────────────────────────────────

async function account(tier: 'free' | 'pro' = 'pro', timezone = 'UTC') {
  const userId = await signUp(db, `sched-${randomUUID()}@example.com`);
  const { accountId } = await personalAccount(db, userId);
  await db.query(`update public.accounts set timezone = $2 where id = $1`, [accountId, timezone]);
  if (tier === 'pro') {
    await db.query(
      `update public.accounts
          set state = 'pro_trial', tier = 'pro', trial_variant = 'no_card',
              trial_ends_at = now() + interval '7 days', trial_used_at = now(),
              state_history = state_history || jsonb_build_array(
                jsonb_build_object('state', 'pro_trial', 'since', now()))
        where id = $1`,
      [accountId],
    );
  }
  return accountId;
}

interface SiteOpts {
  cadence?: string | null;
  weekday?: number | null;
  hour?: number | null;
  offset?: number | null;
  created?: string;
}

async function site(accountId: string | null, o: SiteOpts = {}): Promise<string> {
  const id = randomUUID();
  const cadence = o.cadence === undefined ? 'weekly' : o.cadence;
  const timed = cadence === 'weekly' || cadence === 'monthly';
  await db.query(
    `insert into public.sites (id, account_id, host, schedule_cadence, schedule_iso_weekday,
                               schedule_hour_local, schedule_offset_min, created_at)
     values ($1, $2, $3, $4, $5, $6, $7, coalesce($8::timestamptz, now()))`,
    [
      id,
      accountId,
      `${id.slice(0, 8)}.example`,
      accountId === null ? null : cadence,
      accountId !== null && timed ? (o.weekday ?? 1) : null,
      accountId !== null && timed ? (o.hour ?? 6) : null,
      o.offset ?? null,
      o.created ?? null,
    ],
  );
  return id;
}

const siteRow = async (id: string) =>
  (
    await db.query<{ next_check_at: Date | null; schedule_offset_min: number | null }>(
      `select next_check_at, schedule_offset_min from public.sites where id = $1`,
      [id],
    )
  ).rows[0]!;

describe('the triggers that keep next_check_at', () => {
  it('sets it when a kept site is written with a schedule, and fills the minute from the site id', async () => {
    const id = await site(await account());
    const r = await siteRow(id);
    expect(r.next_check_at).not.toBeNull();
    expect(r.schedule_offset_min).toBeGreaterThanOrEqual(0);
    expect(r.schedule_offset_min).toBeLessThan(60);
    expect(r.next_check_at!.getUTCDay()).toBe(1);
    expect(r.next_check_at!.getUTCHours()).toBe(6);
    expect(r.next_check_at!.getUTCMinutes()).toBe(r.schedule_offset_min);
    expect(r.next_check_at!.getTime()).toBeGreaterThan(Date.now());
  });

  it('keeps a given minute', async () => {
    const r = await siteRow(await site(await account(), { offset: 42 }));
    expect(r.schedule_offset_min).toBe(42);
    expect(r.next_check_at!.getUTCMinutes()).toBe(42);
  });

  it.each([
    ['an unkept site', null, {}],
    ['on_deploy', 'acct', { cadence: 'on_deploy' }],
    ['no schedule', 'acct', { cadence: null }],
  ] as const)('leaves it null for %s', async (_, who, o) => {
    const id = await site(who === null ? null : await account(), o);
    expect((await siteRow(id)).next_check_at).toBeNull();
  });

  it('recomputes it when the schedule changes, and clears it when the site is removed', async () => {
    const id = await site(await account(), { weekday: 1 });
    await db.query(`update public.sites set schedule_iso_weekday = 3 where id = $1`, [id]);
    expect((await siteRow(id)).next_check_at!.getUTCDay()).toBe(3);
    await db.query(`update public.sites set removed_at = now() where id = $1`, [id]);
    expect((await siteRow(id)).next_check_at).toBeNull();
  });

  it('leaves a value another writer set when no schedule column changes', async () => {
    const id = await site(await account());
    await db.query(`update public.sites set next_check_at = '2030-01-01T00:00:00Z' where id = $1`, [
      id,
    ]);
    await db.query(`update public.sites set client_name = 'x' where id = $1`, [id]);
    expect((await siteRow(id)).next_check_at!.toISOString()).toBe('2030-01-01T00:00:00.000Z');
  });

  it('moves the next check when the account’s zone changes', async () => {
    const acc = await account('pro', 'UTC');
    const id = await site(acc, { weekday: 1, hour: 6, offset: 0 });
    expect((await siteRow(id)).next_check_at!.getUTCHours()).toBe(6);
    await db.query(`update public.accounts set timezone = 'Asia/Tokyo' where id = $1`, [acc]);
    expect((await siteRow(id)).next_check_at!.getUTCHours()).toBe(21);
  });
});

// ─── the claim ──────────────────────────────────────────────────────────────────────────────────

interface Slot {
  bucket: string;
  window_start: string;
  limit: number;
}
const slot = (limit = 1000): Slot => ({
  bucket: `test:${randomUUID()}`,
  window_start: '2026-11-13T00:00:00.000Z',
  limit,
});
const countOf = async (s: Slot) =>
  (
    await db.query<{ request_count: number }>(
      `select request_count from public.rate_limits where bucket_key = $1 and window_start = $2`,
      [s.bucket, s.window_start],
    )
  ).rows[0]?.request_count ?? 0;

/** Every site in this database falls due before `due`; each case sets its own sites due. */
async function makeDue(id: string, at = '2026-11-01T06:00:00Z') {
  await db.query(`update public.sites set next_check_at = $2 where id = $1`, [id, at]);
}

async function claim(now: string, limit: number, s: Slot) {
  return asRole(db, 'service_role', null, async (tx) => {
    const { rows } = await tx.query<{
      site_id: string;
      account_id: string;
      slot: Date;
      next_at: Date;
    }>(
      `select * from public.claim_due_sites($1, $2, $3)`,
      [now, limit, JSON.stringify(s)],
    );
    return rows;
  });
}

const NOW = '2026-11-13T10:00:00.000Z';

/** Sites made due by one case are claimed by it; this clears any left over before the next case. */
async function settle() {
  await db.query(`update public.sites set next_check_at = '2099-01-01' where next_check_at <= $1`, [
    NOW,
  ]);
}

describe('claim_due_sites', () => {
  it('claims a due site once, with the slot it was due at, and moves next_check_at past now', async () => {
    await settle();
    const acc = await account();
    const id = await site(acc, { weekday: 1, hour: 6, offset: 0 });
    await makeDue(id, '2026-11-09T06:00:00Z');
    const s = slot();
    const got = await claim(NOW, 50, s);
    expect(
      got.map((r) => [r.site_id, r.account_id, r.slot.toISOString(), r.next_at.toISOString()]),
    ).toEqual([[id, acc, '2026-11-09T06:00:00.000Z', '2026-11-16T06:00:00.000Z']]);
    expect((await siteRow(id)).next_check_at!.toISOString()).toBe('2026-11-16T06:00:00.000Z');
    expect(await countOf(s)).toBe(1);
    expect(await claim(NOW, 50, s)).toEqual([]);
  });

  it('moves a site overdue for weeks to the first time after now, not one cadence on', async () => {
    await settle();
    const id = await site(await account(), { weekday: 1, hour: 6, offset: 0 });
    await makeDue(id, '2026-09-07T06:00:00Z');
    await claim(NOW, 50, slot());
    expect((await siteRow(id)).next_check_at!.toISOString()).toBe('2026-11-16T06:00:00.000Z');
  });

  it.each([
    [
      'removed',
      `update public.sites set removed_at = now(), next_check_at = '2026-11-01' where id = $1`,
    ],
    ['paused', `update public.sites set paused_reason = 'user' where id = $1`],
    [
      'of an account marked for deletion',
      `update public.accounts set deletion_confirmed_at = now() - interval '1 hour',
              purge_after = now() + interval '7 days'
        where id = (select account_id from public.sites where id = $1)`,
    ],
    [
      'of a deleted account',
      `update public.accounts set deleted_at = now() where id = (select account_id from public.sites where id = $1)`,
    ],
  ])('does not claim a site %s, and takes no slot for it', async (_, sql) => {
    await settle();
    const id = await site(await account());
    await makeDue(id);
    await db.query(sql, [id]);
    const s = slot();
    expect(await claim(NOW, 50, s)).toEqual([]);
    expect(await countOf(s)).toBe(0);
  });

  it('claims a Free account’s first site, not its second, and moves the first a month on', async () => {
    await settle();
    const acc = await account('free');
    const first = await site(acc, {
      weekday: 1,
      hour: 6,
      offset: 0,
      created: '2026-10-01T00:00:00Z',
    });
    const second = await site(acc, {
      weekday: 1,
      hour: 6,
      offset: 0,
      created: '2026-10-02T00:00:00Z',
    });
    await makeDue(first, '2026-11-09T06:00:00Z');
    await makeDue(second, '2026-11-09T06:00:00Z');
    const got = await claim(NOW, 50, slot());
    expect(got.map((r) => r.site_id)).toEqual([first]);
    // Its saved cadence is weekly; on Free it runs monthly: the first Monday of December.
    expect((await siteRow(first)).next_check_at!.toISOString()).toBe('2026-12-07T06:00:00.000Z');
    expect((await siteRow(second)).next_check_at!.toISOString()).toBe('2026-11-09T06:00:00.000Z');
  });

  it('reads the first site as the transition does: a removed first site makes the next one first', async () => {
    await settle();
    const acc = await account('free');
    const a = await site(acc, { created: '2026-10-01T00:00:00Z' });
    const b = await site(acc, { created: '2026-10-02T00:00:00Z' });
    await db.query(`update public.sites set removed_at = now() where id = $1`, [a]);
    await makeDue(b);
    expect((await claim(NOW, 50, slot())).map((r) => r.site_id)).toEqual([b]);
  });

  it('claims every due site of a paid account', async () => {
    await settle();
    const acc = await account('pro');
    const ids = [await site(acc), await site(acc), await site(acc)];
    for (const id of ids) await makeDue(id);
    expect((await claim(NOW, 50, slot())).map((r) => r.site_id).sort()).toEqual([...ids].sort());
  });

  it('claims at most p_limit, oldest due first', async () => {
    await settle();
    const acc = await account('pro');
    const old = await site(acc);
    const newer = await site(acc);
    await makeDue(old, '2026-11-01T00:00:00Z');
    await makeDue(newer, '2026-11-02T00:00:00Z');
    expect((await claim(NOW, 1, slot())).map((r) => r.site_id)).toEqual([old]);
    expect((await claim(NOW, 1, slot())).map((r) => r.site_id)).toEqual([newer]);
  });

  it('with no global slot left, claims nothing, takes nothing, and the site stays due', async () => {
    await settle();
    const id = await site(await account());
    await makeDue(id, '2026-11-09T06:00:00Z');
    const full = slot(1);
    await db.query(
      `insert into public.rate_limits (bucket_key, window_start, request_count) values ($1, $2, 1)`,
      [full.bucket, full.window_start],
    );
    expect(await claim(NOW, 50, full)).toEqual([]);
    expect(await countOf(full)).toBe(1);
    expect((await siteRow(id)).next_check_at!.toISOString()).toBe('2026-11-09T06:00:00.000Z');
  });

  it('stops at the slot that runs out: the sites claimed before it keep theirs, the rest stay due', async () => {
    await settle();
    const acc = await account('pro');
    const a = await site(acc);
    const b = await site(acc);
    await makeDue(a, '2026-11-01T00:00:00Z');
    await makeDue(b, '2026-11-02T00:00:00Z');
    const s = slot(1);
    expect((await claim(NOW, 50, s)).map((r) => r.site_id)).toEqual([a]);
    expect(await countOf(s)).toBe(1);
    expect((await siteRow(b)).next_check_at!.toISOString()).toBe('2026-11-02T00:00:00.000Z');
  });

  it('refuses a missing time and a limit outside 1–500', async () => {
    await expect(claim(NOW, 0, slot())).rejects.toThrow(/p_limit/);
    await expect(claim(NOW, 501, slot())).rejects.toThrow(/p_limit/);
  });
});

describe('account_effective_tier', () => {
  it('reads a no-card trial as Free from its end, and past_due as its tier for 168 hours', async () => {
    const acc = await account('pro');
    const tier = async (at: string) =>
      (await db.query<{ t: string }>(`select public.account_effective_tier($1, $2) t`, [acc, at]))
        .rows[0]!.t;
    const { rows } = await db.query<{ e: Date }>(
      `select trial_ends_at e from public.accounts where id = $1`,
      [acc],
    );
    const end = rows[0]!.e.getTime();
    expect(await tier(new Date(end - 1000).toISOString())).toBe('pro');
    expect(await tier(new Date(end).toISOString())).toBe('free');
  });
});

describe('release_scheduled_claim (owner ruling Q9)', () => {
  const release = (site: string, at: string, claimedNext: string, s: Slot, now = NOW) =>
    asRole(
      db,
      'service_role',
      null,
      async (tx) =>
        (
          await tx.query<{ r: { restored: boolean; slot_released: boolean } }>(
            `select public.release_scheduled_claim($1, $2, $3, $4, $5) r`,
            [site, at, claimedNext, JSON.stringify(s), now],
          )
        ).rows[0]!.r,
    );
  // Monday 2026-11-09 06:00 claimed at NOW moves to the Monday after.
  const CLAIMED_NEXT = '2026-11-16T06:00:00.000Z';

  it('after a request that never ran: the site is due again on the next tick and the slot count is back', async () => {
    await settle();
    const id = await site(await account(), { weekday: 1, hour: 6, offset: 0 });
    await makeDue(id, '2026-11-09T06:00:00Z');
    const s = slot();
    const [claimed] = await claim(NOW, 50, s);
    expect(await countOf(s)).toBe(1);
    expect(await release(id, claimed!.slot.toISOString(), claimed!.next_at.toISOString(), s)).toEqual({
      restored: true,
      slot_released: true,
    });
    expect(await countOf(s)).toBe(0);
    expect((await siteRow(id)).next_check_at!.toISOString()).toBe('2026-11-09T06:00:00.000Z');
    expect((await claim(NOW, 50, s)).map((r) => r.site_id)).toEqual([id]);
  });

  it('gives back one slot when called twice', async () => {
    await settle();
    const id = await site(await account(), { weekday: 1, hour: 6, offset: 0 });
    await makeDue(id, '2026-11-09T06:00:00Z');
    const s = slot();
    await claim(NOW, 50, s);
    await db.query(
      `update public.rate_limits set request_count = 5 where bucket_key = $1 and window_start = $2`,
      [s.bucket, s.window_start],
    );
    await release(id, '2026-11-09T06:00:00Z', CLAIMED_NEXT, s);
    expect(await release(id, '2026-11-09T06:00:00Z', CLAIMED_NEXT, s)).toEqual({
      restored: false,
      slot_released: false,
    });
    expect(await countOf(s)).toBe(4);
  });

  it('restores the due time but keeps the count once the slot’s day has ended', async () => {
    await settle();
    const id = await site(await account(), { weekday: 1, hour: 6, offset: 0 });
    await makeDue(id, '2026-11-09T06:00:00Z');
    const s = slot();
    await claim(NOW, 50, s);
    expect(
      await release(id, '2026-11-09T06:00:00Z', CLAIMED_NEXT, s, '2026-11-14T00:00:00.000Z'),
    ).toEqual({
      restored: true,
      slot_released: false,
    });
    expect(await countOf(s)).toBe(1);
  });

  it('leaves a site whose next_check_at is before the slot it is told of', async () => {
    await settle();
    const id = await site(await account());
    await makeDue(id, '2026-11-20T06:00:00Z');
    const s = slot();
    expect(await release(id, '2026-11-25T06:00:00Z', '2026-12-02T06:00:00Z', s)).toEqual({
      restored: false,
      slot_released: false,
    });
    expect((await siteRow(id)).next_check_at!.toISOString()).toBe('2026-11-20T06:00:00.000Z');
  });

  it('leaves a schedule saved since the claim as it was saved, and the slot spent', async () => {
    await settle();
    const id = await site(await account(), { weekday: 1, hour: 6, offset: 0 });
    await makeDue(id, '2026-11-09T06:00:00Z');
    const s = slot();
    const [claimed] = await claim(NOW, 50, s);
    expect(claimed!.next_at.toISOString()).toBe(CLAIMED_NEXT);
    // The member moves the check to Wednesdays: the trigger computes a time later than the slot.
    await db.query(`update public.sites set schedule_iso_weekday = 3 where id = $1`, [id]);
    const saved = (await siteRow(id)).next_check_at!.toISOString();
    expect(Date.parse(saved)).toBeGreaterThan(Date.parse('2026-11-09T06:00:00Z'));
    expect(saved).not.toBe(CLAIMED_NEXT);
    expect(await release(id, claimed!.slot.toISOString(), CLAIMED_NEXT, s)).toEqual({
      restored: false,
      slot_released: false,
    });
    expect((await siteRow(id)).next_check_at!.toISOString()).toBe(saved);
    expect(await countOf(s)).toBe(1);
  });

  it('leaves a site removed since the claim removed, and the slot spent', async () => {
    await settle();
    const id = await site(await account(), { weekday: 1, hour: 6, offset: 0 });
    await makeDue(id, '2026-11-09T06:00:00Z');
    const s = slot();
    const [claimed] = await claim(NOW, 50, s);
    await db.query(`update public.sites set removed_at = now() where id = $1`, [id]);
    expect(await release(id, claimed!.slot.toISOString(), CLAIMED_NEXT, s)).toEqual({
      restored: false,
      slot_released: false,
    });
    expect((await siteRow(id)).next_check_at).toBeNull();
    expect(await countOf(s)).toBe(1);
  });

  it('refuses a call without the claimed next time', async () => {
    await expect(
      asRole(db, 'service_role', null, (tx) =>
        tx.query(`select public.release_scheduled_claim($1, $2, null, $3, $4)`, [
          randomUUID(),
          '2026-11-09T06:00:00Z',
          JSON.stringify(slot()),
          NOW,
        ]),
      ),
    ).rejects.toThrow(/claimed next time/);
  });
});
