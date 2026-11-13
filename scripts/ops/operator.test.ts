import { describe, expect, it, vi } from 'vitest';
import { credentials, restClient, type Fetch } from './supabase-rest';
import { runInternal } from './internal';
import { runOperator } from './operator';

const URL_ = 'https://project.supabase.test';
const KEY = ['service', 'role', 'key'].join('-');
const ADDRESS = ['Owner', 'Example.com'].join('@');
const USER = 'b0000000-0000-4000-8000-000000000001';
const ACCOUNT = 'a0000000-0000-4000-8000-000000000001';

/** A fetch stand-in: answers each request from `route`, and records it. */
function fakeFetch(route: (method: string, path: string, body: unknown) => [number, unknown]) {
  const calls: { method: string; path: string; body: unknown; headers: Headers }[] = [];
  const fetch: Fetch = async (input, init) => {
    const u = new URL(String(input));
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({
      method,
      path: `${u.pathname}${u.search}`,
      body,
      headers: new Headers(init?.headers),
    });
    const [status, json] = route(method, `${u.pathname}${u.search}`, body);
    return new Response(json === undefined ? null : JSON.stringify(json), { status });
  };
  return { fetch, calls };
}

const out = () => {
  const lines: string[] = [];
  return { lines, print: (l: string) => void lines.push(l) };
};

describe('credentials', () => {
  it('reads the URL and the service-role key from the environment, then scripts/.env.local', () => {
    expect(credentials({ SUPABASE_URL: URL_, SUPABASE_SERVICE_ROLE_KEY: KEY }, () => '')).toEqual({
      url: URL_,
      key: KEY,
    });
    const file = `# comment\nNEXT_PUBLIC_SUPABASE_URL=${URL_}\nSUPABASE_SERVICE_ROLE_KEY=${KEY}\n`;
    expect(credentials({}, () => file)).toEqual({ url: URL_, key: KEY });
  });

  it('refuses without them, naming the variables and no value', () => {
    expect(() => credentials({}, () => '')).toThrow(/SUPABASE_URL.*SUPABASE_SERVICE_ROLE_KEY/);
  });
});

describe('ops:operator', () => {
  it('add finds the user by the lower-cased address, adds them, and prints the id alone', async () => {
    const f = fakeFetch((method, path) =>
      method === 'GET' && path.startsWith('/rest/v1/users')
        ? [200, [{ id: USER }]]
        : [201, undefined],
    );
    const o = out();
    await runOperator(
      ['add', ADDRESS],
      restClient({ url: URL_, key: KEY, fetch: f.fetch }),
      o.print,
    );
    expect(f.calls.map((c) => [c.method, c.path])).toEqual([
      ['GET', `/rest/v1/users?select=id&email=eq.${encodeURIComponent(ADDRESS.toLowerCase())}`],
      ['POST', '/rest/v1/operators?on_conflict=user_id'],
    ]);
    expect(f.calls[1]!.body).toEqual({ user_id: USER });
    expect(f.calls[0]!.headers.get('apikey')).toBe(KEY);
    expect(f.calls[0]!.headers.get('authorization')).toBe(`Bearer ${KEY}`);
    expect(o.lines).toEqual([`operator added: user ${USER}`]);
    expect(o.lines.join('\n')).not.toContain('@');
  });

  it('add refuses an address with no user, adds nothing, and does not print the address', async () => {
    const f = fakeFetch(() => [200, []]);
    const o = out();
    await expect(
      runOperator(['add', ADDRESS], restClient({ url: URL_, key: KEY, fetch: f.fetch }), o.print),
    ).rejects.toThrow(/no user has that address/);
    expect(f.calls.map((c) => c.method)).toEqual(['GET']);
    expect(o.lines).toEqual([]);
  });

  it('remove deletes the row of the user with that address', async () => {
    const f = fakeFetch((method) =>
      method === 'GET' ? [200, [{ id: USER }]] : [200, [{ user_id: USER }]],
    );
    const o = out();
    await runOperator(
      ['remove', ADDRESS],
      restClient({ url: URL_, key: KEY, fetch: f.fetch }),
      o.print,
    );
    expect(f.calls[1]!.method).toBe('DELETE');
    expect(f.calls[1]!.path).toBe(`/rest/v1/operators?user_id=eq.${USER}`);
    expect(o.lines).toEqual([`operator removed: user ${USER}`]);
  });

  it('remove says so when the user was not an operator', async () => {
    const f = fakeFetch((method) => (method === 'GET' ? [200, [{ id: USER }]] : [200, []]));
    const o = out();
    await runOperator(
      ['remove', ADDRESS],
      restClient({ url: URL_, key: KEY, fetch: f.fetch }),
      o.print,
    );
    expect(o.lines).toEqual([`user ${USER} was not an operator`]);
  });

  it('list prints user ids and when each was added', async () => {
    const f = fakeFetch(() => [200, [{ user_id: USER, added_at: '2026-11-13T12:00:00+00:00' }]]);
    const o = out();
    await runOperator(['list'], restClient({ url: URL_, key: KEY, fetch: f.fetch }), o.print);
    expect(f.calls[0]!.path).toBe('/rest/v1/operators?select=user_id,added_at&order=added_at.asc');
    expect(o.lines).toEqual([`${USER}  added 2026-11-13T12:00:00+00:00`]);
  });

  it('refuses anything else, and a database refusal is an error', async () => {
    const f = fakeFetch(() => [500, { message: 'boom' }]);
    const c = restClient({ url: URL_, key: KEY, fetch: f.fetch });
    await expect(runOperator(['grant', ADDRESS], c, () => undefined)).rejects.toThrow(/usage/);
    await expect(runOperator(['add'], c, () => undefined)).rejects.toThrow(/usage/);
    await expect(runOperator(['list'], c, () => undefined)).rejects.toThrow(/500/);
  });
});

describe('ops:internal', () => {
  it('marks an account internal, and --off unmarks it', async () => {
    const f = fakeFetch(() => [200, [{ id: ACCOUNT }]]);
    const o = out();
    const c = restClient({ url: URL_, key: KEY, fetch: f.fetch });
    await runInternal([ACCOUNT], c, o.print);
    await runInternal([ACCOUNT, '--off'], c, o.print);
    expect(f.calls.map((x) => [x.method, x.path, x.body])).toEqual([
      ['PATCH', `/rest/v1/accounts?id=eq.${ACCOUNT}&select=id`, { internal: true }],
      ['PATCH', `/rest/v1/accounts?id=eq.${ACCOUNT}&select=id`, { internal: false }],
    ]);
    expect(f.calls[0]!.headers.get('prefer')).toBe('return=representation');
    expect(o.lines).toEqual([`account ${ACCOUNT}: internal`, `account ${ACCOUNT}: not internal`]);
  });

  it('refuses an id that is not one, and an account that does not exist', async () => {
    const f = fakeFetch(() => [200, []]);
    const c = restClient({ url: URL_, key: KEY, fetch: f.fetch });
    await expect(runInternal(['nope'], c, () => undefined)).rejects.toThrow(/usage/);
    expect(f.calls).toEqual([]);
    await expect(runInternal([ACCOUNT], c, () => undefined)).rejects.toThrow(/no account/);
    const spy = vi.fn();
    await expect(runInternal([ACCOUNT, '--of'], c, spy)).rejects.toThrow(/usage/);
  });
});
