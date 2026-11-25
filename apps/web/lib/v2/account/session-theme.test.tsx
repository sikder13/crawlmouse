/**
 * F-292: the page theme is the theme of the seat the viewer acts in, chosen by the viewer's own rule
 * (`pickSeat`), and the read never throws. `seatThemeFor` answers null on a query error and on a
 * throw; `sessionTheme` answers null when anything before it throws (the session, the cookie store).
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
    from: db({ seats: [seat('a1', 'dark')] }).from,
  }),
}));
vi.mock('../../supabase/admin', () => ({ supabaseAdmin: () => db({ users: null }) }));

const { seatThemeFor, sessionTheme } = await import('./session-theme');

function seat(account_id: string, theme: string, role = 'developer') {
  return { id: `s-${account_id}`, account_id, role, theme };
}

/** A client whose tables answer `rows[table]`; a table set to an Error answers that as its error. */
function db(rows: Record<string, unknown>) {
  return {
    from(table: string) {
      if (!(table in rows)) throw new Error(`unexpected read of ${table}`);
      const data = rows[table];
      const result =
        data instanceof Error ? { data: null, error: { code: '08006' } } : { data, error: null };
      const chain: Record<string, unknown> = {
        then: (f: (r: unknown) => unknown) => Promise.resolve(result).then(f),
        maybeSingle: async () => result,
      };
      for (const m of ['select', 'eq', 'in', 'is', 'limit']) chain[m] = () => chain;
      return chain;
    },
  };
}
const deps = (session: Record<string, unknown>, admin: Record<string, unknown> = {}) =>
  ({ session: db(session), admin: db(admin) }) as never;

afterEach(() => {
  env.cookiesThrow = false;
  env.getUserThrows = false;
});

describe('seatThemeFor', () => {
  it('gives the chosen account’s seat theme', async () => {
    const d = deps({ seats: [seat('a1', 'dark'), seat('a2', 'light')] });
    expect(await seatThemeFor(d, 'u1', 'a2')).toBe('light');
  });

  it('with no account chosen and seats on different themes, gives the landing seat’s, as the dashboard does', async () => {
    // Neither seat owns its account, so the landing seat is the default account's (`landingSeat`).
    const d = deps(
      { seats: [seat('a1', 'dark'), seat('a2', 'light')] },
      { users: { default_account_id: 'a2' } },
    );
    expect(await seatThemeFor(d, 'u1', null)).toBe('light');
  });

  it('lands an owner of a personal account with no site and one agency in the agency, as the dashboard does', async () => {
    const d = deps(
      {
        seats: [seat('p1', 'light', 'owner'), seat('g1', 'dark', 'owner')],
        accounts: [
          { id: 'p1', kind: 'personal' },
          { id: 'g1', kind: 'agency' },
        ],
        sites: [],
      },
      { users: { default_account_id: 'p1' } },
    );
    expect(await seatThemeFor(d, 'u1', null)).toBe('dark');
  });

  it('answers null on a query error', async () => {
    expect(await seatThemeFor(deps({ seats: new Error('down') }), 'u1', null)).toBeNull();
  });

  it('answers null when the query throws', async () => {
    expect(await seatThemeFor(deps({}), 'u1', null)).toBeNull();
  });

  it('answers null when the landing seat’s read fails', async () => {
    const d = deps({ seats: [seat('a1', 'dark'), seat('a2', 'light')] }, { users: new Error('x') });
    expect(await seatThemeFor(d, 'u1', null)).toBeNull();
  });

  it('answers null on rows that do not parse', async () => {
    expect(await seatThemeFor(deps({ seats: [seat('a1', 'sepia')] }), 'u1', null)).toBeNull();
  });
});

describe('sessionTheme', () => {
  it('reads the dark seat', async () => {
    expect(await sessionTheme()).toBe('dark');
  });

  it.each([
    ['the cookie store throws', () => (env.cookiesThrow = true)],
    ['the session read throws', () => (env.getUserThrows = true)],
  ])('answers null when %s', async (_, arrange) => {
    arrange();
    expect(await sessionTheme()).toBeNull();
  });

  it('with the user a page already has, reads no session', async () => {
    const session = db({ seats: [seat('a1', 'light')] });
    const from = vi.spyOn(session, 'from');
    env.getUserThrows = true;
    expect(await sessionTheme({ session: session as never, user: { id: 'u1' } })).toBe('light');
    expect(from).toHaveBeenCalledTimes(1);
  });
});
