/**
 * The site routes' store (CC-26b D4, D6) over PGlite with every migration applied, through the
 * PostgREST stand-in as the service role: what each wrapper answers and what it leaves in the tables,
 * and the re-check's event, sent only for a request the database recorded or still holds queued.
 */
import { randomUUID } from 'node:crypto';
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { applyAllMigrations, freshDb } from '../../../__tests__/helpers/pglite-migrations';
import { personalAccount, signUp } from '../../../__tests__/helpers/v2-check-tables';
import { checkIdOfKey } from '../pipeline/ids';
import { homepageOf } from '../pipeline/request';
import { checkRateLimit } from '../../rate-limit';
import { GLOBAL_AUDITS_BUCKET, GLOBAL_AUDITS_PER_DAY } from '../../limits';
import { MAX_RATE_LIMIT_WINDOW_MS } from '../../rate-limit-window';
import {
  domainSlot,
  editSite,
  globalSlot,
  readNextChecks,
  removeSite,
  supabaseAddSite,
  supabaseRequestRecheck,
} from './sites-store';
import { adminOver } from './sites-test-support';

vi.mock('server-only', () => ({}));
// checkRateLimit's own client, over the same database.
vi.mock('../../supabase/admin', () => ({ supabaseAdmin: () => adminOver(db) }));

let db: PGlite;
beforeAll(async () => {
  db = await freshDb();
  await applyAllMigrations(db);
}, 300_000);
afterAll(async () => {
  await db?.close();
});

/** Holds Date.now inside one 2-minute bucket, so two requests cannot fall either side of its edge. */
let pinned: { mockRestore(): void } | null = null;
const pinBucket = () => {
  pinned = vi
    .spyOn(Date, 'now')
    .mockReturnValue(Math.floor(Date.now() / 120_000) * 120_000 + 1_000);
};
afterEach(() => {
  pinned?.mockRestore();
  pinned = null;
});

async function account() {
  const userId = await signUp(db, `store-${randomUUID()}@example.com`);
  return { userId, ...(await personalAccount(db, userId)) };
}

async function site(accountId: string, extra = ''): Promise<{ id: string; host: string }> {
  const id = randomUUID();
  const host = `${id.slice(0, 8)}.example`;
  await db.query(`insert into public.sites (id, account_id, host) values ($1, $2, $3)${extra}`, [
    id,
    accountId,
    host,
  ]);
  return { id, host };
}

const statuses = async (siteId: string) =>
  (
    await db.query<{ id: string; status: string; trigger: string }>(
      `select id, status, trigger from public.checks where site_id = $1 order by queued_at`,
      [siteId],
    )
  ).rows;

