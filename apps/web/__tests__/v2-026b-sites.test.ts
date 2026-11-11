import { randomUUID } from 'node:crypto';
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  applyAllMigrations,
  asRole,
  freshDb,
  readMigration,
  readRollback,
} from './helpers/pglite-migrations';
import { personalAccount, signUp } from './helpers/v2-check-tables';

/**
 * Migration 20261112000001, section A (CC-26b D4, D6): request_capped_check, add_site, edit_site and
 * remove_site, on PGlite with every migration applied in order.
 *
 * PGlite has one backend, so two calls here run one after the other: each case shows what a call
 * answers given what the calls before it committed. Two calls racing in real transactions are
 * scripts/db/sites-race.test.ts.
 */

const MIGRATION = '20261112000001_v2_026b_sites_fixes.sql';
const ROLLBACK = '20261112000001_v2_026b_sites_fixes.revert.sql';
const FUNCTIONS = ['add_site', 'edit_site', 'remove_site', 'request_capped_check'];
const HELPERS = ['take_rate_slot'];

let db: PGlite;
beforeAll(async () => {
  db = await freshDb();
  await applyAllMigrations(db);
}, 300_000);
afterAll(async () => {
  await db?.close();
});

type Answer = Record<string, unknown> & { outcome: string };

/** Calls a section-A function as the service role, as the routes' admin client does. */
async function call(fn: string, args: unknown[]): Promise<Answer> {
  const placeholders = args.map((_, i) => `$${i + 1}`).join(', ');
  const { rows } = await asRole(db, 'service_role', null, (tx) =>
    tx.query<{ r: Answer }>(
      `select public.${fn}(${placeholders}) as r`,
      args.map((a) => (a !== null && typeof a === 'object' ? JSON.stringify(a) : a)),
    ),
  );
  return rows[0]!.r;
}

async function account(): Promise<{ accountId: string; seatId: string }> {
  return personalAccount(db, await signUp(db, `sites-${randomUUID()}@example.com`));
}

async function site(
  accountId: string,
  extra: Partial<Record<'staging_of_site_id' | 'paused_reason' | 'removed_at', string>> = {},
): Promise<string> {
  const id = randomUUID();
  await db.query(
    `insert into public.sites (id, account_id, host, staging_of_site_id, paused_reason, removed_at)
     values ($1, $2, $3, $4, $5, $6)`,
    [
      id,
      accountId,
      `${id.slice(0, 8)}.example`,
      extra.staging_of_site_id ?? null,
      extra.paused_reason ?? null,
      extra.removed_at ?? null,
    ],
  );
  return id;
}

/** A check row as requestCheck passes it to insertQueued. */
function row(siteId: string, trigger = 'manual', id = randomUUID()) {
  const at = new Date().toISOString();
  return {
    id,
    site_id: siteId,
    trigger,
    grade_version: '2.0.0',
    queued_at: at,
    heartbeat_at: at,
    expires_at: null,
  };
}

/** A check of the site that was queued `hoursAgo` hours ago and has since finished. */
async function pastCheck(siteId: string, trigger: string, hoursAgo: number): Promise<Date> {
  const { rows } = await db.query<{ queued_at: Date }>(
    `insert into public.checks (id, site_id, status, trigger, grade_version, queued_at, started_at,
                                finished_at, failure_reason)
     values ($1, $2, 'failed', $3, '2.0.0', now() - make_interval(hours => $4),
             now() - make_interval(hours => $4), now() - make_interval(hours => $4), 'internal')
     returning queued_at`,
    [randomUUID(), siteId, trigger, hoursAgo],
  );
  return rows[0]!.queued_at;
}

const checksOf = async (siteId: string) =>
  (
    await db.query<{ id: string; status: string; trigger: string }>(
      `select id, status, trigger from public.checks where site_id = $1 order by queued_at`,
      [siteId],
    )
  ).rows;

const plusDay = (d: Date) => new Date(d.getTime() + 24 * 3600 * 1000).toISOString();

