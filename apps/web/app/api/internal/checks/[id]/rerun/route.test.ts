import { randomUUID } from 'node:crypto';
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyAllMigrations, freshDb } from '@/__tests__/helpers/pglite-migrations';
import {
  adminOver,
  keptSite,
  makePaid,
  person,
  sessionOver,
  type Person,
} from '@/lib/v2/account/sites-test-support';
import { GATES } from '@/lib/entitlement-v2';
import { failedCheckOf, operatorPerson, recordLines } from '@/lib/v2/ops/console-test-support';

// POST /api/internal/checks/[id]/rerun (CC-33 D2). The session and service-role clients are the
// PostgREST stand-in over PGlite with every migration applied, so is_operator, the record and
// operator_request_check run for real; Inngest's send is a fake.

const h = vi.hoisted(() => ({
  log: [] as string[],
  db: null as unknown as PGlite,
  user: null as { id: string; email: string } | null,
  send: vi.fn(async (_e: unknown) => undefined),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({
  supabaseServer: async () => {
    h.log.push('supabaseServer');
    return sessionOver(h.db, h.user);
  },
}));
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => {
    h.log.push('supabaseAdmin');
    return adminOver(h.db);
  },
}));
vi.mock('../../../../../../../../inngest/client', () => ({ inngest: { send: h.send } }));

import { POST } from './route';

beforeAll(async () => {
  h.db = await freshDb();
  await applyAllMigrations(h.db);
}, 300_000);
afterAll(async () => {
  await h.db?.close();
});
beforeEach(() => {
  h.log.length = 0;
  h.user = null;
  h.send.mockClear();
  vi.stubEnv('V2_PIPELINE', '1');
  vi.stubEnv('CRAWL_PAUSED', '');
});
afterEach(() => vi.unstubAllEnvs());

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

const as = (p: Person | null) => {
  h.user = p && { id: p.id, email: p.email };
};

const rerun = (id: string, body = 'reason=stuck+since+Tuesday') =>
  POST(
    new Request(`https://crawlmouse.com/api/internal/checks/${id}/rerun`, {
      method: 'POST',
      headers: {
        origin: 'https://crawlmouse.com',
        'content-type': 'application/x-www-form-urlencoded',
      },
      body,
    }),
    { params: Promise.resolve({ id }) },
  );

async function world() {
  const owner = await person(h.db, 'owner');
  const site = await keptSite(h.db, owner.accountId);
  const failed = await failedCheckOf(h.db, site.id);
  return { owner, site, failed };
}

describe('anyone but an operator gets 404, and nothing is read', () => {
  it.each(['signed out', 'signed in', 'a member of the account'] as const)('%s', async (who) => {
    const { owner, failed } = await world();
    as(who === 'signed out' ? null : who === 'signed in' ? await person(h.db, 'x') : owner);
    const before = (await recordLines(h.db)).length;
    const res = await rerun(failed);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ code: 'not_found' });
    expect(h.log).not.toContain('supabaseAdmin');
    expect(h.send).not.toHaveBeenCalled();
    expect((await recordLines(h.db)).length).toBe(before);
  });
});