describe('supabaseRequestRecheck', () => {
  it('queues the bucket’s check and sends its event; a repeat in the bucket sends the same id again', async () => {
    pinBucket();
    const a = await account();
    const s = await site(a.accountId);
    const send = vi.fn(async () => undefined);
    const recheck = supabaseRequestRecheck(adminOver(db), send);
    const first = await recheck({
      siteId: s.id,
      trigger: 'manual',
      cap: 2,
      requestedByUserId: a.userId,
    });
    expect(first).toEqual({ queued: true, checkId: expect.any(String), created: true });
    const again = await recheck({
      siteId: s.id,
      trigger: 'manual',
      cap: 2,
      requestedByUserId: a.userId,
    });
    expect(again).toEqual({
      queued: true,
      checkId: (first as { checkId: string }).checkId,
      created: false,
    });
    expect(await statuses(s.id)).toEqual([
      { id: (first as { checkId: string }).checkId, status: 'queued', trigger: 'manual' },
    ]);
    expect(send).toHaveBeenCalledTimes(2);
    const [[event]] = send.mock.calls as unknown as [[{ id: string; data: unknown }]];
    expect(checkIdOfKey(event.id)).toBe((first as { checkId: string }).checkId);
    expect(event.id).toMatch(new RegExp(`^check:${s.id}:manual:\\d+$`));
    expect(event).toEqual({
      id: event.id,
      name: 'check.requested',
      data: {
        checkId: (first as { checkId: string }).checkId,
        siteId: s.id,
        accountId: a.accountId,
        host: s.host,
        homepageUrl: homepageOf(s.host),
        trigger: 'manual',
        pageCap: expect.any(Number),
        requestedByUserId: a.userId,
      },
    });
  });

  it('a capped request writes nothing, sends nothing, and says when the next is allowed', async () => {
    const a = await account();
    const s = await site(a.accountId);
    await db.query(
      `insert into public.checks (id, site_id, status, trigger, grade_version, queued_at, started_at,
                                  finished_at, failure_reason)
       values (gen_random_uuid(), $1, 'failed', 'fix_recheck', '2.0.0', now() - interval '2 hours',
               now() - interval '2 hours', now() - interval '2 hours', 'internal')`,
      [s.id],
    );
    const send = vi.fn(async () => undefined);
    const r = await supabaseRequestRecheck(
      adminOver(db),
      send,
    )({
      siteId: s.id,
      trigger: 'manual',
      cap: 1,
      requestedByUserId: a.userId,
    });
    expect(r).toEqual({ queued: false, reason: 'capped', nextAllowedAt: expect.any(String) });
    const next = Date.parse((r as { nextAllowedAt: string }).nextAllowedAt);
    expect(next - Date.now()).toBeGreaterThan(21.9 * 3600_000);
    expect(next - Date.now()).toBeLessThan(22.1 * 3600_000);
    expect(send).not.toHaveBeenCalled();
    expect(await statuses(s.id)).toHaveLength(1);
  });

  it('a bucket check that has started is check_running, with nothing sent', async () => {
    pinBucket();
    const a = await account();
    const s = await site(a.accountId);
    const send = vi.fn(async () => undefined);
    const recheck = supabaseRequestRecheck(adminOver(db), send);
    const first = (await recheck({
      siteId: s.id,
      trigger: 'fix_recheck',
      cap: 10,
      requestedByUserId: a.userId,
    })) as { checkId: string };
    await db.query(`select public.claim_check($1, 'run-1', '{"phase":"crawl"}'::jsonb)`, [
      first.checkId,
    ]);
    send.mockClear();
    expect(
      await recheck({ siteId: s.id, trigger: 'fix_recheck', cap: 10, requestedByUserId: a.userId }),
    ).toEqual({ queued: false, reason: 'check_running', checkId: first.checkId });
    expect(send).not.toHaveBeenCalled();
  });

  it('a bucket check that has already ended is recently_checked until the bucket ends, with nothing sent', async () => {
    pinBucket();
    const a = await account();
    const s = await site(a.accountId);
    const send = vi.fn(async () => undefined);
    const recheck = supabaseRequestRecheck(adminOver(db), send);
    const req = { siteId: s.id, trigger: 'manual' as const, cap: 10, requestedByUserId: a.userId };
    for (const ended of ['failed', 'deferred']) {
      const first = (await recheck(req)) as { checkId: string };
      if (ended === 'failed') {
        await db.query(`select public.claim_check($1, 'run-1', '{"phase":"crawl"}'::jsonb)`, [
          first.checkId,
        ]);
        await db.query(`select public.fail_check($1, 'internal')`, [first.checkId]);
      } else {
        await db.query(
          `update public.checks set status = 'deferred', deferred_until = now() + interval '1 day'
            where id = $1`,
          [first.checkId],
        );
      }
      send.mockClear();
      const bucketEnd = new Date((Math.floor(Date.now() / 120_000) + 1) * 120_000).toISOString();
      expect(await recheck(req), ended).toEqual({
        queued: false,
        reason: 'recently_checked',
        nextAllowedAt: bucketEnd,
      });
      expect(send).not.toHaveBeenCalled();
      await db.query(`delete from public.checks where id = $1`, [first.checkId]);
    }
  });

  it('a removed site and a paused one are refused, with nothing sent', async () => {
    const a = await account();
    const removed = await site(a.accountId);
    await db.query(`update public.sites set removed_at = now() where id = $1`, [removed.id]);
    const paused = await site(a.accountId);
    await db.query(`update public.sites set paused_reason = 'trial_ended' where id = $1`, [
      paused.id,
    ]);
    const send = vi.fn(async () => undefined);
    const recheck = supabaseRequestRecheck(adminOver(db), send);
    const req = (siteId: string) =>
      recheck({ siteId, trigger: 'manual', cap: 2, requestedByUserId: a.userId });
    expect(await req(removed.id)).toEqual({ queued: false, reason: 'removed' });
    expect(await req(paused.id)).toEqual({ queued: false, reason: 'paused' });
    expect(send).not.toHaveBeenCalled();
  });

  it('a send that fails leaves the queued row, and the retry sends the same event', async () => {
    pinBucket();
    const a = await account();
    const s = await site(a.accountId);
    const send = vi.fn(async () => undefined).mockRejectedValueOnce(new Error('inngest down'));
    const recheck = supabaseRequestRecheck(adminOver(db), send);
    const req = { siteId: s.id, trigger: 'manual' as const, cap: 2, requestedByUserId: a.userId };
    await expect(recheck(req)).rejects.toThrow('inngest down');
    const retry = await recheck(req);
    expect(retry).toMatchObject({ queued: true, created: false });
    const ids = (send.mock.calls as unknown as [{ id: string }][]).map(([e]) => e.id);
    expect(new Set(ids).size).toBe(1);
    expect(await statuses(s.id)).toHaveLength(1);
  });
});

