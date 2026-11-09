import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

// The row converters are workstream A's (rows.ts); these tests are about the statements, so the
// converters pass rows through.
vi.mock('./rows', () => ({
  checkFromRow: (r: unknown) => r,
  siteFromRow: (r: unknown) => r,
  fixFromRow: (r: unknown) => r,
  fixEventFromRow: (r: unknown) => r,
  pageResultFromRow: (r: unknown) => r,
  diffInputsFromRow: (r: { diff_inputs: unknown }) => r.diff_inputs ?? null,
}));

import { IN_LIST, PAGE_ROWS, supabasePipelineStore, type PipelineStore } from './store';

type Result = { data: unknown; error: { message: string } | null };
interface Call {
  root: unknown[];
  chain: [string, unknown[]][];
}

/** A supabase-js stand-in that records each query's calls and answers them in order. */
function recorder(...answers: Result[]) {
  const calls: Call[] = [];
  const query = (call: Call): unknown => {
    const proxy: unknown = new Proxy(
      {},
      {
        get: (_, prop) => {
          if (prop === 'then') {
            const answer = answers.shift() ?? { data: null, error: null };
            return (resolve: (v: Result) => void) => resolve(answer);
          }
          return (...args: unknown[]) => {
            call.chain.push([String(prop), args]);
            return proxy;
          };
        },
      },
    );
    return proxy;
  };
  const start = (root: unknown[]) => {
    const call: Call = { root, chain: [] };
    calls.push(call);
    return query(call);
  };
  const sb = {
    from: (table: string) => start(['from', table]),
    rpc: (name: string, args: unknown) => start(['rpc', name, args]),
  } as unknown as SupabaseClient;
  return { sb, calls };
}

const ok = (data: unknown): Result => ({ data, error: null });

interface Case {
  answers: Result[];
  call: (store: PipelineStore) => Promise<unknown>;
  calls: Call[];
}
const C = 'c0000000-0000-4000-8000-000000000000';
const S = 's0000000-0000-4000-8000-000000000000';
const BATCH_ROW = {
  check_id: C,
  batch: 3,
  kind: 'crawl' as const,
  nonce: 'n'.repeat(24),
  posted_at: 'T',
  summary: { urls: 50, max_seconds: 240 },
};
const QUEUED_ROW = {
  id: C,
  site_id: S,
  trigger: 'manual' as const,
  grade_version: '1.0.0',
  queued_at: 'T',
  heartbeat_at: 'T',
  expires_at: null,
};
const PROGRESS = {
  steps: [{ phase: 'robots_and_sitemap' as const, state: 'now' as const }],
  pages_crawled: 0,
  pages_estimated: null,
  links_found: 0,
  elapsed_ms: 0,
  recent_fetches: [],
};

describe('supabasePipelineStore: the race-critical statements are 008’s functions', () => {
  it('claims through claim_check', async () => {
    const { sb, calls } = recorder(ok('site_busy'));
    expect(await supabasePipelineStore(sb).claim(C, 'run-1', PROGRESS)).toBe('site_busy');
    expect(calls).toEqual([
      {
        root: ['rpc', 'claim_check', { p_check: C, p_run: 'run-1', p_progress: PROGRESS }],
        chain: [],
      },
    ]);
  });

  it('refuses a claim answer it does not know', async () => {
    const { sb } = recorder(ok('maybe'));
    await expect(supabasePipelineStore(sb).claim(C, 'r', PROGRESS)).rejects.toThrow(
      /claim_check answered maybe/,
    );
  });

  it('fails through fail_check, by check or by run', async () => {
    const { sb, calls } = recorder(ok(true), ok(false));
    const store = supabasePipelineStore(sb);
    expect(await store.fail(C, 'paused', null)).toBe(true);
    expect(await store.fail(null, 'canceled', 'run-9')).toBe(false);
    expect(calls.map((c) => c.root)).toEqual([
      ['rpc', 'fail_check', { p_check: C, p_reason: 'paused', p_run: null }],
      ['rpc', 'fail_check', { p_check: null, p_reason: 'canceled', p_run: 'run-9' }],
    ]);
  });

  it('refuses a failure reason outside FAILURE_REASONS before calling fail_check', async () => {
    const { sb, calls } = recorder(ok(true));
    await expect(
      supabasePipelineStore(sb).fail(C, 'ECONNRESET at https://example.com' as never, null),
    ).rejects.toThrow('outside FAILURE_REASONS');
    expect(calls).toEqual([]);
  });

  it('reaps through reap_stalled_checks with the cutoff it is given', async () => {
    const { sb, calls } = recorder(
      ok([
        { check_id: C, site_id: S, reason: 'stalled' },
        { check_id: 'c2', site_id: S, reason: 'not_started' },
      ]),
    );
    const reaped = await supabasePipelineStore(sb).reap('2026-11-08T11:30:00.000Z');
    expect(calls[0]!.root).toEqual([
      'rpc',
      'reap_stalled_checks',
      { p_cutoff: '2026-11-08T11:30:00.000Z' },
    ]);
    expect(reaped).toEqual([
      { checkId: C, siteId: S, reason: 'stalled' },
      { checkId: 'c2', siteId: S, reason: 'not_started' },
    ]);
  });

  it('refuses a reap reason outside the two it knows', async () => {
    const { sb } = recorder(ok([{ check_id: C, site_id: S, reason: 'boom' }]));
    await expect(supabasePipelineStore(sb).reap('x')).rejects.toThrow(/gave reason boom/);
  });
});