interface Slot {
  bucket: string;
  window_start: string;
  limit: number;
}

/** A rate-limit slot in a bucket of its own, so one case's count never reaches another's. */
const slot = (limit = 1000, bucket = `test:${randomUUID()}`): Slot => ({
  bucket,
  window_start: '2026-11-10T00:00:00.000Z',
  limit,
});

const countOf = async (s: Slot) =>
  (
    await db.query<{ request_count: number }>(
      `select request_count from public.rate_limits where bucket_key = $1 and window_start = $2`,
      [s.bucket, s.window_start],
    )
  ).rows[0]?.request_count ?? 0;

/** Fills a bucket to `n` starts, as earlier requests would have. */
const fill = (s: Slot, n: number) =>
  db.query(
    `insert into public.rate_limits (bucket_key, window_start, request_count) values ($1, $2, $3)`,
    [s.bucket, s.window_start, n],
  );

describe('request_capped_check', () => {
  it('records a re-check below the cap as a queued check, exactly as given', async () => {
    const { accountId } = await account();
    const s = await site(accountId);
    const r = row(s);
    expect(await call('request_capped_check', [r, 2, slot()])).toEqual({ outcome: 'created' });
    const { rows } = await db.query<Record<string, unknown>>(
      `select id, site_id, status, trigger, grade_version, queued_at, heartbeat_at, expires_at
         from public.checks where id = $1`,
      [r.id],
    );
    expect(rows).toEqual([
      {
        ...r,
        status: 'queued',
        queued_at: new Date(r.queued_at),
        heartbeat_at: new Date(r.heartbeat_at),
      },
    ]);
  });

  it('caps the third Free re-check in 24 hours, manual and fix_recheck together, and says when the next is allowed', async () => {
    const { accountId } = await account();
    const s = await site(accountId);
    const oldest = await pastCheck(s, 'manual', 5);
    await pastCheck(s, 'fix_recheck', 1);
    const r = row(s);
    expect(await call('request_capped_check', [r, 2, slot()])).toEqual({
      outcome: 'capped',
      next_allowed_at: plusDay(oldest),
    });
    expect((await checksOf(s)).map((c) => c.id)).not.toContain(r.id);
  });

  it('counts only manual and fix_recheck checks of this site queued in the last 24 hours', async () => {
    const { accountId } = await account();
    const s = await site(accountId);
    const other = await site(accountId);
    await pastCheck(s, 'manual', 25);
    await pastCheck(s, 'first_audit', 1);
    await pastCheck(s, 'scheduled', 1);
    await pastCheck(other, 'manual', 1);
    await pastCheck(other, 'manual', 1);
    await pastCheck(s, 'manual', 2);
    expect((await call('request_capped_check', [row(s), 2, slot()])).outcome).toBe('created');
    expect((await call('request_capped_check', [row(s), 2, slot()])).outcome).toBe('capped');
  });

  it('over a lowered cap, the next is allowed when enough counted checks have left the window', async () => {
    const { accountId } = await account();
    const s = await site(accountId);
    await pastCheck(s, 'manual', 20);
    const second = await pastCheck(s, 'manual', 10);
    await pastCheck(s, 'manual', 1);
    // Three counted at a cap of two: the oldest two must leave before one more fits.
    expect(await call('request_capped_check', [row(s), 2, slot()])).toEqual({
      outcome: 'capped',
      next_allowed_at: plusDay(second),
    });
  });

  it('a repeat inside the bucket is exists with its status, and is not counted again', async () => {
    const { accountId } = await account();
    const s = await site(accountId);
    const r = row(s);
    expect((await call('request_capped_check', [r, 2, slot()])).outcome).toBe('created');
    expect(await call('request_capped_check', [r, 2, slot()])).toEqual({
      outcome: 'exists',
      status: 'queued',
    });
    expect(await checksOf(s)).toHaveLength(1);
    expect((await call('request_capped_check', [row(s), 2, slot()])).outcome).toBe('created');
  });

  it('at the cap, the retry of the cap-th request is exists, not capped', async () => {
    const { accountId } = await account();
    const s = await site(accountId);
    await pastCheck(s, 'manual', 3);
    const capth = row(s);
    expect((await call('request_capped_check', [capth, 2, slot()])).outcome).toBe('created');
    expect(await call('request_capped_check', [capth, 2, slot()])).toEqual({
      outcome: 'exists',
      status: 'queued',
    });
    expect((await call('request_capped_check', [row(s), 2, slot()])).outcome).toBe('capped');
  });

  it('exists reports a bucket check that has started', async () => {
    const { accountId } = await account();
    const s = await site(accountId);
    const r = row(s);
    await call('request_capped_check', [r, 2, slot()]);
    await db.query(`select public.claim_check($1, 'run-1', '{"phase":"crawl"}'::jsonb)`, [r.id]);
    expect(await call('request_capped_check', [r, 2, slot()])).toEqual({
      outcome: 'exists',
      status: 'running',
    });
  });

  it('refuses a removed site and a paused one, writing nothing', async () => {
    const { accountId } = await account();
    const removed = await site(accountId, { removed_at: new Date().toISOString() });
    const paused = await site(accountId, { paused_reason: 'over_limit' });
    expect(await call('request_capped_check', [row(removed), 2, slot()])).toEqual({
      outcome: 'removed',
    });
    expect(await call('request_capped_check', [row(paused), 2, slot()])).toEqual({
      outcome: 'paused',
      paused_reason: 'over_limit',
    });
    expect(await checksOf(removed)).toEqual([]);
    expect(await checksOf(paused)).toEqual([]);
  });

  it('refuses a row that is not the one requestCheck writes, before any lock', async () => {
    const { accountId } = await account();
    const s = await site(accountId);
    const bad = [
      { ...row(s), status: 'running' },
      (({ heartbeat_at: _h, ...rest }) => rest)(row(s)),
      row(s, 'first_audit'),
      row(s, 'scheduled'),
      { ...row(s), trigger: null },
    ];
    for (const b of bad) {
      await expect(
        call('request_capped_check', [b, 2, slot()]),
        JSON.stringify(b),
      ).rejects.toMatchObject({
        code: '22023',
      });
    }
    await expect(call('request_capped_check', [row(s), 0, slot()])).rejects.toMatchObject({
      code: '22023',
    });
    expect(await checksOf(s)).toEqual([]);
  });

  it('a created re-check takes one slot of the daily ceiling; a refused one takes none', async () => {
    const { accountId } = await account();
    const s = await site(accountId);
    const g = slot();
    const r = row(s);
    expect(await call('request_capped_check', [r, 1, g])).toEqual({ outcome: 'created' });
    expect(await countOf(g)).toBe(1);
    expect((await call('request_capped_check', [r, 1, g])).outcome).toBe('exists');
    expect((await call('request_capped_check', [row(s), 1, g])).outcome).toBe('capped');
    const removed = await site(accountId, { removed_at: new Date().toISOString() });
    const paused = await site(accountId, { paused_reason: 'user' });
    expect((await call('request_capped_check', [row(removed), 1, g])).outcome).toBe('removed');
    expect((await call('request_capped_check', [row(paused), 1, g])).outcome).toBe('paused');
    expect(await countOf(g)).toBe(1);
  });

  it('at the daily ceiling: capacity, no row, and the count is left as it was', async () => {
    const { accountId } = await account();
    const s = await site(accountId);
    const g = slot(3);
    await fill(g, 3);
    const r = row(s);
    expect(await call('request_capped_check', [r, 2, g])).toEqual({ outcome: 'capacity' });
    expect(await checksOf(s)).toEqual([]);
    expect(await countOf(g)).toBe(3);
    // One slot left: the request takes it.
    await db.query(`update public.rate_limits set request_count = 2 where bucket_key = $1`, [
      g.bucket,
    ]);
    expect(await call('request_capped_check', [r, 2, g])).toEqual({ outcome: 'created' });
    expect(await countOf(g)).toBe(3);
  });

  it('refuses a slot that is not {bucket, window_start, limit}', async () => {
    const { accountId } = await account();
    const s = await site(accountId);
    for (const g of [
      null,
      { bucket: 'x', window_start: '2026-11-10T00:00:00Z' },
      { ...slot(), extra: 1 },
      { ...slot(), limit: 0 },
      { ...slot(), limit: '5' },
    ]) {
      await expect(
        call('request_capped_check', [row(s), 2, g]),
        JSON.stringify(g),
      ).rejects.toMatchObject({ code: '22023' });
    }
    expect(await checksOf(s)).toEqual([]);
  });

  it('refuses a site no account keeps', async () => {
    const id = randomUUID();
    await db.query(`insert into public.sites (id, host) values ($1, $2)`, [id, `${id}.example`]);
    await expect(call('request_capped_check', [row(id), 2, slot()])).rejects.toMatchObject({
      code: 'P0002',
    });
  });
});

