import { describe, expect, it, vi } from 'vitest';
import { STEP_OUTPUT_BYTES } from './check';
import { inngest } from './client';
import {
  createScheduleTickFn,
  SCHEDULE_PAGE,
  SCHEDULE_ROUNDS,
  SCHEDULE_TICK_FN_ID,
  type Claim,
  type ClaimedSite,
  type GlobalSlot,
  type ScheduleDeps,
} from './schedule';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const GLOBAL: GlobalSlot = {
  bucket: 'global:audits:day',
  window_start: '2026-11-13T00:00:00.000Z',
};
const SLOT = '2026-11-09T06:00:00.000Z';
const NEXT = '2026-11-16T06:00:00.000Z';

/**
 * Runs a handler as Inngest does, closely enough for these tests (past-due-sweep.test.ts's harness,
 * which this one extends with replays after a step that returns). A step that returns is recorded
 * (through JSON), ends the invocation, and is returned on every later invocation, which runs the
 * handler again from the top: code outside a step runs on every replay. A step that throws stops the
 * invocation and is run again on the next one; once it has thrown `attempts` times its error is
 * recorded and thrown into the handler, where code may catch it.
 */
function inngestLike(attempts = 3) {
  const memo = new Map<string, { value: unknown } | { error: Error }>();
  const tries = new Map<string, number>();
  const ran: string[] = [];
  let invocations = 0;
  let interrupt: () => void = () => {};
  const step = {
    run: async (id: string, fn: () => unknown) => {
      const seen = memo.get(id);
      if (seen) {
        if ('error' in seen) throw seen.error;
        return seen.value;
      }
      ran.push(id);
      try {
        const value = JSON.parse(JSON.stringify((await fn()) ?? null)) as unknown;
        memo.set(id, { value });
      } catch (err) {
        const n = (tries.get(id) ?? 0) + 1;
        tries.set(id, n);
        if (n < attempts) {
          interrupt();
          return new Promise(() => {});
        }
        const error = new Error(`step ${id} failed: ${(err as Error).message}`);
        memo.set(id, { error });
        throw error;
      }
      // A step that ran ends the invocation; the next one replays the handler from the top.
      interrupt();
      return new Promise(() => {});
    },
  };
  async function execute(handler: Handler): Promise<{ out: unknown } | { error: Error }> {
    for (;;) {
      invocations += 1;
      const stopped = new Promise<null>((resolve) => {
        interrupt = () => resolve(null);
      });
      const settled = handler({ step }).then(
        (out) => ({ out }),
        (error: Error) => ({ error }),
      );
      const result = await Promise.race([settled, stopped]);
      if (result !== null) return result;
    }
  }
  return { execute, memo, ran, tries, invocations: () => invocations };
}

type Handler = (ctx: { step: unknown }) => Promise<unknown>;
const handlerOf = (deps: ScheduleDeps) =>
  (createScheduleTickFn(() => deps) as unknown as { fn: Handler }).fn;

function fakeDeps(claims: Claim[], over: Partial<ScheduleDeps> = {}) {
  const queue = [...claims];
  return {
    paused: vi.fn<ScheduleDeps['paused']>(over.paused ?? (() => false)),
    claim: vi.fn<ScheduleDeps['claim']>(
      over.claim ?? (async () => queue.shift() ?? { global: GLOBAL, sites: [] }),
    ),
    request: vi.fn<ScheduleDeps['request']>(
      over.request ?? (async (s) => ({ checkId: `check-of-${s.siteId}`, created: true })),
    ),
    release: vi.fn<ScheduleDeps['release']>(
      over.release ?? (async () => ({ restored: true, slot_released: true })),
    ),
    report: vi.fn<ScheduleDeps['report']>(over.report ?? (() => {})),
  };
}

describe('scheduleTickFn config (D4)', () => {
  it('runs at the top of every hour, one run at a time', () => {
    const [config] = (
      createScheduleTickFn(() => fakeDeps([])) as unknown as {
        getConfig(o: { baseUrl: URL; appPrefix: string }): Record<string, unknown>[];
      }
    ).getConfig({
      baseUrl: new URL('https://crawlmouse.com/api/webhooks/inngest'),
      appPrefix: inngest.id,
    });
    expect(config).toMatchObject({
      id: `crawlmouse-${SCHEDULE_TICK_FN_ID}`,
      triggers: [{ cron: '0 * * * *' }],
      concurrency: { limit: 1 },
    });
    expect(SCHEDULE_TICK_FN_ID).toBe('crawlmouse.schedule.tick');
  });
});