describe('supabasePipelineStore: each method’s statements, whole (quality 2)', () => {
  const page = (from: number) => ['range', [from, from + PAGE_ROWS - 1]] as [string, unknown[]];

  /**
   * Every call each method makes, root and chain, in order: each filter that scopes a read or a write
   * to its check or site, each order and each page. `answers` are what the recorder replies.
   */
  const CASES: Record<keyof PipelineStore, Case> = {
    claim: {
      answers: [ok('claimed')],
      call: (s) => s.claim(C, 'run-1', PROGRESS),
      calls: [
        {
          root: ['rpc', 'claim_check', { p_check: C, p_run: 'run-1', p_progress: PROGRESS }],
          chain: [],
        },
      ],
    },
    fail: {
      answers: [ok(true)],
      call: (s) => s.fail(null, 'canceled', 'run-9'),
      calls: [
        {
          root: ['rpc', 'fail_check', { p_check: null, p_reason: 'canceled', p_run: 'run-9' }],
          chain: [],
        },
      ],
    },
    reap: {
      answers: [ok([])],
      call: (s) => s.reap('T'),
      calls: [{ root: ['rpc', 'reap_stalled_checks', { p_cutoff: 'T' }], chain: [] }],
    },
    checkOfRun: {
      answers: [ok(null)],
      call: (s) => s.checkOfRun('run-9'),
      calls: [
        {
          root: ['from', 'checks'],
          chain: [
            ['select', ['id, site_id']],
            ['eq', ['inngest_run_id', 'run-9']],
            ['maybeSingle', []],
          ],
        },
      ],
    },
    siteOf: {
      answers: [ok({ site_id: S })],
      call: (s) => s.siteOf(C),
      calls: [
        {
          root: ['from', 'checks'],
          chain: [
            ['select', ['site_id']],
            ['eq', ['id', C]],
            ['maybeSingle', []],
          ],
        },
      ],
    },
    progress: {
      answers: [ok(null)],
      call: (s) => s.progress(C, PROGRESS, 'T'),
      calls: [
        {
          root: ['from', 'checks'],
          chain: [
            ['update', [{ progress: PROGRESS, heartbeat_at: 'T' }]],
            ['eq', ['id', C]],
            ['eq', ['status', 'running']],
          ],
        },
      ],
    },
    check: {
      answers: [ok({ id: C })],
      call: (s) => s.check(C),
      calls: [
        {
          root: ['from', 'checks'],
          chain: [
            ['select', ['*']],
            ['eq', ['id', C]],
            ['single', []],
          ],
        },
      ],
    },
    site: {
      // siteFromRow reads the report schedule from the row, embedded under `report_schedules`.
      answers: [ok({ id: S, report_schedules: [] })],
      call: (s) => s.site(S),
      calls: [
        {
          root: ['from', 'sites'],
          chain: [
            ['select', ['*, report_schedules(*)']],
            ['eq', ['id', S]],
            ['single', []],
          ],
        },
      ],
    },
    requestSite: {
      answers: [ok({ id: S })],
      call: (s) => s.requestSite(S),
      calls: [
        {
          root: ['from', 'sites'],
          chain: [
            ['select', ['id, account_id, host, next_check_at']],
            ['eq', ['id', S]],
            ['single', []],
          ],
        },
      ],
    },
    previousGraded: {
      answers: [ok(null)],
      call: (s) => s.previousGraded(S, C),
      calls: [
        {
          root: ['from', 'checks'],
          chain: [
            ['select', ['*']],
            ['eq', ['site_id', S]],
            ['neq', ['id', C]],
            ['in', ['status', ['finished', 'partial']]],
            ['order', ['finished_at', { ascending: false }]],
            ['order', ['id', { ascending: false }]],
            ['limit', [1]],
            ['maybeSingle', []],
          ],
        },
      ],
    },
    fixes: {
      answers: [ok([{ id: 'f1' }]), ok([])],
      call: (s) => s.fixes(S),
      calls: [0, 1].map((from) => ({
        root: ['from', 'site_fixes'],
        chain: [['select', ['*']], ['eq', ['site_id', S]], ['order', ['id']], page(from)],
      })),
    },
    fixEvents: {
      answers: [ok([{ id: 'e1' }]), ok([])],
      call: (s) => s.fixEvents(['f1', 'f2']),
      calls: [0, 1].map((from) => ({
        root: ['from', 'fix_events'],
        chain: [['select', ['*']], ['in', ['fix_id', ['f1', 'f2']]], ['order', ['id']], page(from)],
      })),
    },
    pageStates: {
      answers: [ok([{ url: 'https://example.com/a', without_js: { state: 'readable' } }]), ok([])],
      call: (s) => s.pageStates(C),
      calls: [0, 1].map((from) => ({
        root: ['from', 'page_results'],
        chain: [
          ['select', ['url, without_js']],
          ['eq', ['check_id', C]],
          ['not', ['without_js', 'is', null]],
          ['order', ['url']],
          page(from),
        ],
      })),
    },
    batch: {
      answers: [ok(null)],
      call: (s) => s.batch(C, 3),
      calls: [
        {
          root: ['from', 'crawl_batches'],
          chain: [
            ['select', ['*']],
            ['eq', ['check_id', C]],
            ['eq', ['batch', 3]],
            ['maybeSingle', []],
          ],
        },
      ],
    },
    batches: {
      answers: [ok([{ batch: 1 }]), ok([])],
      call: (s) => s.batches(C),
      calls: [0, 1].map((from) => ({
        root: ['from', 'crawl_batches'],
        chain: [['select', ['*']], ['eq', ['check_id', C]], ['order', ['batch']], page(from)],
      })),
    },
    upsertBatch: {
      // The row exists (the insert adds none), so the second statement writes over it.
      answers: [ok([]), ok([{ batch: 3 }])],
      call: (s) => s.upsertBatch(BATCH_ROW),
      calls: [
        {
          root: ['from', 'crawl_batches'],
          chain: [
            [
              'upsert',
              [
                { ...BATCH_ROW, status: 'posted', finished_at: null, result_path: null },
                { onConflict: 'check_id,batch', ignoreDuplicates: true },
              ],
            ],
            ['select', ['batch']],
          ],
        },
        {
          root: ['from', 'crawl_batches'],
          chain: [
            [
              'update',
              [
                {
                  kind: 'crawl',
                  nonce: BATCH_ROW.nonce,
                  posted_at: 'T',
                  summary: BATCH_ROW.summary,
                  status: 'posted',
                  finished_at: null,
                  result_path: null,
                },
              ],
            ],
            ['eq', ['check_id', C]],
            ['eq', ['batch', 3]],
            ['neq', ['status', 'done']],
            ['select', ['batch']],
          ],
        },
      ],
    },
    endBatch: {
      answers: [ok(null)],
      call: (s) => s.endBatch(C, 3, { status: 'failed', finished_at: 'T' }),
      calls: [
        {
          root: ['from', 'crawl_batches'],
          chain: [
            ['update', [{ status: 'failed', finished_at: 'T' }]],
            ['eq', ['check_id', C]],
            ['eq', ['batch', 3]],
            ['eq', ['status', 'posted']],
          ],
        },
      ],
    },
    insertQueued: {
      answers: [ok([{ id: C }])],
      call: (s) => s.insertQueued(QUEUED_ROW),
      calls: [
        {
          root: ['from', 'checks'],
          chain: [
            [
              'upsert',
              [
                { ...QUEUED_ROW, status: 'queued' },
                { onConflict: 'id', ignoreDuplicates: true },
              ],
            ],
            ['select', ['id']],
          ],
        },
      ],
    },
  };

  it('has a case for each of the store’s methods', () => {
    expect(Object.keys(CASES).sort()).toEqual(
      Object.keys(supabasePipelineStore(recorder().sb)).sort(),
    );
  });

  it.each(Object.entries(CASES))('%s', async (_, c) => {
    const { sb, calls } = recorder(...c.answers);
    await c.call(supabasePipelineStore(sb));
    expect(calls).toEqual(c.calls);
  });
});

