/**
 * F-292, review #3: the theme read is cosmetic and never throws. `seatThemeFor` answers null on a
 * query error and on a throw; `sessionTheme` answers null when anything before it throws (the
 * session, the cookie store).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
const env = vi.hoisted(() => ({ cookiesThrow: false, getUserThrows: false }));
vi.mock('next/headers', () => ({
  cookies: async () => {
    if (env.cookiesThrow) throw new Error('cookies() outside a request');
    return { get: () => undefined };
  },
}));
vi.mock('../../supabase/server', () => ({
  supabaseServer: async () => ({
    auth: {
      getUser: async () => {
        if (env.getUserThrows) throw new Error('auth down');
        return { data: { user: { id: 'u1' } } };
      },
    },
    from: () => seats([{ account_id: 'a1', theme: 'dark' }]),
  }),
}));

const { seatThemeFor, sessionTheme } = await import('./session-theme');

function seats(data: unknown, error: unknown = null) {
  const result = { data, error };
  const chain = {
    select: () => chain,
    eq: () => chain,
    then: (f: (r: unknown) => unknown) => Promise.resolve(result).then(f),
  };
  return chain;
}
const client = (from: () => unknown) => ({ from }) as never;

afterEach(() => {
  env.cookiesThrow = false;
  env.getUserThrows = false;
});

describe('seatThemeFor', () => {
  it('gives the chosen account’s seat theme', async () => {
    const rows = [
      { account_id: 'a1', theme: 'dark' },
      { account_id: 'a2', theme: 'light' },
    ];
    expect(
      await seatThemeFor(
        client(() => seats(rows)),
        'u1',
        'a2',
      ),
    ).toBe('light');
  });

  it('answers null on a query error', async () => {
    expect(
      await seatThemeFor(
        client(() => seats(null, { code: '08006' })),
        'u1',
        null,
      ),
    ).toBeNull();
  });

  it('answers null when the query throws', async () => {
    const throws = () => {
      throw new Error('network down');
    };
    expect(await seatThemeFor(client(throws), 'u1', null)).toBeNull();
  });

  it('answers null on rows that do not parse', async () => {
    expect(
      await seatThemeFor(
        client(() => seats([{ account_id: 'a1', theme: 'sepia' }])),
        'u1',
        null,
      ),
    ).toBeNull();
  });
});

describe('sessionTheme', () => {
  it('reads the dark seat', async () => {
    expect(await sessionTheme()).not.toBeNull();
  });

  it.each([
    ['the cookie store throws', () => (env.cookiesThrow = true)],
    ['the session read throws', () => (env.getUserThrows = true)],
  ])('answers null when %s', async (_, arrange) => {
    arrange();
    expect(await sessionTheme()).toBeNull();
  });

  it('with the user a page already has, reads no session', async () => {
    const from = vi.fn(() => seats([{ account_id: 'a1', theme: 'light' }]));
    env.getUserThrows = true;
    expect(await sessionTheme({ session: client(from), user: { id: 'u1' } })).not.toBeNull();
    expect(from).toHaveBeenCalledTimes(1);
  });
});
