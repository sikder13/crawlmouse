/**
 * An operator's re-run (CC-33 D2) over PGlite with every migration applied, through the PostgREST
 * stand-in as the service role: requestCheck with `operator_request_check` as its insert, so the
 * check, its event and the record line come from one call, and a refused request sends nothing.
 */
import { randomUUID } from 'node:crypto';
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { applyAllMigrations, freshDb } from '../../../__tests__/helpers/pglite-migrations';
import { personalAccount, signUp } from '../../../__tests__/helpers/v2-check-tables';
import { adminOver } from '../account/sites-test-support';
import { operatorRerun } from './rerun';

vi.mock('server-only', () => ({}));

let db: PGlite;
let operatorId: string;
beforeAll(async () => {
  db = await freshDb();
  await applyAllMigrations(db);
  operatorId = await signUp(db, `op-${randomUUID()}@example.com`);
  await db.query('insert into public.operators (user_id) values ($1)', [operatorId]);
}, 300_000);
afterAll(async () => {
  await db?.close();
});

let pinned: { mockRestore(): void } | null = null;
afterEach(() => {
  pinned?.mockRestore();
  pinned = null;
});
const pinBucket = () => {
  pinned = vi
    .spyOn(Date, 'now')
    .mockReturnValue(Math.floor(Date.now() / 120_000) * 120_000 + 1_000);
};

async function failedSite(paused: string | null = null) {
  const userId = await signUp(db, `rerun-${randomUUID()}@example.com`);
  const { accountId } = await personalAccount(db, userId);
  const siteId = randomUUID();
  await db.query(
    `insert into public.sites (id, account_id, host, paused_reason) values ($1, $2, $3, $4)`,
    [siteId, accountId, `${siteId.slice(0, 8)}.example`, paused],
  );
  const failed = randomUUID();
  await db.query(
    `insert into public.checks (id, site_id, status, trigger, grade_version, queued_at, started_at,
                                finished_at, failure_reason)
     values ($1, $2, 'failed', 'scheduled', '2.0.0', now() - interval '3 hours',
             now() - interval '3 hours', now() - interval '3 hours', 'reaped')`,
    [failed, siteId],
  );
  return { accountId, siteId, failed };
}

const actions = async () =>
  (
    await db.query<{ action: string; target: string; outcome: string; reason: string }>(
      `select action, target, outcome, reason from public.operator_actions
        where operator_id = $1 order by id`,
      [operatorId],
    )
  ).rows;

describe('operatorRerun', () => {
  it('queues a manual check, sends its event with no requester, and records the re-run', async () => {
    pinBucket();
    const t = await failedSite();
    const send = vi.fn(async () => undefined);
    const before = (await actions()).length;
    const r = await operatorRerun(adminOver(db), operatorId, {
      failedCheckId: t.failed,
      siteId: t.siteId,
      cap: 2,
      reason: 'stuck check',
      send,
    });
    expect(r).toEqual({ queued: true, checkId: expect.any(String), created: true });
    const checkId = (r as { checkId: string }).checkId;
    const { rows } = await db.query('select status, trigger from public.checks where id = $1', [
      checkId,
    ]);
    expect(rows).toEqual([{ status: 'queued', trigger: 'manual' }]);
    expect(send).toHaveBeenCalledOnce();
    const [[event]] = send.mock.calls as unknown as [[{ name: string; data: object }]];
    expect(event.name).toBe('check.requested');
    expect(event.data).toMatchObject({ checkId, siteId: t.siteId, trigger: 'manual' });
    expect(event.data).not.toHaveProperty('requestedByUserId');
    expect((await actions()).slice(before)).toEqual([
      { action: 'rerun_check', target: t.failed, outcome: 'created', reason: 'stuck check' },
    ]);
  });

  it('a capped re-run sends nothing, queues nothing, and is recorded as capped', async () => {
    const t = await failedSite();
    await db.query(
      `insert into public.checks (id, site_id, status, trigger, grade_version, queued_at, started_at,
                                  finished_at, failure_reason)
       values (gen_random_uuid(), $1, 'failed', 'manual', '2.0.0', now() - interval '1 hour',
               now() - interval '1 hour', now() - interval '1 hour', 'internal')`,
      [t.siteId],
    );
    const send = vi.fn(async () => undefined);
    const before = (await actions()).length;
    const r = await operatorRerun(adminOver(db), operatorId, {
      failedCheckId: t.failed,
      siteId: t.siteId,
      cap: 1,
      reason: 'again',
      send,
    });
    expect(r).toEqual({ queued: false, reason: 'capped', nextAllowedAt: expect.any(String) });
    expect(send).not.toHaveBeenCalled();
    const { rows } = await db.query(
      `select count(*)::int as n from public.checks where site_id = $1 and status = 'queued'`,
      [t.siteId],
    );
    expect(rows).toEqual([{ n: 0 }]);
    expect((await actions()).slice(before).map((a) => a.outcome)).toEqual(['capped']);
  });

  it('a paused site is answered paused, and recorded as site_paused', async () => {
    const t = await failedSite('user');
    const send = vi.fn(async () => undefined);
    const r = await operatorRerun(adminOver(db), operatorId, {
      failedCheckId: t.failed,
      siteId: t.siteId,
      cap: 2,
      reason: 'x',
      send,
    });
    expect(r).toEqual({ queued: false, reason: 'paused' });
    expect(send).not.toHaveBeenCalled();
    expect((await actions()).at(-1)?.outcome).toBe('site_paused');
  });

  it('a target that is not a failed check of the site throws, and records nothing', async () => {
    const t = await failedSite();
    const other = await failedSite();
    const send = vi.fn(async () => undefined);
    const before = (await actions()).length;
    await expect(
      operatorRerun(adminOver(db), operatorId, {
        failedCheckId: other.failed,
        siteId: t.siteId,
        cap: 2,
        reason: 'x',
        send,
      }),
    ).rejects.toThrow(/operator_request_check failed/);
    expect(send).not.toHaveBeenCalled();
    expect((await actions()).length).toBe(before);
  });
});
