import type { PGlite } from '@electric-sql/pglite';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { doorDb, signUp } from '../../../../../__tests__/v2/_lib/door-pglite';
import { NOTIFY_PER_EMAIL_PER_DAY, NOTIFY_PER_IP_PER_DAY } from '../../../../../lib/limits';
import type { Viewer } from '../../../../../lib/v2/pipeline/public';
import {
  NOW,
  checkRow,
  harness,
  keep,
  queued,
  request,
  running,
  type Harness,
  type Ids,
} from '../_lib/test-harness';
import { notify } from './notify';

const anonymous: Viewer = { userId: null };
const ADDRESS = 'Dana.Reader@Example.com';
const STORED = 'dana.reader@example.com';

let db: PGlite;
let owner: string;
let stranger: string;
beforeAll(async () => {
  db = await doorDb();
  owner = await signUp(db, 'owner@example.com');
  stranger = await signUp(db, 'stranger@example.com');
}, 120_000);
afterEach(() => vi.restoreAllMocks());

const post = (h: Harness, ids: Ids, body: unknown, viewer = anonymous) =>
  notify(
    request(`/api/checks/${ids.checkId}/notify`, { method: 'POST' }),
    body,
    ids.checkId,
    viewer,
    h.deps,
  );

describe('POST /api/checks/[id]/notify', () => {
  it('stores the address, trimmed and lower-cased, and emits the event without it', async () => {
    const logged: unknown[][] = [];
    for (const level of ['log', 'info', 'warn', 'error'] as const) {
      vi.spyOn(console, level).mockImplementation((...args) => void logged.push(args));
    }
    for (const start of [queued, (d: PGlite, host: string) => running(d, harness(d), host)]) {
      const h = harness(db);
      const ids = await start(db, `notify-${logged.length}-${Math.random()}.example`);
      const res = await post(h, ids, { email: `  ${ADDRESS} ` });
      const answer = await res.text();
      expect([res.status, JSON.parse(answer)]).toEqual([200, { ok: true }]);
      expect((await checkRow(db, ids.checkId)).notify_email).toBe(STORED);
      expect(h.sent).toEqual([
        {
          id: `check-notify:${ids.checkId}`,
          name: 'check.notify_requested',
          data: { checkId: ids.checkId, siteId: ids.siteId },
        },
      ]);
      // The address is in the row and nowhere else this request reached.
      const elsewhere = JSON.stringify([answer, h.sent, h.limits, logged]).toLowerCase();
      expect(elsewhere).not.toContain(STORED);
      expect(elsewhere).not.toContain('dana');
      expect(h.limits[0]).toBe('notify:ip:203.0.113.7');
      expect(h.limits[1]).toMatch(/^notify:email:[0-9a-f-]{36}$/);
    }
  });

  it('a second submit sends the event with the same id, so Inngest delivers one', async () => {
    const h = harness(db);
    const ids = await queued(db, 'twice.example');
    await post(h, ids, { email: ADDRESS });
    await post(h, ids, { email: ADDRESS });
    expect(h.sent.map((e) => e.id)).toEqual([
      `check-notify:${ids.checkId}`,
      `check-notify:${ids.checkId}`,
    ]);
  });

  it('400 for a body that holds no valid address, before a limit is counted or a row written', async () => {
    const h = harness(db);
    const ids = await queued(db, 'invalid.example');
    for (const body of [
      {},
      { email: '' },
      { email: 'not-an-address' },
      { email: 'a@b' },
      { email: `${'a'.repeat(250)}@example.com` },
      { email: 42 },
      'a string',
      [],
      null,
    ]) {
      const res = await post(h, ids, body);
      expect([body, res.status, await res.json()]).toEqual([body, 400, { code: 'invalid_email' }]);
    }
    expect(h.limits).toEqual([]);
    expect(h.sent).toEqual([]);
    expect((await checkRow(db, ids.checkId)).notify_email).toBeNull();
  });

  it('429 from either limit, with v1’s numbers, and nothing stored or sent', async () => {
    for (const prefix of ['notify:ip:', 'notify:email:']) {
      const h = harness(db);
      const ids = await queued(db, `limited-${prefix.split(':')[1]}.example`);
      h.denied.add(prefix);
      const res = await post(h, ids, { email: ADDRESS });
      expect([prefix, res.status, await res.json()]).toEqual([
        prefix,
        429,
        { code: 'rate_limited' },
      ]);
      expect(h.sent).toEqual([]);
      expect((await checkRow(db, ids.checkId)).notify_email).toBeNull();
    }
    // The harness limiter counts as checkRateLimit does: the per-address limit is the fifth's.
    const h = harness(db);
    const statuses: number[] = [];
    for (let i = 0; i <= NOTIFY_PER_EMAIL_PER_DAY; i++) {
      statuses.push((await post(h, await queued(db, `n${i}.example`), { email: ADDRESS })).status);
    }
    expect(statuses).toEqual([200, 200, 200, 200, 200, 429]);
    expect([NOTIFY_PER_IP_PER_DAY, NOTIFY_PER_EMAIL_PER_DAY]).toEqual([10, 5]);
  });

  it('409 for a check that has ended: nothing stored, nothing sent', async () => {
    const h = harness(db);
    const ids = await running(db, h, 'ended.example');
    await h.pipeline.fail(ids.checkId, 'canceled', null);
    const res = await post(h, ids, { email: ADDRESS });
    expect([res.status, await res.json()]).toEqual([409, { code: 'check_ended' }]);
    expect((await checkRow(db, ids.checkId)).notify_email).toBeNull();
    expect(h.sent).toEqual([]);
  });

  it('404 for a kept check to a visitor and to another account; its member is served', async () => {
    const h = harness(db);
    const ids = await queued(db, 'kept-notify.example');
    await keep(db, ids, owner);
    for (const viewer of [anonymous, { userId: stranger }]) {
      const res = await post(h, ids, { email: ADDRESS }, viewer);
      expect([res.status, await res.json()]).toEqual([404, { code: 'not_found' }]);
    }
    expect(h.limits).toEqual([]);
    expect((await checkRow(db, ids.checkId)).notify_email).toBeNull();
    expect((await post(h, ids, { email: ADDRESS }, { userId: owner })).status).toBe(200);
  });

  it('404 for an expired check', async () => {
    const h = harness(db);
    const ids = await queued(db, 'expired-notify.example');
    h.clock.now = NOW + 2 * 60 * 60_000;
    const res = await post(h, ids, { email: ADDRESS });
    expect(res.status).toBe(404);
    expect((await checkRow(db, ids.checkId)).notify_email).toBeNull();
  });
});
