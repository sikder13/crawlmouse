import { beforeEach, describe, expect, it, vi } from 'vitest';

// GET /api/billing/status with V2_BILLING unset answers as on main (CC-03 D1): each branch is pinned
// by its status, its body byte for byte, and every argument of every Supabase call. The mocks are the
// modules main's route imports, so this file passes against main's route as well.

const h = vi.hoisted(() => {
  const calls: unknown[][] = [];
  const state = { user: null as unknown, usersRow: null as unknown };
  const chain = (): unknown =>
    new Proxy(
      {},
      {
        get(_, prop) {
          if (prop === 'then') return undefined;
          return (...args: unknown[]) => {
            calls.push([prop, ...args]);
            return prop === 'maybeSingle'
              ? Promise.resolve({ data: state.usersRow, error: null })
              : chain();
          };
        },
      },
    );
  const client = {
    auth: { getUser: async () => ({ data: { user: state.user }, error: null }) },
    from: (table: string) => {
      calls.push(['from', table]);
      return chain();
    },
  };
  return { calls, state, client };
});

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({ supabaseServer: async () => h.client }));

import { GET } from './route';

async function answer(res: Response) {
  return { status: res.status, type: res.headers.get('content-type'), body: await res.text() };
}

const USERS_READ = [
  ['from', 'users'],
  ['select', 'pro_until'],
  ['eq', 'id', 'u1'],
  ['maybeSingle'],
];

beforeEach(() => {
  delete process.env.V2_BILLING;
  h.calls.length = 0;
  h.state.user = { id: 'u1' };
  h.state.usersRow = null;
});

describe('GET /api/billing/status, V2_BILLING unset (as on main)', () => {
  it('401 {"pro":false} without a session, and nothing read', async () => {
    h.state.user = null;
    expect(await answer(await GET())).toEqual({
      status: 401,
      type: 'application/json',
      body: '{"pro":false}',
    });
    expect(h.calls).toEqual([]);
  });

  it.each([
    ['pro_until in the future', { pro_until: '2999-01-01T00:00:00.000Z' }, true],
    ['pro_until in the past', { pro_until: '2000-01-01T00:00:00.000Z' }, false],
    ['pro_until null', { pro_until: null }, false],
    ['no users row', null, false],
  ])('200 for %s', async (_, row, pro) => {
    h.state.usersRow = row;
    expect(await answer(await GET())).toEqual({
      status: 200,
      type: 'application/json',
      body: `{"pro":${pro}}`,
    });
    expect(h.calls).toEqual(USERS_READ);
  });
});