describe('scheduleTickFn steps (D4)', () => {
  it('with CRAWL_PAUSED, returns before claiming', async () => {
    const deps = fakeDeps([{ global: GLOBAL, sites: [{ siteId: A, slot: SLOT, next: NEXT }] }], {
      paused: () => true,
    });
    const run = inngestLike();
    expect(await run.execute(handlerOf(deps))).toEqual({ out: { paused: true } });
    expect(deps.claim).not.toHaveBeenCalled();
    expect(deps.request).not.toHaveBeenCalled();
    expect(run.ran).toEqual(['pause-gate']);
  });

  it('claims, then requests each claimed site in its own step, with the slot it was due at', async () => {
    const sites = [
      { siteId: A, slot: SLOT, next: NEXT },
      { siteId: B, slot: '2026-11-09T07:00:00.000Z', next: NEXT },
    ];
    const deps = fakeDeps([{ global: GLOBAL, sites }]);
    const run = inngestLike();
    expect(await run.execute(handlerOf(deps))).toEqual({
      out: { claimed: 2, requested: 2, released: 0, unreleased: 0 },
    });
    expect(deps.claim).toHaveBeenCalledTimes(1);
    expect(deps.claim).toHaveBeenCalledWith(SCHEDULE_PAGE);
    expect(deps.request.mock.calls).toEqual([[sites[0]], [sites[1]]]);
    expect(run.ran).toEqual([
      'pause-gate',
      'claim-0',
      `request:${A}:${SLOT}`,
      `request:${B}:2026-11-09T07:00:00.000Z`,
    ]);
    expect(deps.release).not.toHaveBeenCalled();
  });

  it('the pause gate is a step: a pause set after the claim does not strand the claimed sites', async () => {
    let paused = false;
    const deps = fakeDeps([{ global: GLOBAL, sites: [{ siteId: A, slot: SLOT, next: NEXT }] }], {
      paused: () => paused,
      claim: async () => {
        paused = true;
        return { global: GLOBAL, sites: [{ siteId: A, slot: SLOT, next: NEXT }] };
      },
    });
    const run = inngestLike();
    const out = await run.execute(handlerOf(deps));
    expect(out).toEqual({ out: { claimed: 1, requested: 1, released: 0, unreleased: 0 } });
    expect(deps.request).toHaveBeenCalledTimes(1);
  });

  it('a request step that fails every retry releases that claim once, reports it once, and the tick goes on', async () => {
    const sites = [
      { siteId: A, slot: SLOT, next: NEXT },
      { siteId: B, slot: '2026-11-09T07:00:00.000Z', next: NEXT },
    ];
    const deps = fakeDeps([{ global: GLOBAL, sites }], {
      request: async (s) => {
        if (s.siteId === A) throw new Error('database unavailable');
        return { checkId: 'x', created: true };
      },
    });
    const run = inngestLike(3);
    expect(await run.execute(handlerOf(deps))).toEqual({
      out: { claimed: 2, requested: 1, released: 1, unreleased: 0 },
    });
    expect(run.tries.get(`request:${A}:${SLOT}`)).toBe(3);
    expect(deps.release.mock.calls).toEqual([[{ siteId: A, slot: SLOT, next: NEXT }, GLOBAL]]);
    expect(deps.report.mock.calls).toEqual([[{ siteId: A, slot: SLOT }, 'released']]);
    // Site id and slot only: no host, no account, no error text.
    expect(Object.keys(deps.report.mock.calls[0]![0]).sort()).toEqual(['siteId', 'slot']);
    expect(deps.request.mock.calls.filter(([s]) => s.siteId === B)).toHaveLength(1);
    expect(run.ran).toContain(`release:${A}:${SLOT}`);
  });

  it('a release step that fails every retry is reported once, and the tick goes on to the next site', async () => {
    const full: Claim = {
      global: GLOBAL,
      sites: Array.from({ length: SCHEDULE_PAGE }, (_, i) => ({
        siteId: i === 0 ? A : `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
        slot: SLOT,
        next: NEXT,
      })),
    };
    const deps = fakeDeps([full, full], {
      request: async (s) => {
        if (s.siteId === A) throw new Error('database unavailable');
        return { checkId: 'x', created: true };
      },
      release: async () => {
        throw new Error('database unavailable');
      },
    });
    const run = inngestLike(3);
    expect(await run.execute(handlerOf(deps))).toEqual({
      out: { claimed: SCHEDULE_PAGE, requested: SCHEDULE_PAGE - 1, released: 0, unreleased: 1 },
    });
    expect(run.tries.get(`release:${A}:${SLOT}`)).toBe(3);
    expect(deps.report.mock.calls).toEqual([[{ siteId: A, slot: SLOT }, 'release_failed']]);
    // Every other site of the page is still requested; no further page is claimed.
    expect(deps.request.mock.calls.filter(([s]) => s.siteId !== A)).toHaveLength(SCHEDULE_PAGE - 1);
    expect(deps.claim).toHaveBeenCalledTimes(1);
  });

  it('a reporter that throws after a failed release does not stop the tick', async () => {
    const deps = fakeDeps(
      [
        {
          global: GLOBAL,
          sites: [
            { siteId: A, slot: SLOT, next: NEXT },
            { siteId: B, slot: SLOT, next: NEXT },
          ],
        },
      ],
      {
        request: async (s) => {
          if (s.siteId === A) throw new Error('down');
          return { checkId: 'x', created: true };
        },
        release: async () => {
          throw new Error('down');
        },
        report: () => {
          throw new Error('sentry down');
        },
      },
    );
    expect(await inngestLike(3).execute(handlerOf(deps))).toEqual({
      out: { claimed: 2, requested: 1, released: 0, unreleased: 1 },
    });
    expect(deps.report).toHaveBeenCalledTimes(1);
  });

  it('a request that succeeds on a retry releases nothing', async () => {
    let n = 0;
    const deps = fakeDeps([{ global: GLOBAL, sites: [{ siteId: A, slot: SLOT, next: NEXT }] }], {
      request: async () => {
        n += 1;
        if (n < 2) throw new Error('blip');
        return { checkId: 'x', created: true };
      },
    });
    const run = inngestLike(3);
    expect(await run.execute(handlerOf(deps))).toEqual({
      out: { claimed: 1, requested: 1, released: 0, unreleased: 0 },
    });
    expect(deps.release).not.toHaveBeenCalled();
    expect(deps.report).not.toHaveBeenCalled();
  });

  it('claims again while a page comes back full, up to SCHEDULE_ROUNDS pages', async () => {
    const page = (n: number): Claim => ({
      global: GLOBAL,
      sites: Array.from({ length: SCHEDULE_PAGE }, (_, i) => ({
        siteId: `00000000-0000-4000-8000-${String(n * 1000 + i).padStart(12, '0')}`,
        slot: SLOT,
        next: NEXT,
      })),
    });
    const deps = fakeDeps(Array.from({ length: SCHEDULE_ROUNDS + 2 }, (_, i) => page(i)));
    const run = inngestLike();
    const out = await run.execute(handlerOf(deps));
    expect(deps.claim).toHaveBeenCalledTimes(SCHEDULE_ROUNDS);
    expect(out).toEqual({
      out: {
        claimed: SCHEDULE_ROUNDS * SCHEDULE_PAGE,
        requested: SCHEDULE_ROUNDS * SCHEDULE_PAGE,
        released: 0,
        unreleased: 0,
      },
    });
  });

  it('stops claiming after a page that is not full', async () => {
    const deps = fakeDeps([
      { global: GLOBAL, sites: [{ siteId: A, slot: SLOT, next: NEXT }] },
      { global: GLOBAL, sites: [{ siteId: B, slot: SLOT, next: NEXT }] },
    ]);
    await inngestLike().execute(handlerOf(deps));
    expect(deps.claim).toHaveBeenCalledTimes(1);
  });

  it('stops claiming after a release, so a released site is not claimed again in the same tick', async () => {
    const full: Claim = {
      global: GLOBAL,
      sites: Array.from({ length: SCHEDULE_PAGE }, (_, i) => ({
        siteId: i === 0 ? A : `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
        slot: SLOT,
        next: NEXT,
      })),
    };
    const deps = fakeDeps([full, { global: GLOBAL, sites: [{ siteId: A, slot: SLOT, next: NEXT }] }], {
      request: async (s) => {
        if (s.siteId === A) throw new Error('down');
        return { checkId: 'x', created: true };
      },
    });
    await inngestLike().execute(handlerOf(deps));
    expect(deps.claim).toHaveBeenCalledTimes(1);
    expect(deps.release).toHaveBeenCalledTimes(1);
  });

  it('a full page of claims returns under the step output bound', () => {
    // A uuid is 36 characters and a toISOString() 24, always: this is the longest a page can be.
    const sites: ClaimedSite[] = Array.from({ length: SCHEDULE_PAGE }, () => ({
      siteId: 'ffffffff-ffff-4fff-bfff-ffffffffffff',
      slot: '2026-11-09T06:00:00.000Z',
      next: '2026-11-16T06:00:00.000Z',
    }));
    const page: Claim = { global: GLOBAL, sites };
    expect(Buffer.byteLength(JSON.stringify(page))).toBeLessThan(STEP_OUTPUT_BYTES);
  });

  it('stays under Inngest’s 1,000 steps a run at the most it can do', () => {
    // pause gate + one claim a round + a request, a release and a release-failed report per site.
    expect(1 + SCHEDULE_ROUNDS + 3 * SCHEDULE_ROUNDS * SCHEDULE_PAGE).toBeLessThan(1000);
  });
});