describe('supabaseAddSite', () => {
  const schedule = { cadence: 'monthly' as const, iso_weekday: 3, hour_local: 6 };

  it('inserts the site with its schedule and its queued first audit, and sends that check’s event', async () => {
    const a = await account();
    const send = vi.fn(async () => undefined);
    const r = await supabaseAddSite(
      adminOver(db),
      send,
    )({
      accountId: a.accountId,
      ownerSeatId: a.seatId,
      host: 'added.example',
      schedule,
      limit: 1,
      perDomain: false,
      requestedByUserId: a.userId,
    });
    expect(r).toEqual({
      outcome: 'created',
      siteId: expect.any(String),
      checkId: expect.any(String),
      n: 1,
    });
    const { siteId, checkId } = r as { siteId: string; checkId: string };
    const { rows } = await db.query(
      `select account_id, host, owner_seat_id, schedule_cadence, schedule_iso_weekday,
              schedule_hour_local, next_check_at from public.sites where id = $1`,
      [siteId],
    );
    expect(rows).toEqual([
      {
        account_id: a.accountId,
        host: 'added.example',
        owner_seat_id: a.seatId,
        schedule_cadence: 'monthly',
        schedule_iso_weekday: 3,
        schedule_hour_local: 6,
        next_check_at: expect.any(Date),
      },
    ]);
    // Set by migration 028's trigger: the first Wednesday of a month at 06:mm in the account's zone.
    const { rows: due } = await db.query<{ ok: boolean }>(
      `select s.next_check_at = public.next_check_after(s.schedule_cadence, s.schedule_iso_weekday,
                s.schedule_hour_local, s.schedule_offset_min, a.timezone, s.created_at) as ok
         from public.sites s join public.accounts a on a.id = s.account_id where s.id = $1`,
      [siteId],
    );
    expect(due[0]!.ok).toBe(true);
    expect(await statuses(siteId)).toEqual([
      { id: checkId, status: 'queued', trigger: 'first_audit' },
    ]);
    expect(send).toHaveBeenCalledWith({
      id: `check:${siteId}:first_audit:${checkId}`,
      name: 'check.requested',
      data: {
        checkId,
        siteId,
        accountId: a.accountId,
        host: 'added.example',
        homepageUrl: homepageOf('added.example'),
        trigger: 'first_audit',
        pageCap: expect.any(Number),
        requestedByUserId: a.userId,
      },
    });
  });

  it('stores no schedule when given none', async () => {
    const a = await account();
    const r = (await supabaseAddSite(
      adminOver(db),
      async () => undefined,
    )({
      accountId: a.accountId,
      ownerSeatId: a.seatId,
      host: 'plain.example',
      schedule: null,
      limit: 1,
      perDomain: false,
      requestedByUserId: a.userId,
    })) as { siteId: string };
    const { rows } = await db.query(
      `select schedule_cadence, schedule_iso_weekday, schedule_hour_local from public.sites where id = $1`,
      [r.siteId],
    );
    expect(rows).toEqual([
      { schedule_cadence: null, schedule_iso_weekday: null, schedule_hour_local: null },
    ]);
  });

  it('full, exists and adds_capped write nothing and send nothing', async () => {
    const a = await account();
    const kept = await site(a.accountId);
    const send = vi.fn(async () => undefined);
    const add = (host: string, limit: number) =>
      supabaseAddSite(
        adminOver(db),
        send,
      )({
        accountId: a.accountId,
        ownerSeatId: a.seatId,
        host,
        schedule: null,
        limit,
        perDomain: false,
        requestedByUserId: a.userId,
      });
    expect(await add('more.example', 1)).toEqual({ outcome: 'full' });
    expect(await add(kept.host, 5)).toEqual({ outcome: 'exists', siteId: kept.id });
    expect((await add('one.example', 5)).outcome).toBe('created');
    send.mockClear();
    await db.query(
      `update public.checks set queued_at = now() - interval '1 hour'
        where site_id in (select id from public.sites where account_id = $1)`,
      [a.accountId],
    );
    expect(await add('two.example', 2)).toEqual({ outcome: 'full' });
    await db.query(`update public.sites set removed_at = now() where account_id = $1`, [
      a.accountId,
    ]);
    const capped = await add('three.example', 1);
    expect(capped).toEqual({ outcome: 'adds_capped', nextAllowedAt: expect.any(String) });
    expect(send).not.toHaveBeenCalled();
  });
});