/** A site row as the add-site route passes it. */
function newSite(accountId: string, seatId: string, host = `${randomUUID().slice(0, 8)}.example`) {
  return {
    id: randomUUID(),
    account_id: accountId,
    host,
    owner_seat_id: seatId,
    schedule_cadence: 'monthly',
    schedule_iso_weekday: 2,
    schedule_hour_local: 6,
  };
}

const add = (
  s: ReturnType<typeof newSite>,
  limit: number,
  check = row(s.id, 'first_audit'),
  global = slot(),
  domain: Slot | null = null,
) => call('add_site', [s, check, limit, global, domain]);

const liveSites = async (accountId: string) =>
  (
    await db.query<{ id: string }>(
      `select id from public.sites where account_id = $1 and removed_at is null`,
      [accountId],
    )
  ).rows.map((r) => r.id);

describe('add_site', () => {
  it('inserts the site and its queued first_audit check together, and counts the live primary sites', async () => {
    const { accountId, seatId } = await account();
    const s = newSite(accountId, seatId);
    const check = row(s.id, 'first_audit');
    expect(await add(s, 1, check)).toEqual({
      outcome: 'created',
      site_id: s.id,
      check_id: check.id,
      n: 1,
    });
    const { rows } = await db.query<Record<string, unknown>>(
      `select id, account_id, host, owner_seat_id, schedule_cadence, schedule_iso_weekday,
              schedule_hour_local, staging_of_site_id, removed_at, next_check_at
         from public.sites where id = $1`,
      [s.id],
    );
    expect(rows).toEqual([
      { ...s, staging_of_site_id: null, removed_at: null, next_check_at: null },
    ]);
    expect(await checksOf(s.id)).toEqual([
      { id: check.id, status: 'queued', trigger: 'first_audit' },
    ]);
  });

  it('is full at the limit, and a staging site holds no slot', async () => {
    const { accountId, seatId } = await account();
    const primary = await site(accountId);
    await site(accountId, { staging_of_site_id: primary });
    const second = newSite(accountId, seatId);
    expect(await add(second, 2)).toMatchObject({ outcome: 'created', n: 2 });
    const third = newSite(accountId, seatId);
    expect(await add(third, 2)).toEqual({ outcome: 'full' });
    expect(await liveSites(accountId)).not.toContain(third.id);
    expect(await checksOf(third.id)).toEqual([]);
  });

  it('a removed site frees its slot', async () => {
    const { accountId, seatId } = await account();
    await site(accountId, { removed_at: new Date().toISOString() });
    expect((await add(newSite(accountId, seatId), 1)).outcome).toBe('created');
  });

  it('is exists for a host the account already keeps live, and a removed host is added again as a new site', async () => {
    const { accountId, seatId } = await account();
    const first = newSite(accountId, seatId, 'kept.example');
    expect((await add(first, 5)).outcome).toBe('created');
    expect(await add(newSite(accountId, seatId, 'kept.example'), 5)).toEqual({
      outcome: 'exists',
      site_id: first.id,
    });
    await db.query(`update public.sites set removed_at = now() where id = $1`, [first.id]);
    const again = newSite(accountId, seatId, 'kept.example');
    expect(await add(again, 5)).toMatchObject({ outcome: 'created', site_id: again.id });
    expect(await checksOf(first.id)).toHaveLength(1);
  });

  it('bounds adds per day: first audits of the account in 24 hours at the limit are adds_capped (Q14)', async () => {
    const { accountId, seatId } = await account();
    const first = newSite(accountId, seatId);
    expect((await add(first, 1)).outcome).toBe('created');
    const { rows } = await db.query<{ queued_at: Date }>(
      `select queued_at from public.checks where site_id = $1`,
      [first.id],
    );
    await db.query(`update public.sites set removed_at = now() where id = $1`, [first.id]);
    const second = newSite(accountId, seatId);
    expect(await add(second, 1)).toEqual({
      outcome: 'adds_capped',
      next_allowed_at: plusDay(rows[0]!.queued_at),
    });
    expect(await liveSites(accountId)).toEqual([]);
  });

  it('counts only first audits queued in the last 24 hours, of this account', async () => {
    const { accountId, seatId } = await account();
    const other = await account();
    const removed = await site(accountId, { removed_at: new Date().toISOString() });
    await pastCheck(removed, 'first_audit', 25);
    await pastCheck(removed, 'manual', 1);
    await pastCheck(await site(other.accountId), 'first_audit', 1);
    expect((await add(newSite(accountId, seatId), 1)).outcome).toBe('created');
  });

  it('a created site takes one slot of its domain bucket and of the daily ceiling; a refusal takes none', async () => {
    const { accountId, seatId } = await account();
    const g = slot();
    const d = slot(5);
    const first = newSite(accountId, seatId);
    expect((await add(first, 1, undefined, g, d)).outcome).toBe('created');
    expect([await countOf(g), await countOf(d)]).toEqual([1, 1]);
    expect((await add(newSite(accountId, seatId, first.host), 1, undefined, g, d)).outcome).toBe(
      'exists',
    );
    expect((await add(newSite(accountId, seatId), 1, undefined, g, d)).outcome).toBe('full');
    expect([await countOf(g), await countOf(d)]).toEqual([1, 1]);
  });

  it('a full domain bucket is domain_capped: nothing written, the ceiling not counted', async () => {
    const { accountId, seatId } = await account();
    const g = slot();
    const d = slot(5);
    await fill(d, 5);
    const s = newSite(accountId, seatId);
    expect(await add(s, 1, undefined, g, d)).toEqual({ outcome: 'domain_capped' });
    expect(await liveSites(accountId)).toEqual([]);
    expect(await checksOf(s.id)).toEqual([]);
    expect([await countOf(g), await countOf(d)]).toEqual([0, 5]);
  });

  it('at the daily ceiling: capacity, nothing written, the domain bucket left as it was', async () => {
    const { accountId, seatId } = await account();
    const g = slot(10);
    await fill(g, 10);
    const d = slot(5);
    const s = newSite(accountId, seatId);
    expect(await add(s, 1, undefined, g, d)).toEqual({ outcome: 'capacity' });
    expect(await liveSites(accountId)).toEqual([]);
    expect(await checksOf(s.id)).toEqual([]);
    expect([await countOf(g), await countOf(d)]).toEqual([10, 0]);
  });

  it('refuses rows that are not what the route writes', async () => {
    const { accountId, seatId } = await account();
    const s = newSite(accountId, seatId);
    const cases: [unknown, unknown][] = [
      [{ ...s, staging_of_site_id: null }, row(s.id, 'first_audit')],
      [s, row(s.id, 'manual')],
      [s, row(randomUUID(), 'first_audit')],
      [s, { ...row(s.id, 'first_audit'), status: 'running' }],
    ];
    for (const [a, b] of cases) {
      await expect(call('add_site', [a, b, 1, slot(), null])).rejects.toMatchObject({
        code: '22023',
      });
    }
    expect(await liveSites(accountId)).toEqual([]);
  });
});