describe('supabasePipelineStore: answers', () => {
  it('fails by check or by run, and gives fail_check’s answer', async () => {
    const { sb } = recorder(ok(true), ok(false));
    const store = supabasePipelineStore(sb);
    expect(await store.fail(C, 'paused', null)).toBe(true);
    expect(await store.fail(null, 'canceled', 'run-9')).toBe(false);
  });

  it('reads the site a check belongs to, or null when there is no such check', async () => {
    const { sb } = recorder(ok({ site_id: S }), ok(null));
    const store = supabasePipelineStore(sb);
    expect(await store.siteOf(C)).toBe(S);
    expect(await store.siteOf(C)).toBeNull();
  });

  it('finds the check a run claimed by its run id', async () => {
    const { sb } = recorder(ok({ id: C, site_id: S }));
    expect(await supabasePipelineStore(sb).checkOfRun('run-9')).toEqual({ checkId: C, siteId: S });
  });

  it('reads the previous graded check with its diff inputs, or null', async () => {
    const inputs = { page_cap: 500, robots_txt: '', detectors: [], indeterminate: [] };
    const { sb } = recorder(ok({ id: 'p1', diff_inputs: inputs }), ok(null));
    const store = supabasePipelineStore(sb);
    expect(await store.previousGraded(S, C)).toEqual({
      check: { id: 'p1', diff_inputs: inputs },
      ...inputs,
    });
    expect(await store.previousGraded(S, C)).toBeNull();
  });

  it('posts a new batch with the insert alone', async () => {
    const { sb, calls } = recorder(ok([{ batch: 3 }]));
    await supabasePipelineStore(sb).upsertBatch(BATCH_ROW);
    expect(calls).toHaveLength(1);
  });

  it('refuses to write over a batch that is done (correctness 3)', async () => {
    const { sb } = recorder(ok([]), ok([]));
    await expect(supabasePipelineStore(sb).upsertBatch(BATCH_ROW)).rejects.toThrow(
      `pipeline store: batch 3 of check ${C} is done; it is not posted again`,
    );
  });

  it('says whether it inserted a queued check', async () => {
    const { sb } = recorder(ok([{ id: C }]), ok([]));
    const store = supabasePipelineStore(sb);
    expect(await store.insertQueued(QUEUED_ROW)).toBe(true);
    expect(await store.insertQueued(QUEUED_ROW)).toBe(false);
  });

  it('throws on a PostgREST error, naming the statement', async () => {
    const { sb } = recorder({ data: null, error: { message: 'permission denied' } });
    await expect(supabasePipelineStore(sb).check(C)).rejects.toThrow(
      'pipeline store: check: permission denied',
    );
  });
});

