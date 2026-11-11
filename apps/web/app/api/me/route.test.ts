import { beforeEach, describe, expect, it, vi } from 'vitest';

// PATCH /api/me (CC-26b D10). The session client and the service-role client are fakes; what the
// update does to the seats table is lib/v2/account/theme.test.ts's, on PGlite.

const h = vi.hoisted(() => {
  const log: string[] = [];
  const state = { user: { id: 'u1' } as unknown, seats: [{ id: 's1' }] as unknown[] };
  const update = vi.fn();
  return {
    log,
    state,
    update,
    session: {
      auth: {
        getUser: async () => {
          log.push('getUser');
          return { data: { user: state.user }, error: null };
        },
      },
    },
    admin: {
      from: (table: string) => ({
        select: () => {
          const q = {
            eq: () => q,
            then: (resolve: (v: unknown) => unknown) =>
              Promise.resolve({ data: state.seats, error: null }).then(resolve),
          };
          return q;
        },
        update: (values: unknown) => {
          const filters: unknown[] = [];
          const q = {
            eq: (col: string, v: unknown) => {
              filters.push([col, v]);
              return q;
            },
            then: (resolve: (v: unknown) => unknown) => {
              update(table, values, filters);
              return Promise.resolve({ error: null }).then(resolve);
            },
          };
          return q;
        },
      }),
    },
  };
});

vi.mock('@/lib/supabase/server', () => ({ supabaseServer: async () => h.session }));
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => {
    h.log.push('supabaseAdmin');
    return h.admin;
  },
}));

import { PATCH, POST } from './route';

const URL_ = 'https://crawlmouse.com/api/me';
const json = (body: unknown, method: 'PATCH' | 'POST' = 'PATCH') =>
  new Request(URL_, {
    method,
    headers: { origin: 'https://crawlmouse.com', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
const form = (body: string, referer?: string) =>
  new Request(URL_, {
    method: 'POST',
    headers: {
      origin: 'https://crawlmouse.com',
      'content-type': 'application/x-www-form-urlencoded',
      ...(referer ? { referer } : {}),
    },
    body,
  });

beforeEach(() => {
  h.log.length = 0;
  h.state.user = { id: 'u1' };
  h.state.seats = [{ id: 's1' }];
  h.update.mockClear();
  vi.stubEnv('V2_CHECKS_PUBLIC', '1');
});

describe('PATCH /api/me', () => {
  it('is a 404 with V2_CHECKS_PUBLIC off, for both verbs, before anything else runs', async () => {
    vi.stubEnv('V2_CHECKS_PUBLIC', '');
    expect((await PATCH(json({ theme: 'dark' }))).status).toBe(404);
    expect((await POST(form('_method=PATCH&theme=dark'))).status).toBe(404);
    expect(h.log).toEqual([]);
  });

  it('answers 401 to a signed-out caller and writes nothing', async () => {
    h.state.user = null;
    const res = await PATCH(json({ theme: 'dark' }));
    expect(res.status).toBe(401);
    expect(h.log).toEqual(['getUser']);
    expect(h.update).not.toHaveBeenCalled();
  });

  it('sets the theme on the caller’s own active seats, keyed by their user id only', async () => {
    const res = await PATCH(json({ theme: 'dark' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ theme: 'dark' });
    expect(h.update).toHaveBeenCalledTimes(1);
    expect(h.update).toHaveBeenCalledWith('seats', { theme: 'dark' }, [
      ['user_id', 'u1'],
      ['status', 'active'],
    ]);
    expect(h.log).toEqual(['getUser', 'supabaseAdmin']);
  });

  it('a form posting PATCH in _method saves it and goes back to the dashboard', async () => {
    const res = await POST(form('_method=PATCH&theme=light'));
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('/dashboard');
    expect(h.update).toHaveBeenCalledWith('seats', { theme: 'light' }, expect.any(Array));
  });

  it.each([
    ['an extra field', { theme: 'dark', role: 'owner' }],
    ['a seat id', { theme: 'dark', seat_id: 'x' }],
    ['an unknown theme', { theme: 'sepia' }],
    ['no theme', {}],
  ])('refuses %s with a 400 and writes nothing', async (_name, body) => {
    const res = await PATCH(json(body));
    expect(res.status).toBe(400);
    expect(h.update).not.toHaveBeenCalled();
  });

  it('a refused form goes back to the dashboard with its notice', async () => {
    const res = await POST(form('_method=PATCH&theme=sepia'));
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('/dashboard?notice=invalid');
    expect(h.update).not.toHaveBeenCalled();
  });

  it('a POST that does not name PATCH is refused', async () => {
    const res = await POST(json({ theme: 'dark' }, 'POST'));
    expect(res.status).toBe(405);
    expect(h.update).not.toHaveBeenCalled();
  });
});

describe('PATCH /api/me, round 1', () => {
  const SITE = '6f1c2a8e-0000-4000-8000-000000000000';

  it('404 no_seat for a caller with no active seat, and nothing saved', async () => {
    h.state.seats = [];
    const res = await PATCH(json({ theme: 'dark' }));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ code: 'no_seat' });
    expect(h.update).not.toHaveBeenCalled();
  });

  it('a form goes back to the site page it came from', async () => {
    const res = await POST(
      form('_method=PATCH&theme=dark', `https://crawlmouse.com/sites/${SITE}?notice=capped`),
    );
    expect([res.status, res.headers.get('location')]).toEqual([303, `/sites/${SITE}`]);
  });

  it('a refused form goes back there too', async () => {
    const res = await POST(
      form('_method=PATCH&theme=sepia', `https://crawlmouse.com/sites/${SITE}`),
    );
    expect(res.headers.get('location')).toBe(`/sites/${SITE}?notice=invalid`);
  });

  it.each([
    ['another origin', 'https://evil.example/sites/6f1c2a8e-0000-4000-8000-000000000000'],
    ['a page that is not one of the two', 'https://crawlmouse.com/settings'],
    ['no referer', undefined],
    ['nonsense', 'not a url'],
  ])('%s: back to the dashboard', async (_name, referer) => {
    const res = await POST(form('_method=PATCH&theme=dark', referer));
    expect(res.headers.get('location')).toBe('/dashboard');
  });
});