/**
 * The Q9 ruling end to end over a fake of the two SQL functions' contract (the SQL itself is pinned
 * in apps/web/__tests__/v2-028-schedule.test.ts): a claim takes a slot and moves the site's due time
 * past now; a release that finds the due time the claim set puts it back and returns the slot while its
 * day is open.
 */
function fakeSchedule(now: string) {
  const site = { id: A, next: SLOT };
  let count = 0;
  const deps = (requestFails: boolean): ScheduleDeps => ({
    paused: () => false,
    claim: async () => {
      if (Date.parse(site.next) > Date.parse(now)) return { global: GLOBAL, sites: [] };
      count += 1;
      const slot = site.next;
      site.next = NEXT;
      return { global: GLOBAL, sites: [{ siteId: site.id, slot, next: NEXT }] };
    },
    request: async () => {
      if (requestFails) throw new Error('down');
      return { checkId: 'x', created: true };
    },
    release: async (s, g) => {
      if (site.next !== s.next) {
        return { restored: false, slot_released: false };
      }
      site.next = s.slot;
      const open = Date.parse(now) < Date.parse(g.window_start) + 24 * 3_600_000;
      if (open && count > 0) count -= 1;
      return { restored: true, slot_released: open };
    },
    report: () => {},
  });
  return { site, deps, count: () => count };
}

describe('owner ruling Q9 over a fake of the SQL: a request that fails every retry gives back what its claim took', () => {
  // The count here is the fake's. The same case over the real functions is
  // apps/web/__tests__/v2-028-schedule.test.ts "scheduleTickFn over claim_due_sites and release_scheduled_claim".
  it('the site is due again on the next tick, and the fake’s slot count is back where it was', async () => {
    const f = fakeSchedule('2026-11-13T10:00:00.000Z');
    expect(f.count()).toBe(0);
    await inngestLike().execute(handlerOf(f.deps(true)));
    expect(f.site.next).toBe(SLOT);
    expect(f.count()).toBe(0);

    const next = fakeDeps([]);
    const second = { ...f.deps(false), request: next.request };
    expect(await inngestLike().execute(handlerOf(second))).toEqual({
      out: { claimed: 1, requested: 1, released: 0, unreleased: 0 },
    });
    expect(next.request.mock.calls).toEqual([[{ siteId: A, slot: SLOT, next: NEXT }]]);
    expect(f.count()).toBe(1);
  });
});