describe('edit_site', () => {
  async function siteRow(id: string) {
    return (
      await db.query<Record<string, unknown>>(
        `select schedule_cadence, schedule_iso_weekday, schedule_hour_local, competitor_hosts
           from public.sites where id = $1`,
        [id],
      )
    ).rows[0];
  }
  const stagingOf = async (id: string) =>
    (
      await db.query<{ id: string; host: string; removed_at: Date | null; owner_seat_id: string }>(
        `select id, host, removed_at, owner_seat_id from public.sites
          where staging_of_site_id = $1 order by created_at, removed_at nulls last`,
        [id],
      )
    ).rows;

  it('sets the schedule and the competitors, and leaves what the patch does not name', async () => {
    const { accountId } = await account();
    const s = await site(accountId);
    const schedule = { cadence: 'weekly', iso_weekday: 3, hour_local: 9 };
    expect(await call('edit_site', [s, { schedule }])).toEqual({
      outcome: 'updated',
      staging_site_id: null,
    });
    expect(
      await call('edit_site', [s, { competitor_hosts: ['rival.example', 'other.example'] }]),
    ).toMatchObject({ outcome: 'updated' });
    expect(await siteRow(s)).toEqual({
      schedule_cadence: 'weekly',
      schedule_iso_weekday: 3,
      schedule_hour_local: 9,
      competitor_hosts: ['rival.example', 'other.example'],
    });
    await call('edit_site', [s, { schedule: null, competitor_hosts: [] }]);
    expect(await siteRow(s)).toEqual({
      schedule_cadence: null,
      schedule_iso_weekday: null,
      schedule_hour_local: null,
      competitor_hosts: [],
    });
  });

  it('makes a staging child, replaces it, and clears it; the old child is removed, not deleted', async () => {
    const { accountId, seatId } = await account();
    const s = await site(accountId);
    await db.query(`update public.sites set owner_seat_id = $2 where id = $1`, [s, seatId]);
    const a = await call('edit_site', [s, { staging_host: 'staging.example' }]);
    expect(a).toMatchObject({ outcome: 'updated' });
    expect(await call('edit_site', [s, { staging_host: 'staging.example' }])).toEqual(a);
    const b = await call('edit_site', [s, { staging_host: 'preview.example' }]);
    expect(b.staging_site_id).not.toBe(a.staging_site_id);
    const rows = await stagingOf(s);
    expect(
      rows
        .map((r) => ({ host: r.host, live: r.removed_at === null, owner: r.owner_seat_id }))
        .sort((x, y) => x.host.localeCompare(y.host)),
    ).toEqual([
      { host: 'preview.example', live: true, owner: seatId },
      { host: 'staging.example', live: false, owner: seatId },
    ]);
    expect(rows.find((r) => r.removed_at === null)?.id).toBe(b.staging_site_id);
    expect(await call('edit_site', [s, { staging_host: null }])).toEqual({
      outcome: 'updated',
      staging_site_id: null,
    });
    expect((await stagingOf(s)).every((r) => r.removed_at !== null)).toBe(true);
  });

  it('a staging host the account already keeps is exists, and nothing in the patch is written', async () => {
    const { accountId } = await account();
    const s = await site(accountId);
    const other = await site(accountId);
    const { rows } = await db.query<{ host: string }>(
      `select host from public.sites where id = $1`,
      [other],
    );
    expect(
      await call('edit_site', [
        s,
        { staging_host: rows[0]!.host, competitor_hosts: ['rival.example'] },
      ]),
    ).toEqual({ outcome: 'exists' });
    expect((await siteRow(s))!.competitor_hosts).toEqual([]);
    expect(await stagingOf(s)).toEqual([]);
  });

  it('a staging site takes a schedule, but no staging or competitors of its own', async () => {
    const { accountId } = await account();
    const s = await site(accountId);
    const child = await site(accountId, { staging_of_site_id: s });
    expect(await call('edit_site', [child, { competitor_hosts: ['rival.example'] }])).toEqual({
      outcome: 'is_staging',
    });
    expect(await call('edit_site', [child, { staging_host: 'x.example' }])).toEqual({
      outcome: 'is_staging',
    });
    expect(
      (
        await call('edit_site', [
          child,
          { schedule: { cadence: 'monthly', iso_weekday: 1, hour_local: 6 } },
        ])
      ).outcome,
    ).toBe('updated');
  });

  it('a removed site is removed, untouched', async () => {
    const { accountId } = await account();
    const s = await site(accountId, { removed_at: new Date().toISOString() });
    expect(await call('edit_site', [s, { competitor_hosts: ['rival.example'] }])).toEqual({
      outcome: 'removed',
    });
    expect((await siteRow(s))!.competitor_hosts).toEqual([]);
  });

  it('refuses a patch with any other key', async () => {
    const { accountId } = await account();
    const s = await site(accountId);
    for (const p of [{ host: 'x.example' }, { removed_at: null }, []]) {
      await expect(call('edit_site', [s, p])).rejects.toMatchObject({ code: '22023' });
    }
  });
});

