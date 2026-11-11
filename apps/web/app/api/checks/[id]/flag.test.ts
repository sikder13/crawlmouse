import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The three routes behind V2_CHECKS_PUBLIC (D1): with it unset each answers 404 before the session
 * is asked for or a dependency is built; with it set each hands its handler the viewer the session
 * names. The handlers and the dependency factory are stand-ins here; their own tests are beside them.
 */
const calls = vi.hoisted(() => [] as string[]);
const user = vi.hoisted(() => ({ id: null as string | null }));

vi.mock('@/lib/supabase/server', () => ({
  supabaseServer: async () => {
    calls.push('supabaseServer');
    return {
      auth: {
        getUser: async () => ({ data: { user: user.id === null ? null : { id: user.id } } }),
      },
    };
  },
}));
vi.mock('./_lib/deps', () => ({
  checkRouteDeps: () => {
    calls.push('deps');
    return {};
  },
}));
const handler =
  (name: string) =>
  (...args: unknown[]) => {
    const viewer = args.find((a) => typeof a === 'object' && a !== null && 'userId' in a);
    calls.push(`${name}(${JSON.stringify(viewer)})`);
    return Response.json({ handled: name });
  };
vi.mock('./stream/serve', () => ({ serveStream: handler('stream') }));
vi.mock('./notify/notify', () => ({ notify: handler('notify') }));
vi.mock('./cancel/cancel', () => ({ cancel: handler('cancel') }));

const ID = '0b0e7a52-5f0b-4b53-9c0e-0d4a3a1f2c11';
const ctx = { params: Promise.resolve({ id: ID }) };
const req = (method: string) =>
  new Request(`https://crawlmouse.test/api/checks/${ID}/x`, {
    method,
    ...(method === 'POST'
      ? { body: '{"email":"a@example.com"}', headers: { 'content-type': 'application/json' } }
      : {}),
  });

const routes = [
  ['stream', 'GET', () => import('./stream/route').then((m) => m.GET)],
  ['notify', 'POST', () => import('./notify/route').then((m) => m.POST)],
  ['cancel', 'POST', () => import('./cancel/route').then((m) => m.POST)],
] as const;

beforeEach(() => {
  calls.length = 0;
  user.id = null;
});
afterEach(() => vi.unstubAllEnvs());

describe.each(routes)('/api/checks/[id]/%s', (name, method, load) => {
  it('404 with V2_CHECKS_PUBLIC unset, before the session or a dependency', async () => {
    for (const value of [undefined, '', '0', 'true']) {
      vi.stubEnv('V2_CHECKS_PUBLIC', value as string);
      const res = await (await load())(req(method), ctx);
      expect([value, res.status, await res.json()]).toEqual([value, 404, { code: 'not_found' }]);
    }
    expect(calls).toEqual([]);
  });

  it('with the flag set, hands the handler the session’s viewer', async () => {
    vi.stubEnv('V2_CHECKS_PUBLIC', '1');
    const route = await load();
    expect(await (await route(req(method), ctx)).json()).toEqual({ handled: name });
    user.id = 'user-1';
    await route(req(method), ctx);
    expect(calls.filter((c) => c.startsWith(name))).toEqual([
      `${name}({"userId":null})`,
      `${name}({"userId":"user-1"})`,
    ]);
  });
});