describe('editSite and removeSite', () => {
  it('pass the patch through and answer as the function does', async () => {
    const a = await account();
    const s = await site(a.accountId);
    const admin = adminOver(db);
    expect(
      await editSite(admin, s.id, {
        schedule: { cadence: 'weekly', iso_weekday: 1, hour_local: 7 },
        competitor_hosts: ['rival.example'],
        staging_host: 'staging.example',
      }),
    ).toEqual({ outcome: 'updated', stagingSiteId: expect.any(String) });
    expect(await removeSite(admin, s.id)).toEqual({ outcome: 'removed', sites: 2 });
    expect(await editSite(admin, s.id, { staging_host: null })).toEqual({ outcome: 'removed' });
    expect(await removeSite(admin, s.id)).toEqual({ outcome: 'already_removed' });
  });

  it('throws on a database error rather than answering', async () => {
    await expect(removeSite(adminOver(db), randomUUID())).rejects.toThrow(/remove_site/);
  });
});

/** The day's count in a bucket's current window, or 0. */
async function countIn(bucket: string, windowStart: string): Promise<number> {
  const { rows } = await db.query<{ request_count: number }>(
    `select request_count from public.rate_limits where bucket_key = $1 and window_start = $2`,
    [bucket, windowStart],
  );
  return rows[0]?.request_count ?? 0;
}