describe('remove_site', () => {
  it('sets removed_at on the site and its staging children, cancels their queued checks, and keeps their history', async () => {
    const { accountId } = await account();
    const s = await site(accountId);
    const child = await site(accountId, { staging_of_site_id: s });
    await pastCheck(s, 'manual', 30);
    const queued = row(s);
    await call('request_capped_check', [queued, 2, slot()]);
    expect(await call('remove_site', [s])).toEqual({ outcome: 'removed', sites: 2 });
    expect(await liveSites(accountId)).not.toEqual(expect.arrayContaining([s, child]));
    const checks = await checksOf(s);
    expect(checks).toHaveLength(2);
    expect(checks.find((c) => c.id === queued.id)?.status).toBe('failed');
    const { rows } = await db.query<{ failure_reason: string }>(
      `select failure_reason from public.checks where id = $1`,
      [queued.id],
    );
    expect(rows[0]!.failure_reason).toBe('canceled');
    expect(await call('remove_site', [s])).toEqual({ outcome: 'already_removed' });
  });

  it('leaves the account’s other sites alone', async () => {
    const { accountId } = await account();
    const s = await site(accountId);
    const other = await site(accountId);
    await call('remove_site', [s]);
    expect(await liveSites(accountId)).toEqual([other]);
  });
});

