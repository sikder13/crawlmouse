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

import { IN_LIST, PAGE_ROWS, supabasePipelineStore } from './store';

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
const C = 'c0000000-0000-4000-8000-000000000000';
const S = 's0000000-0000-4000-8000-000000000000';
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

describe('supabasePipelineStore: one statement per method', () => {
  it('writes progress and the heartbeat on a running check only', async () => {
    const { sb, calls } = recorder(ok(null));
    await supabasePipelineStore(sb).progress(C, PROGRESS, '2026-11-08T12:00:00.000Z');
    expect(calls).toEqual([
      {
        root: ['from', 'checks'],
        chain: [
          ['update', [{ progress: PROGRESS, heartbeat_at: '2026-11-08T12:00:00.000Z' }]],
          ['eq', ['id', C]],
          ['eq', ['status', 'running']],
        ],
      },
    ]);
  });

  it('reads a site with its report schedule embedded, as siteFromRow needs', async () => {
    const { sb, calls } = recorder(ok({ id: S, report_schedules: [] }));
    await supabasePipelineStore(sb).site(S);
    expect(calls[0]).toEqual({
      root: ['from', 'sites'],
      chain: [
        ['select', ['*, report_schedules(*)']],
        ['eq', ['id', S]],
        ['single', []],
      ],
    });
  });

  it('finds the check a run claimed by its run id', async () => {
    const { sb, calls } = recorder(ok({ id: C, site_id: S }));
    expect(await supabasePipelineStore(sb).checkOfRun('run-9')).toEqual({ checkId: C, siteId: S });
    expect(calls[0]!.chain).toEqual([
      ['select', ['id, site_id']],
      ['eq', ['inngest_run_id', 'run-9']],
      ['maybeSingle', []],
    ]);
  });

  it('reads the previous check as the latest other one queued no later', async () => {
    const { sb, calls } = recorder(ok({ id: 'p1' }));
    expect(await supabasePipelineStore(sb).previousCheckId(S, C, '2026-11-08T12:00:00Z')).toBe(
      'p1',
    );
    expect(calls[0]!.chain).toEqual([
      ['select', ['id']],
      ['eq', ['site_id', S]],
      ['neq', ['id', C]],
      ['lte', ['queued_at', '2026-11-08T12:00:00Z']],
      ['order', ['queued_at', { ascending: false }]],
      ['order', ['id', { ascending: false }]],
      ['limit', [1]],
      ['maybeSingle', []],
    ]);
  });

  it('reads the previous graded check, finished or partial, with its diff inputs', async () => {
    const inputs = { page_cap: 500, robots_txt: '', detectors: [], indeterminate: [] };
    const { sb, calls } = recorder(ok({ id: 'p1', diff_inputs: inputs }), ok(null));
    const store = supabasePipelineStore(sb);
    expect(await store.previousGraded(S, C, 'T')).toEqual({
      check: { id: 'p1', diff_inputs: inputs },
      ...inputs,
    });
    expect(await store.previousGraded(S, C, 'T')).toBeNull();
    expect(calls[0]!.chain).toContainEqual(['in', ['status', ['finished', 'partial']]]);
    expect(calls[0]!.chain).toContainEqual(['neq', ['id', C]]);
    expect(calls[0]!.chain).toContainEqual(['lte', ['queued_at', 'T']]);
  });

  it('upserts a batch row on (check_id, batch) as posted, with this attempt’s nonce', async () => {
    const { sb, calls } = recorder(ok(null));
    await supabasePipelineStore(sb).upsertBatch({
      check_id: C,
      batch: 3,
      kind: 'crawl',
      nonce: 'n'.repeat(24),
      posted_at: 'T',
      summary: { urls: 50, max_seconds: 240 },
    });
    expect(calls).toEqual([
      {
        root: ['from', 'crawl_batches'],
        chain: [
          [
            'upsert',
            [
              {
                check_id: C,
                batch: 3,
                kind: 'crawl',
                nonce: 'n'.repeat(24),
                posted_at: 'T',
                summary: { urls: 50, max_seconds: 240 },
                status: 'posted',
                finished_at: null,
                result_path: null,
              },
              { onConflict: 'check_id,batch' },
            ],
          ],
        ],
      },
    ]);
  });

  it('ends a batch only while it is posted, so a released batch stays released', async () => {
    const { sb, calls } = recorder(ok(null));
    await supabasePipelineStore(sb).endBatch(C, 3, { status: 'failed', finished_at: 'T' });
    expect(calls[0]!.chain).toEqual([
      ['update', [{ status: 'failed', finished_at: 'T' }]],
      ['eq', ['check_id', C]],
      ['eq', ['batch', 3]],
      ['eq', ['status', 'posted']],
    ]);
  });

  it('inserts a queued check unless its id exists, and says which', async () => {
    const { sb, calls } = recorder(ok([{ id: C }]), ok([]));
    const store = supabasePipelineStore(sb);
    const row = {
      id: C,
      site_id: S,
      trigger: 'manual' as const,
      grade_version: '1.0.0',
      queued_at: 'T',
      heartbeat_at: 'T',
      expires_at: null,
    };
    expect(await store.insertQueued(row)).toBe(true);
    expect(await store.insertQueued(row)).toBe(false);
    expect(calls[0]!.chain).toEqual([
      [
        'upsert',
        [
          { ...row, status: 'queued' },
          { onConflict: 'id', ignoreDuplicates: true },
        ],
      ],
      ['select', ['id']],
    ]);
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
    const { sb, calls } = recorder(
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
    expect(calls[0]!.chain).toContainEqual(['not', ['without_js', 'is', null]]);
  });
});