describe('the daily ceiling and the per-domain bucket', () => {
  it('the SQL path and checkRateLimit count into the same global:audits:day row', async () => {
    const g = globalSlot(Date.now());
    expect(g).toMatchObject({ bucket: GLOBAL_AUDITS_BUCKET, limit: GLOBAL_AUDITS_PER_DAY });
    const before = await countIn(g.bucket, g.window_start);
    await checkRateLimit(GLOBAL_AUDITS_BUCKET, GLOBAL_AUDITS_PER_DAY, MAX_RATE_LIMIT_WINDOW_MS, {
      failClosed: true,
    });
    const a = await account();
    const s = await site(a.accountId);
    await supabaseRequestRecheck(
      adminOver(db),
      async () => undefined,
    )({
      siteId: s.id,
      trigger: 'manual',
      cap: 2,
      requestedByUserId: a.userId,
    });
    expect(await countIn(g.bucket, g.window_start)).toBe(before + 2);
    const { rows } = await db.query(`select 1 from public.rate_limits where bucket_key = $1`, [
      g.bucket,
    ]);
    expect(rows).toHaveLength(1);
  });

  it('the SQL path and checkRateLimit count into the same per-domain row', async () => {
    const d = domainSlot('www.Shared.example', Date.now());
    expect(d.bucket).toBe('domain:shared.example');
    await checkRateLimit('domain:shared.example', 5, 60 * 60 * 1000);
    const a = await account();
    await supabaseAddSite(
      adminOver(db),
      async () => undefined,
    )({
      accountId: a.accountId,
      ownerSeatId: a.seatId,
      host: 'shared.example',
      schedule: null,
      limit: 1,
      perDomain: true,
      requestedByUserId: a.userId,
    });
    expect(await countIn(d.bucket, d.window_start)).toBe(2);
  });

  it('over the ceiling a re-check is capacity and an add is capacity; nothing written or sent', async () => {
    const g = globalSlot(Date.now());
    const before = await countIn(g.bucket, g.window_start);
    await db.query(
      `insert into public.rate_limits (bucket_key, window_start, request_count) values ($1, $2, $3)
       on conflict (bucket_key, window_start) do update set request_count = excluded.request_count`,
      [g.bucket, g.window_start, GLOBAL_AUDITS_PER_DAY],
    );
    try {
      const a = await account();
      const s = await site(a.accountId);
      const send = vi.fn(async () => undefined);
      expect(
        await supabaseRequestRecheck(
          adminOver(db),
          send,
        )({
          siteId: s.id,
          trigger: 'fix_recheck',
          cap: 10,
          requestedByUserId: a.userId,
        }),
      ).toEqual({ queued: false, reason: 'capacity' });
      const b = await account();
      expect(
        await supabaseAddSite(
          adminOver(db),
          send,
        )({
          accountId: b.accountId,
          ownerSeatId: b.seatId,
          host: 'late.example',
          schedule: null,
          limit: 1,
          perDomain: true,
          requestedByUserId: b.userId,
        }),
      ).toEqual({ outcome: 'capacity' });
      expect(send).not.toHaveBeenCalled();
      expect(await statuses(s.id)).toEqual([]);
      expect(await countIn(g.bucket, g.window_start)).toBe(GLOBAL_AUDITS_PER_DAY);
      const d = domainSlot('late.example', Date.now());
      expect(await countIn(d.bucket, d.window_start)).toBe(0);
    } finally {
      await db.query(
        `update public.rate_limits set request_count = $3 where bucket_key = $1 and window_start = $2`,
        [g.bucket, g.window_start, before],
      );
    }
  });

  it('a full domain bucket is domain_capped until its hour ends; a paid add is not counted in it', async () => {
    const d = domainSlot('busy.example', Date.now());
    await db.query(
      `insert into public.rate_limits (bucket_key, window_start, request_count) values ($1, $2, 5)`,
      [d.bucket, d.window_start],
    );
    const add = async (perDomain: boolean) => {
      const a = await account();
      return supabaseAddSite(
        adminOver(db),
        async () => undefined,
      )({
        accountId: a.accountId,
        ownerSeatId: a.seatId,
        host: 'busy.example',
        schedule: null,
        limit: 1,
        perDomain,
        requestedByUserId: a.userId,
      });
    };
    expect(await add(true)).toEqual({
      outcome: 'domain_capped',
      nextAllowedAt: new Date(Date.parse(d.window_start) + 3600_000).toISOString(),
    });
    expect((await add(false)).outcome).toBe('created');
    expect(await countIn(d.bucket, d.window_start)).toBe(5);
  });
});

describe('readNextChecks (CC-28 D8)', () => {
  it('answers each site’s next_check_at as the scheduler’s trigger set it, null for an unscheduled one', async () => {
    const { accountId } = await account();
    const timed = await site(accountId);
    const untimed = await site(accountId);
    await db.query(
      `update public.sites set schedule_cadence = 'weekly', schedule_iso_weekday = 3,
              schedule_hour_local = 6 where id = $1`,
      [timed.id],
    );
    await db.query(
      `update public.sites set schedule_cadence = null, schedule_iso_weekday = null,
              schedule_hour_local = null where id = $1`,
      [untimed.id],
    );
    const { rows } = await db.query<{ at: Date }>(
      `select next_check_at as at from public.sites where id = $1`,
      [timed.id],
    );
    expect(rows[0]!.at).toBeInstanceOf(Date);
    const next = await readNextChecks(adminOver(db), [timed.id, untimed.id]);
    expect(next).toEqual(
      new Map([
        [timed.id, rows[0]!.at.toISOString()],
        [untimed.id, null],
      ]),
    );
    expect(await readNextChecks(adminOver(db), [])).toEqual(new Map());
  });
});