describe('who may call the section-A functions', () => {
  it('owned by postgres, security definer with search_path pg_catalog, pg_temp, executable by service_role only', async () => {
    const { rows } = await db.query<{
      proname: string;
      owner: string;
      definer: boolean;
      config: string[] | null;
      anon: boolean;
      authenticated: boolean;
      service: boolean;
      public_: boolean;
    }>(
      `select p.proname, pg_get_userbyid(p.proowner) as owner, p.prosecdef as definer,
              p.proconfig as config,
              has_function_privilege('anon', p.oid, 'execute') as anon,
              has_function_privilege('authenticated', p.oid, 'execute') as authenticated,
              has_function_privilege('service_role', p.oid, 'execute') as service,
              exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                       where a.grantee = 0) as public_
         from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = any($1)
        order by p.proname`,
      [FUNCTIONS],
    );
    expect(rows).toEqual(
      FUNCTIONS.map((proname) => ({
        proname,
        owner: 'postgres',
        definer: true,
        config: ['search_path=pg_catalog, pg_temp'],
        anon: false,
        authenticated: false,
        service: true,
        public_: false,
      })),
    );
  });
});

/** The text between a file's `═══ A` marker line and its `═══ end A` line. */
function sectionA(text: string): string {
  const start = text.indexOf('\n-- ═══ A:');
  const end = text.indexOf('\n-- ═══ end A');
  if (start < 0 || end < start) throw new Error('section A markers not found');
  return text.slice(start, end);
}

