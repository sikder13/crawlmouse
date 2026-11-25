import { describe, expect, it } from 'vitest';
import { inngest } from './client';
import { PLAN_CONCURRENCY_CAP } from './concurrency';
import {
  COMPETITOR_FN_ID,
  COMPETITOR_POLLS_S,
  createCompetitorFn,
  type CompetitorWork,
} from './competitors';

const CHECK = 'c0000000-0000-4000-8000-000000000002';

const config = (fn: unknown) =>
  (
    fn as { getConfig(o: { baseUrl: URL; appPrefix: string }): Record<string, unknown>[] }
  ).getConfig({ baseUrl: new URL('https://example.com/api/inngest'), appPrefix: inngest.id })[0]!;

const work = (over: Partial<CompetitorWork> = {}): CompetitorWork => ({
  latest: async () => CHECK,
  plan: async () => ({ hosts: ['a.example', 'b.example'], accountId: 'acct-1', cap: 2 }),
  start: async (host) => ({ checkId: `check-${host}`, reused: false }),
  ended: async (ids) => ids,
  write: async (_, entries) => ({ written: entries.filter((e) => e.checkId).length }),
  ...over,
});

async function run(
  w: CompetitorWork,
  event: { name: string; data: unknown } = {
    name: 'check.finished',
    data: { checkId: CHECK, siteId: 's', accountId: 'a', status: 'finished' },
  },
) {
  const ids: string[] = [];
  const slept: number[] = [];
  const written: unknown[] = [];
  const fn = createCompetitorFn(
    { ...w, write: async (c, e) => (written.push([c, e]), w.write(c, e)) },
    {},
  ) as unknown as { fn: (ctx: unknown) => Promise<unknown> };
  const out = await fn.fn({
    event,
    step: {
      run: async (id: string, body: () => Promise<unknown>) => {
        ids.push(id);
        return body();
      },
      sleep: async (id: string, ms: number) => {
        ids.push(id);
        slept.push(ms);
      },
    },
  });
  return { out, ids, slept, written };
}

describe('createCompetitorFn (row 18)', () => {
  it('runs on check.finished, one run per check, within the plan cap', () => {
    const c = config(createCompetitorFn(work(), { INNGEST_COMPETITOR_CONCURRENCY: '500' }));
    expect(c).toMatchObject({
      id: `${inngest.id}-${COMPETITOR_FN_ID}`,
      triggers: [{ event: 'check.finished' }, { event: 'competitors.requested' }],
      concurrency: [{ limit: PLAN_CONCURRENCY_CAP }, { key: 'event.data.siteId', limit: 1 }],
    });
  });

  it('stops after the plan when the check audits no competitor', async () => {
    const { out, ids } = await run(work({ plan: async () => ({ skip: 'not_in_plan' }) }));
    expect(out).toEqual({ skip: 'not_in_plan' });
    expect(ids).toEqual(['plan']);
  });

  it('starts each host in a step of its own, waits for them, then writes once', async () => {
    let polls = 0;
    const { out, ids, written } = await run(
      work({ ended: async (list) => (++polls < 2 ? [] : list) }),
    );
    expect(ids).toEqual([
      'plan',
      'start-0',
      'start-1',
      'wait-1',
      'ended-1',
      'wait-2',
      'ended-2',
      'write',
    ]);
    expect(written).toEqual([
      [
        CHECK,
        [
          { host: 'a.example', checkId: 'check-a.example' },
          { host: 'b.example', checkId: 'check-b.example' },
        ],
      ],
    ]);
    expect(out).toEqual({ written: 2 });
  });

  it('does not wait for checks that had ended already', async () => {
    const { ids } = await run(
      work({ start: async (h) => ({ checkId: `old-${h}`, reused: true }) }),
    );
    expect(ids).toEqual(['plan', 'start-0', 'start-1', 'write']);
  });

  it('writes a host it could not start with no check, and waits for none of it', async () => {
    const { written } = await run(
      work({
        start: async (h) =>
          h === 'a.example' ? { skip: 'domain_limit' } : { checkId: 'c-b', reused: false },
      }),
    );
    expect(written).toEqual([
      [
        CHECK,
        [
          { host: 'a.example', checkId: null },
          { host: 'b.example', checkId: 'c-b' },
        ],
      ],
    ]);
  });

  it('gives up waiting after its last poll, and writes what ended', async () => {
    const { written, slept } = await run(
      work({ ended: async (list) => list.filter((id) => id === 'check-a.example') }),
    );
    expect(slept).toEqual(COMPETITOR_POLLS_S.map((s) => s * 1000));
    expect(written).toEqual([
      [
        CHECK,
        [
          { host: 'a.example', checkId: 'check-a.example' },
          { host: 'b.example', checkId: 'check-b.example' },
        ],
      ],
    ]);
  });

  it('waits three hours at most', () => {
    expect(COMPETITOR_POLLS_S.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(3 * 60 * 60);
  });

  it('plans against the site’s latest ended check when the customer changed the list', async () => {
    const asked: string[] = [];
    const { ids, written } = await run(
      work({
        latest: async (siteId) => (asked.push(siteId), CHECK),
      }),
      { name: 'competitors.requested', data: { siteId: 'site-own' } },
    );
    expect(asked).toEqual(['site-own']);
    expect(ids.slice(0, 2)).toEqual(['latest', 'plan']);
    expect((written[0] as [string])[0]).toBe(CHECK);
  });

  it('does nothing for a changed list on a site with no ended check', async () => {
    const { out, ids } = await run(work({ latest: async () => null }), {
      name: 'competitors.requested',
      data: { siteId: 'site-own' },
    });
    expect(out).toEqual({ skip: 'no_check' });
    expect(ids).toEqual(['latest']);
  });

  it('hands each start the account and its daily cap from the plan', async () => {
    const asked: unknown[] = [];
    await run(work({ start: async (...a) => (asked.push(a), { skip: 'x' }) }));
    expect(asked).toEqual([
      ['a.example', 'acct-1', 2],
      ['b.example', 'acct-1', 2],
    ]);
  });
});
