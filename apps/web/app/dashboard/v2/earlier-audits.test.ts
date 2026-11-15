/**
 * CC-36 D5: the reader behind the dashboard's earlier-audits line. The fake below holds `audits`
 * rows and answers the calls the reader makes, applying each filter to the rows; its `or` accepts
 * exactly the expiry clause v1's own readers send (`lib/audits.ts`) and throws on anything else.
 */
import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { EARLIER_AUDITS_LIMIT, readEarlierAudits } from './earlier-audits';

interface Row {
  id: string;
  user_id: string | null;
  url: string;
  status: string;
  grade: string | null;
  completed_at: string | null;
  expires_at: string | null;
}

function fakeAdmin(rows: Row[], fail?: { message: string }) {
  const calls: unknown[][] = [];
  const client = {
    from(table: string) {
      calls.push(['from', table]);
      let out = rows.slice();
      const keys: [keyof Row, boolean][] = [];
      let limit = Infinity;
      const chain = {
        select(cols: string) {
          calls.push(['select', cols]);
          return chain;
        },
        eq(col: keyof Row, v: unknown) {
          calls.push(['eq', col, v]);
          out = out.filter((r) => r[col] === v);
          return chain;
        },
        or(clause: string) {
          calls.push(['or', clause]);
          const m = /^expires_at\.is\.null,expires_at\.gt\.(\S+)$/.exec(clause);
          if (!m) throw new Error(`unmodelled or: ${clause}`);
          const at = Date.parse(m[1]!);
          out = out.filter((r) => r.expires_at === null || Date.parse(r.expires_at) > at);
          return chain;
        },
        // Each call adds a key after the ones before it, as PostgREST's `order` does.
        order(col: keyof Row, o: { ascending: boolean }) {
          calls.push(['order', col, o]);
          keys.push([col, o.ascending]);
          out.sort((a, b) => {
            for (const [k, asc] of keys) {
              const d = String(a[k]).localeCompare(String(b[k]));
              if (d !== 0) return asc ? d : -d;
            }
            return 0;
          });
          return chain;
        },
        limit(n: number) {
          calls.push(['limit', n]);
          limit = n;
          return chain;
        },
        then<T>(resolve: (v: { data: unknown; error: unknown }) => T) {
          return Promise.resolve(
            fail ? { data: null, error: fail } : { data: out.slice(0, limit), error: null },
          ).then(resolve);
        },
      };
      return chain;
    },
  };
  return { admin: client as unknown as SupabaseClient, calls };
}

const NOW = new Date('2026-11-16T12:00:00.000Z');
const VIEWER = 'u0000000-0000-4000-8000-000000000001';
const OTHER = 'u0000000-0000-4000-8000-000000000002';
const row = (n: number, over: Partial<Row> = {}): Row => ({
  id: `a${String(n).padStart(3, '0')}`,
  user_id: VIEWER,
  url: `https://site-${n}.example/`,
  status: 'completed',
  grade: 'B',
  // One day apart, newest last.
  completed_at: new Date(Date.UTC(2026, 9, 1 + n)).toISOString(),
  expires_at: null,
  ...over,
});

describe('readEarlierAudits', () => {
  it('reads the viewer’s own completed audits only, never another user’s or an unfinished one', async () => {
    const { admin, calls } = fakeAdmin([
      row(1),
      row(2, { user_id: OTHER }),
      row(3, { status: 'failed' }),
      row(4, { user_id: null }),
    ]);
    expect((await readEarlierAudits(admin, VIEWER, NOW)).map((a) => a.id)).toEqual(['a001']);
    expect(calls).toContainEqual(['from', 'audits']);
    expect(calls).toContainEqual(['eq', 'user_id', VIEWER]);
  });

  it('leaves out an audit whose expiry has passed, and keeps one with none or a later one', async () => {
    const { admin } = fakeAdmin([
      row(1, { expires_at: '2026-11-16T11:59:59.000Z' }),
      row(2, { expires_at: '2026-11-16T12:00:00.000Z' }),
      row(3, { expires_at: '2026-11-16T12:00:01.000Z' }),
      row(4, { expires_at: null }),
    ]);
    expect((await readEarlierAudits(admin, VIEWER, NOW)).map((a) => a.id)).toEqual([
      'a004',
      'a003',
    ]);
  });

  it(`answers at most ${EARLIER_AUDITS_LIMIT}, newest first, as the view reads them`, async () => {
    const { admin } = fakeAdmin(Array.from({ length: 25 }, (_, i) => row(i + 1)));
    const got = await readEarlierAudits(admin, VIEWER, NOW);
    expect(EARLIER_AUDITS_LIMIT).toBe(20);
    expect(got).toHaveLength(20);
    expect(got[0]).toEqual({
      id: 'a025',
      url: 'https://site-25.example/',
      grade: 'B',
      completedAt: '2026-10-26T00:00:00.000Z',
    });
    expect(got.at(-1)?.id).toBe('a006');
  });

  it('orders audits finished at the same instant by id, descending', async () => {
    const at = '2026-10-05T00:00:00.000Z';
    const { admin } = fakeAdmin([
      row(1, { completed_at: at }),
      row(3, { completed_at: at }),
      row(2, { completed_at: at }),
    ]);
    expect((await readEarlierAudits(admin, VIEWER, NOW)).map((a) => a.id)).toEqual([
      'a003',
      'a002',
      'a001',
    ]);
  });

  it('throws a read error rather than answering none', async () => {
    const { admin } = fakeAdmin([row(1)], { message: 'down' });
    await expect(readEarlierAudits(admin, VIEWER, NOW)).rejects.toThrow(/down/);
  });
});