describe('the section header’s account of each lock', () => {
  /**
   * The header says which row each function locks first and which columns it reads in that same
   * statement. Read from the installed definitions: the first statement that reads a table must be
   * the FOR UPDATE, on that table, selecting those columns.
   */
  it.each([
    ['request_capped_check', 'sites', ['s.removed_at', 's.paused_reason']],
    ['add_site', 'accounts', []],
    [
      'edit_site',
      'sites',
      ['s.account_id', 's.staging_of_site_id', 's.removed_at', 's.owner_seat_id'],
    ],
    ['remove_site', 'sites', ['s.removed_at']],
  ] as const)('%s locks %s first, reading %j in that statement', async (fn, table, columns) => {
    const { rows } = await db.query<{ def: string }>(
      `select pg_get_functiondef(p.oid) as def from pg_proc p
        where p.pronamespace = 'public'::regnamespace and p.proname = $1`,
      [fn],
    );
    const body = rows[0]!.def;
    const firstRead = body.search(/\bfrom public\.\w+/);
    const lock =
      /^\s*(select|perform)\s+([^;]*?)\s+(?:into\s[^;]*?\s+)?from public\.(\w+)\s[^;]*?for update;/m.exec(
        body,
      );
    expect(lock, 'a FOR UPDATE statement').not.toBeNull();
    expect(body.indexOf(lock![0]) + lock![0].indexOf('from public.')).toBe(firstRead);
    expect(lock![3]).toBe(table);
    const read = lock![1] === 'perform' ? [] : lock![2]!.split(',').map((c) => c.trim());
    expect(read).toEqual(columns);
  });
});

