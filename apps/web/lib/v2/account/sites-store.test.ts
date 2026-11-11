/**
 * The site routes' store (CC-26b D4, D6) over PGlite with every migration applied, through the
 * PostgREST stand-in as the service role: what each wrapper answers and what it leaves in the tables,
 * and the re-check's event, sent only for a request the database recorded or still holds queued.
 */
import { randomUUID } from 'node:crypto';
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { applyAllMigrations, freshDb } from '../../../__tests__/helpers/pglite-migrations';
import { personalAccount, signUp } from '../../../__tests__/helpers/v2-check-tables';
import { checkIdOfKey } from '../pipeline/ids';
import { homepageOf } from '../pipeline/request';
import { editSite, removeSite, supabaseAddSite, supabaseRequestRecheck } from './sites-store';
import { adminOver } from './sites-test-support';

vi.mock('server-only', () => ({}));

let db: PGlite;
beforeAll(async () => {
  db = await freshDb();
  await applyAllMigrations(db);
}, 300_000);
afterAll(async () => {
  await db?.close();
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
        next_check_at: null,
      },
    ]);
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
