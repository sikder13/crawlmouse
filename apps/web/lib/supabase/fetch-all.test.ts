import { describe, it, expect, vi } from 'vitest';
import { fetchAll } from './fetch-all';

/**
 * Build a fake PostgREST-ish query builder that returns rows in pages and records
 * every .range() call, so we can prove fetchAll keeps paging past one page.
 */
function fakeClient(rows: Array<{ id: number }>, pageSize: number) {
  const rangeCalls: Array<[number, number]> = [];
  const sb = {
    from() {
      return {
        select() {
          return {
            eq() {
              return {
                range(from: number, to: number) {
                  rangeCalls.push([from, to]);
                  return Promise.resolve({ data: rows.slice(from, to + 1), error: null });
                },
              };
            },
          };
        },
      };
    },
  };
  return { sb, rangeCalls, pageSize };
}

describe('fetchAll', () => {
  it('pages past the first 1000-row window so large result sets are not truncated', async () => {
    const rows = Array.from({ length: 5 }, (_, i) => ({ id: i }));
    const { sb, rangeCalls } = fakeClient(rows, 2);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const out = await fetchAll<{ id: number }>(sb as any, 'pages', 'id', 'audit-1', 2);
    expect(out.map((r) => r.id)).toEqual([0, 1, 2, 3, 4]);
    // 2 + 2 + 1 → it must NOT stop after the first page
    expect(rangeCalls).toEqual([[0, 1], [2, 3], [4, 5]]);
  });

  it('stops after a single short page', async () => {
    const rows = [{ id: 0 }];
    const { sb, rangeCalls } = fakeClient(rows, 1000);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const out = await fetchAll<{ id: number }>(sb as any, 'pages', 'id', 'audit-1');
    expect(out).toHaveLength(1);
    expect(rangeCalls).toEqual([[0, 999]]);
  });

  it('throws on a query error', async () => {
    const sb = {
      from: () => ({ select: () => ({ eq: () => ({ range: () => Promise.resolve({ data: null, error: { message: 'boom' } }) }) }) }),
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await expect(fetchAll(sb as any, 'pages', 'id', 'audit-1')).rejects.toThrow('boom');
  });
});