describe('take_rate_slot', () => {
  it('is security definer, owned by postgres, and no client role may execute it, service_role included', async () => {
    const { rows } = await db.query<Record<string, unknown>>(
      `select pg_get_userbyid(p.proowner) as owner, p.prosecdef as definer, p.proconfig as config,
              has_function_privilege('anon', p.oid, 'execute') as anon,
              has_function_privilege('authenticated', p.oid, 'execute') as authenticated,
              has_function_privilege('service_role', p.oid, 'execute') as service
         from pg_proc p where p.oid = 'public.take_rate_slot(jsonb)'::regprocedure`,
    );
    expect(rows).toEqual([
      {
        owner: 'postgres',
        definer: true,
        config: ['search_path=pg_catalog, pg_temp'],
        anon: false,
        authenticated: false,
        service: false,
      },
    ]);
  });
});

describe('the section applies twice and its revert removes it', () => {
  it('the migration file applied again leaves the functions as they were', async () => {
    const before = await definitions(db);
    await db.exec(readMigration(MIGRATION));
    expect(await definitions(db)).toEqual(before);
    expect(before.map((d) => d.proname)).toEqual([...FUNCTIONS, ...HELPERS].sort());
  });

  it('the revert section drops each function, twice, and the migration re-applies', async () => {
    const own = await freshDb();
    try {
      await applyAllMigrations(own);
      const before = await definitions(own);
      expect(before.map((d) => d.proname)).toEqual([...FUNCTIONS, ...HELPERS].sort());
      const revert = sectionA(readRollback(ROLLBACK));
      await own.exec(revert);
      expect(await definitions(own)).toEqual([]);
      await own.exec(revert);
      expect(await definitions(own)).toEqual([]);
      await own.exec(readMigration(MIGRATION));
      expect(await definitions(own)).toEqual(before);
    } finally {
      await own.close();
    }
  }, 300_000);
});

async function definitions(d: PGlite) {
  return (
    await d.query<{ proname: string; def: string }>(
      `select p.proname, pg_get_functiondef(p.oid) as def from pg_proc p
        where p.pronamespace = 'public'::regnamespace and p.proname = any($1) order by p.proname`,
      [[...FUNCTIONS, ...HELPERS]],
    )
  ).rows;
}