describe("an operator's re-run", () => {
  it('queues a check, sends its event and records the re-run, then goes back to the account', async () => {
    pinBucket();
    const op = await operatorPerson(h.db);
    const { owner, site, failed } = await world();
    as(op);
    const res = await rerun(failed);
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe(
      `/internal/accounts/${owner.accountId}?done=rerun_queued`,
    );
    expect(h.send).toHaveBeenCalledOnce();
    const { rows } = await h.db.query(
      `select status, trigger from public.checks where site_id = $1 and status = 'queued'`,
      [site.id],
    );
    expect(rows).toEqual([{ status: 'queued', trigger: 'manual' }]);
    expect((await recordLines(h.db)).at(-1)).toEqual({
      operator_id: op.id,
      action: 'rerun_check',
      account_id: owner.accountId,
      target: failed,
      reason: 'stuck since Tuesday',
      outcome: 'created',
    });
  });

  it("is capped at the account's own manual checks a day, and recorded as capped", async () => {
    const op = await operatorPerson(h.db);
    const { owner, site, failed } = await world();
    for (let i = 0; i < GATES.free.manualChecksPerSiteDay; i++) {
      await h.db.query(
        `insert into public.checks (id, site_id, status, trigger, grade_version, queued_at,
                                    started_at, finished_at, failure_reason)
         values (gen_random_uuid(), $1, 'failed', 'manual', '2.0.0', now() - interval '1 hour',
                 now() - interval '1 hour', now() - interval '1 hour', 'internal')`,
        [site.id],
      );
    }
    as(op);
    const res = await rerun(failed);
    expect(res.headers.get('location')).toBe(`/internal/accounts/${owner.accountId}?done=capped`);
    expect(h.send).not.toHaveBeenCalled();
    expect((await recordLines(h.db)).at(-1)?.outcome).toBe('capped');
  });

  it.each([
    ['no reason', ''],
    ['an empty reason', 'reason=+++'],
    ['a reason holding an address', `reason=${encodeURIComponent(['a', 'example.com'].join('@'))}`],
  ])('refuses %s, records nothing and sends nothing', async (_name, body) => {
    const op = await operatorPerson(h.db);
    const { owner, failed } = await world();
    as(op);
    const before = (await recordLines(h.db)).length;
    const res = await rerun(failed, body);
    expect(res.headers.get('location')).toBe(
      `/internal/accounts/${owner.accountId}?done=reason_invalid`,
    );
    expect((await recordLines(h.db)).length).toBe(before);
    expect(h.send).not.toHaveBeenCalled();
  });

  /** The line a refusal made in the route writes: the outcome is the refusal. */
  const refusedLine = (op: Person, accountId: string, target: string, outcome: string) => ({
    operator_id: op.id,
    action: 'rerun_check',
    account_id: accountId,
    target,
    reason: 'stuck since Tuesday',
    outcome,
  });

  it('refuses a check that did not fail, and records the refusal', async () => {
    const op = await operatorPerson(h.db);
    const { owner, site } = await world();
    const { rows } = await h.db.query<{ id: string }>(
      `insert into public.checks (id, site_id, status, trigger, grade_version, queued_at)
       values (gen_random_uuid(), $1, 'queued', 'scheduled', '2.0.0', now()) returning id`,
      [site.id],
    );
    as(op);
    const res = await rerun(rows[0]!.id);
    expect(res.headers.get('location')).toBe(
      `/internal/accounts/${owner.accountId}?done=not_failed`,
    );
    expect(h.send).not.toHaveBeenCalled();
    expect((await recordLines(h.db)).at(-1)).toEqual(
      refusedLine(op, owner.accountId, rows[0]!.id, 'not_failed'),
    );
  });

  it('refuses while crawls are paused, and while the pipeline is off, and records each', async () => {
    const op = await operatorPerson(h.db);
    const { owner, failed } = await world();
    as(op);
    vi.stubEnv('CRAWL_PAUSED', '1');
    expect((await rerun(failed)).headers.get('location')).toBe(
      `/internal/accounts/${owner.accountId}?done=crawl_paused`,
    );
    expect((await recordLines(h.db)).at(-1)).toEqual(
      refusedLine(op, owner.accountId, failed, 'crawl_paused'),
    );
    vi.stubEnv('CRAWL_PAUSED', '');
    vi.stubEnv('V2_PIPELINE', '');
    expect((await rerun(failed)).headers.get('location')).toBe(
      `/internal/accounts/${owner.accountId}?done=unavailable`,
    );
    expect((await recordLines(h.db)).at(-1)).toEqual(
      refusedLine(op, owner.accountId, failed, 'unavailable'),
    );
    expect(h.send).not.toHaveBeenCalled();
  });

  it.each([
    ['removed', 'update public.sites set removed_at = now() where id = $1', 'site_removed'],
    ['paused', `update public.sites set paused_reason = 'user' where id = $1`, 'site_paused'],
  ])('refuses a check of a %s site, and records the refusal', async (_name, sql, code) => {
    const op = await operatorPerson(h.db);
    const { owner, site, failed } = await world();
    await h.db.query(sql, [site.id]);
    as(op);
    const res = await rerun(failed);
    expect(res.headers.get('location')).toBe(`/internal/accounts/${owner.accountId}?done=${code}`);
    expect(h.send).not.toHaveBeenCalled();
    expect((await recordLines(h.db)).at(-1)).toEqual(
      refusedLine(op, owner.accountId, failed, code),
    );
  });

  it.each(['pro', 'agency'] as const)(
    "a %s account is capped at 10 manual checks a day, not Free's 2",
    async (tier) => {
      pinBucket();
      const op = await operatorPerson(h.db);
      as(op);
      const withManual = async (n: number) => {
        const w = await world();
        await makePaid(h.db, w.owner.accountId, tier);
        for (let i = 0; i < n; i++) {
          await h.db.query(
            `insert into public.checks (id, site_id, status, trigger, grade_version, queued_at,
                                        started_at, finished_at, failure_reason)
             values (gen_random_uuid(), $1, 'failed', 'manual', '2.0.0', now() - interval '1 hour',
                     now() - interval '1 hour', now() - interval '1 hour', 'internal')`,
            [w.site.id],
          );
        }
        return w;
      };
      const under = await withManual(9);
      expect((await rerun(under.failed)).headers.get('location')).toBe(
        `/internal/accounts/${under.owner.accountId}?done=rerun_queued`,
      );
      const at = await withManual(10);
      expect((await rerun(at.failed)).headers.get('location')).toBe(
        `/internal/accounts/${at.owner.accountId}?done=capped`,
      );
    },
  );

  it('answers 404 for an id that is malformed or names no check', async () => {
    as(await operatorPerson(h.db));
    expect((await rerun('not-an-id')).status).toBe(404);
    expect((await rerun(randomUUID())).status).toBe(404);
  });
});
