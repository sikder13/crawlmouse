import type { PGlite } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import { checkFailedEventId } from '../../../../../../../inngest/check-events';
import { count, doorDb, signUp } from '../../../../../__tests__/v2/_lib/door-pglite';
import { failCancelled } from '../../../../../lib/v2/pipeline/steps/lifecycle';
import type { Viewer } from '../../../../../lib/v2/pipeline/public';
import {
  NOW,
  checkRow,
  harness,
  keep,
  queued,
  running,
  type Harness,
  type Ids,
} from '../../../../../__tests__/v2/_lib/check-routes-harness';
import { cancel } from './cancel';

const anonymous: Viewer = { userId: null };

let db: PGlite;
let owner: string;
let stranger: string;
beforeAll(async () => {
  db = await doorDb();
  owner = await signUp(db, 'owner@example.com');
  stranger = await signUp(db, 'stranger@example.com');
}, 120_000);

const post = (h: Harness, ids: Ids, viewer = anonymous) => cancel(ids.checkId, viewer, h.deps);

describe('POST /api/checks/[id]/cancel', () => {
  it('a queued check no run has claimed: failed canceled, with both events in order', async () => {
    const h = harness(db);
    const ids = await queued(db, 'cancel-queued.example');
    const res = await post(h, ids);
    expect([res.status, await res.json()]).toEqual([200, { status: 'canceled' }]);
    expect(await checkRow(db, ids.checkId)).toMatchObject({
      status: 'failed',
      failure_reason: 'canceled',
    });
    expect(h.sent).toEqual([
      { name: 'check.cancel.requested', data: { checkId: ids.checkId } },
      {
        id: `check-failed:${ids.checkId}`,
        name: 'check.failed',
        data: { checkId: ids.checkId, siteId: ids.siteId, reason: 'canceled' },
      },
    ]);
  });

  it('a running check, then the run’s own cancel handler: one failed row, one event id', async () => {
    const h = harness(db);
    const ids = await running(db, h, 'cancel-running.example');
    expect((await post(h, ids)).status).toBe(200);
    const after = await checkRow(db, ids.checkId);

    // What crawlmouse.check.cancelled runs when Inngest reports the run cancelled.
    const handled = await failCancelled(h.pipeline, {
      checkId: ids.checkId,
      runId: `run-${ids.checkId}`,
    });
    // fail_check answers true for a check already failed `canceled`, so the handler sends
    // check.failed too: with the id the route sent it with.
    expect(handled).toEqual({ checkId: ids.checkId, siteId: ids.siteId });
    expect(h.sent.find((e) => e.name === 'check.failed')!.id).toBe(checkFailedEventId(ids.checkId));
    expect(await checkRow(db, ids.checkId)).toEqual(after);
    expect(after).toMatchObject({ status: 'failed', failure_reason: 'canceled' });
    expect(await count(db, `select 1 from public.checks where site_id = $1`, [ids.siteId])).toBe(1);
  });

  it('409 for a check that has ended, and for a second cancel: no event', async () => {
    const h = harness(db);
    const ids = await running(db, h, 'cancel-ended.example');
    await h.pipeline.fail(ids.checkId, 'stalled', null);
    for (let i = 0; i < 2; i++) {
      const res = await post(h, ids);
      expect([res.status, await res.json()]).toEqual([409, { code: 'check_ended' }]);
    }
    expect(h.sent).toEqual([]);
    expect((await checkRow(db, ids.checkId)).failure_reason).toBe('stalled');
  });

  it('409 for a deferred check, which fail_check does not move', async () => {
    const h = harness(db);
    const ids = await queued(db, 'cancel-deferred.example');
    await db.query(
      `update public.checks set status = 'deferred', deferred_until = now() + interval '1 hour'
        where id = $1`,
      [ids.checkId],
    );
    expect((await post(h, ids)).status).toBe(409);
    expect(h.sent).toEqual([]);
    expect((await checkRow(db, ids.checkId)).status).toBe('deferred');
  });

  it('a cancel request that cannot be sent leaves the check as it was', async () => {
    const h = harness(db);
    const ids = await running(db, h, 'cancel-send-fails.example');
    h.deps.send = async () => {
      throw new Error('inngest is down');
    };
    await expect(post(h, ids)).rejects.toThrow('inngest is down');
    expect((await checkRow(db, ids.checkId)).status).toBe('running');
  });

  it('404 for a kept check to a visitor and to another account; its member cancels it', async () => {
    const h = harness(db);
    const ids = await running(db, h, 'cancel-kept.example');
    await keep(db, ids, owner);
    for (const viewer of [anonymous, { userId: stranger }]) {
      const res = await post(h, ids, viewer);
      expect([res.status, await res.json()]).toEqual([404, { code: 'not_found' }]);
    }
    expect(h.sent).toEqual([]);
    expect((await checkRow(db, ids.checkId)).status).toBe('running');
    expect((await post(h, ids, { userId: owner })).status).toBe(200);
  });

  it('404 for an expired check, which stays as it was', async () => {
    const h = harness(db);
    const ids = await queued(db, 'cancel-expired.example');
    h.clock.now = NOW + 2 * 60 * 60_000;
    expect((await post(h, ids)).status).toBe(404);
    expect(h.sent).toEqual([]);
    expect((await checkRow(db, ids.checkId)).status).toBe('queued');
  });
});