describe('supabasePipelineStore: lists are read whole', () => {
  const rows = (n: number, from = 0) =>
    Array.from({ length: n }, (_, i) => ({ id: `f${from + i}` }));

  it('pages a list past PostgREST’s row cap, and stops on an empty page', async () => {
    const { sb, calls } = recorder(ok(rows(PAGE_ROWS)), ok(rows(3, PAGE_ROWS)), ok([]));
    const fixes = await supabasePipelineStore(sb).fixes(S);
    expect(fixes).toHaveLength(PAGE_ROWS + 3);
    expect(calls.map((c) => c.chain.find(([m]) => m === 'range'))).toEqual([
      ['range', [0, PAGE_ROWS - 1]],
      ['range', [PAGE_ROWS, 2 * PAGE_ROWS - 1]],
      ['range', [PAGE_ROWS + 3, 2 * PAGE_ROWS + 2]],
    ]);
  });

  it('reads the whole list when the server caps pages below PAGE_ROWS', async () => {
    const cap = 400;
    const { sb, calls } = recorder(ok(rows(cap)), ok(rows(cap, cap)), ok(rows(7, 2 * cap)), ok([]));
    const fixes = await supabasePipelineStore(sb).fixes(S);
    expect(fixes.map((f) => f.id)).toEqual(rows(2 * cap + 7).map((r) => r.id));
    expect(calls.map((c) => c.chain.find(([m]) => m === 'range')![1][0])).toEqual([
      0,
      cap,
      2 * cap,
      2 * cap + 7,
    ]);
  });

  it('reads fix events in id lists of IN_LIST', async () => {
    const ids = Array.from({ length: 2 * IN_LIST + 1 }, (_, i) => `x${i}`);
    const { sb, calls } = recorder(ok([]), ok([]), ok([]));
    await supabasePipelineStore(sb).fixEvents(ids);
    expect(calls.map((c) => (c.chain.find(([m]) => m === 'in')![1][1] as string[]).length)).toEqual(
      [IN_LIST, IN_LIST, 1],
    );
  });

  it('reads the previous check’s page states, measured pages only', async () => {
    const { sb } = recorder(
      ok([
        { url: 'https://example.com/a', without_js: { state: 'readable' } },
        { url: 'https://example.com/b', without_js: { state: 'empty_shell' } },
      ]),
    );
    const states = await supabasePipelineStore(sb).pageStates(C);
    expect([...states]).toEqual([
      ['https://example.com/a', 'readable'],
      ['https://example.com/b', 'empty_shell'],
    ]);
  });
});
