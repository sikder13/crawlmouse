import { expect, test } from './pw';
import {
  createTestUser,
  isTestAddress,
  signIn,
  sessionToken,
  signInRefusal,
  stagingAdmin,
  stagingAdminRefusal,
  testAddress,
} from './lib/accounts';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  bypassCookies,
  currentTrace,
  noteTrace,
  originHeaders,
  protectionRefusal,
  traceRefusal,
} from './lib/protection';
import { assertCheckableSite } from './lib/sites';
import { databaseRefusal, writeRefusal } from './lib/target';

// The production-write guard (lib/target.ts) and the check-target rule (lib/sites.ts). Pure: no browser,
// no server. The spellings vary what the matcher reads: case, trailing dots, aliases, ports, userinfo.
const on = (url: string, allow = '1') =>
  writeRefusal({ JOURNEY_BASE_URL: url, JOURNEY_ALLOW_WRITES: allow });

test.describe('the production-write guard', () => {
  test('refuses production under every spelling, with writes allowed', () => {
    for (const url of [
      'https://crawlmouse.com',
      'https://www.crawlmouse.com',
      'https://CRAWLMOUSE.COM',
      'https://crawlmouse.com.',
      'https://www.crawlmouse.com..',
      'https://crawlmouse.com:443/path',
      'https://user@crawlmouse.com',
    ]) {
      expect(on(url), url).toMatch(/is production: steps that write never run there/);
    }
  });
  test('refuses every Vercel deployment, the production alias included', () => {
    for (const url of [
      'https://crawlmouse-001.vercel.app',
      'https://crawlmouse-001-git-main-nahl-technologies-projects.vercel.app',
      'https://CRAWLMOUSE-001.VERCEL.APP.',
      // One character or one label away from the staging alias.
      'https://crawlmouse-001-env-staging-nahl-technologies-project.vercel.app',
      'https://crawlmouse-001-env-production-nahl-technologies-projects.vercel.app',
      'https://x.crawlmouse-001-env-staging-nahl-technologies-projects.vercel.app',
    ]) {
      expect(on(url), url).toMatch(/is a Vercel deployment/);
    }
  });
  test('refuses a look-alike of the staging alias on another domain', () => {
    expect(
      on('https://crawlmouse-001-env-staging-nahl-technologies-projects.vercel.app.evil.test'),
    ).toMatch(/is not staging/);
  });
  test('refuses any host that is not staging, localhost included', () => {
    for (const url of [
      'https://staging.example.test',
      'http://localhost:3000',
      'https://staging.crawlmouse.com.evil.test',
    ]) {
      expect(on(url), url).toMatch(/is not staging/);
    }
  });
  test('refuses a writable host on another port or with userinfo', () => {
    for (const url of [
      'https://staging.crawlmouse.com:8443',
      'https://crawlmouse-001-env-staging-nahl-technologies-projects.vercel.app:8443',
      'https://u:p@crawlmouse-001-env-staging-nahl-technologies-projects.vercel.app',
      'https://u@staging.crawlmouse.com',
    ]) {
      expect(on(url), url).toMatch(/port or userinfo/);
    }
    expect(
      on('https://staging.crawlmouse.com:443'),
      'the default port is the same host',
    ).toBeNull();
  });
  test('refuses staging without JOURNEY_ALLOW_WRITES=1', () => {
    for (const v of ['', '0', 'true', 'yes', ' 1']) {
      expect(on('https://staging.crawlmouse.com', v)).toMatch(/ALLOW_WRITES/);
    }
  });
  test('allows staging, under any case or trailing dot, with writes on', () => {
    for (const url of [
      'https://staging.crawlmouse.com',
      'https://STAGING.crawlmouse.com.',
      'https://crawlmouse-001-env-staging-nahl-technologies-projects.vercel.app',
      'https://CRAWLMOUSE-001-env-staging-nahl-technologies-projects.vercel.app.',
    ]) {
      expect(on(url), url).toBeNull();
    }
  });
  test('refuses a base URL that is missing or not https', () => {
    expect(() => writeRefusal({})).toThrow(/required/);
    expect(() => writeRefusal({ JOURNEY_BASE_URL: 'http://staging.crawlmouse.com' })).toThrow(
      /https/,
    );
  });
});

test.describe('the sites a journey may check', () => {
  test('allows the lab hosts and nahltech.com', () => {
    for (const a of [
      'https://healthy.lab.crawlmouse.com',
      'client-1.lab.crawlmouse.com',
      'nahltech.com',
      'https://NAHLTECH.COM.',
    ]) {
      expect(assertCheckableSite(a)).toBe(a);
    }
  });
  test('refuses every other host', () => {
    for (const a of [
      'https://example.com',
      'lab.crawlmouse.com',
      'https://crawlmouse.com',
      'evil.test/x.lab.crawlmouse.com',
      'www.nahltech.com',
    ]) {
      expect(() => assertCheckableSite(a), a).toThrow(/journeys check no other site/);
    }
  });
});

test.describe("the deployment's database, read from its own headers", () => {
  const csp = (v: string) => ({ 'content-security-policy': v });
  test('allows a policy naming staging and not production', () => {
    expect(
      databaseRefusal(csp("connect-src 'self' https://qfgkrnnjuiasahspavbc.supabase.co")),
    ).toBeNull();
    expect(
      databaseRefusal({
        'Content-Security-Policy-Report-Only':
          'connect-src https://qfgkrnnjuiasahspavbc.supabase.co',
      }),
    ).toBeNull();
  });
  test("refuses a policy naming production's project, even beside staging's", () => {
    for (const v of [
      'connect-src https://ezspnfeyzwsisymytssm.supabase.co',
      'connect-src https://qfgkrnnjuiasahspavbc.supabase.co https://ezspnfeyzwsisymytssm.supabase.co',
    ]) {
      expect(databaseRefusal(csp(v)), v).toMatch(/production/);
    }
  });
  test('refuses no policy, or one naming no staging database', () => {
    expect(databaseRefusal({})).toMatch(/no Content-Security-Policy/);
    expect(databaseRefusal(csp("default-src 'self'"))).toMatch(/does not name staging/);
    for (const v of [
      'connect-src https://qfgkrnnjuiasahspavbc.supabase.co.evil.test',
      'connect-src https://xqfgkrnnjuiasahspavbc.supabase.co',
      'connect-src https://qfgkrnnjuiasahspavbc.supabase.com',
    ]) {
      expect(databaseRefusal(csp(v)), v).toMatch(/does not name staging/);
    }
    expect(
      databaseRefusal(
        csp(
          'connect-src https://qfgkrnnjuiasahspavbc.supabase.co wss://qfgkrnnjuiasahspavbc.supabase.co;',
        ),
      ),
    ).toBeNull();
  });
});

test.describe('Vercel Deployment Protection', () => {
  const vercel = { server: 'Vercel' };
  test('stops a run against a protected deployment, saying why', () => {
    expect(protectionRefusal(401, vercel, false)).toMatch(/set VERCEL_AUTOMATION_BYPASS_SECRET/);
    expect(protectionRefusal(403, { 'x-vercel-id': 'iad1::x' }, false)).toMatch(
      /Deployment Protection/,
    );
    expect(protectionRefusal(401, vercel, true)).toMatch(/refused the bypass secret/);
    // As measured on an old preview on 2026-11-22, 15:19 ET.
    const sso = {
      server: 'Vercel',
      location: 'https://vercel.com/sso-api?url=https%3A%2F%2Fx.vercel.app&nonce=1',
    };
    expect(protectionRefusal(302, sso, false)).toMatch(/Deployment Protection \(302\)/);
    expect(protectionRefusal(307, sso, true)).toMatch(/refused the bypass secret/);
  });
  test('lets the app through, and leaves other refusals to the steps', () => {
    expect(protectionRefusal(200, vercel, false)).toBeNull();
    expect(protectionRefusal(429, vercel, false)).toBeNull();
    expect(protectionRefusal(401, { server: 'nginx' }, false)).toBeNull();
    // A redirect elsewhere (a site's own) is not protection.
    expect(
      protectionRefusal(308, { server: 'Vercel', location: 'https://crawlmouse.com/' }, false),
    ).toBeNull();
    expect(
      protectionRefusal(
        302,
        { server: 'Vercel', location: 'https://vercel.com.evil.test/sso' },
        false,
      ),
    ).toBeNull();
    // The app's own redirect to its sign-in, relative or absolute, is not Vercel's.
    expect(protectionRefusal(307, { server: 'Vercel', location: '/login' }, false)).toBeNull();
    expect(
      protectionRefusal(307, { server: 'Vercel', location: 'https://crawlmouse.com/login' }, false),
    ).toBeNull();
  });
  test("reads Vercel's sign-in under any spelling of its host", () => {
    for (const location of [
      'https://VERCEL.com/sso-api?x=1',
      'https://vercel.com:443/sso-api',
      'https://vercel.com./sso-api',
      'https://vercel.com/login?next=x',
    ]) {
      expect(protectionRefusal(302, { server: 'Vercel', location }, false), location).toMatch(
        /Deployment Protection/,
      );
    }
  });
  test('never carries the secret or its cookie to the origin a redirect points at', async ({
    playwright,
  }) => {
    const SECRET = 'sentinel-bypass-secret';
    const second: Array<Record<string, unknown>> = [];
    const other = createServer((req, res) => {
      second.push(req.headers);
      res.end('other');
    });
    await new Promise<void>((r) => other.listen(0, '127.0.0.1', r));
    const otherUrl = `http://127.0.0.1:${(other.address() as AddressInfo).port}/landed`;
    const first = createServer((req, res) => {
      if (req.url === '/api/health') {
        res.setHeader('set-cookie', '_vercel_jwt=cookie-value; Path=/; HttpOnly');
        res.statusCode = 302;
        res.setHeader('location', otherUrl);
        return res.end();
      }
      res.statusCode = 302;
      res.setHeader('location', otherUrl);
      res.end();
    });
    await new Promise<void>((r) => first.listen(0, 'localhost', r));
    const origin = `http://localhost:${(first.address() as AddressInfo).port}`;
    try {
      const cookies = await bypassCookies(origin, { VERCEL_AUTOMATION_BYPASS_SECRET: SECRET });
      expect(cookies.map((c) => [c.name, c.domain])).toEqual([['_vercel_jwt', 'localhost']]);
      expect(second, 'the cookie request does not follow the redirect').toHaveLength(0);
      const request = await playwright.request.newContext({
        baseURL: origin,
        storageState: { cookies, origins: [] },
      });
      expect(await (await request.get('/to-other')).text()).toBe('other');
      await request.dispose();
      expect(second).toHaveLength(1);
      const seen = JSON.stringify(second[0]);
      expect(seen).not.toContain(SECRET);
      expect(seen).not.toContain('cookie-value');
    } finally {
      first.close();
      other.close();
    }
  });
  test('takes only a live bypass cookie', async () => {
    const answer =
      (...cookies: string[]) =>
      async () => {
        const headers = new Headers();
        for (const c of cookies) headers.append('set-cookie', c);
        return new Response('', { status: 200, headers });
      };
    const env = { VERCEL_AUTOMATION_BYPASS_SECRET: 'cookie-rule' };
    for (const [host, line] of [
      ['a', '_vercel_sso_nonce=x; Path=/'],
      ['b', '_vercel_jwt=; Path=/'],
      ['c', '_vercel_jwt=x; Max-Age=0; Path=/'],
      ['e', '_vercel_jwt=x; Max-Age=00; Path=/'],
      ['f', '_vercel_jwt=x; Max-Age=-1; Path=/'],
      ['g', '_vercel_jwt=x; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=/'],
    ] as const) {
      await expect(
        bypassCookies(`https://${host}.example.test`, env, answer(line)),
        line,
      ).rejects.toThrow(/no bypass cookie/);
    }
    const got = await bypassCookies(
      'https://d.example.test',
      env,
      answer('_vercel_sso_nonce=n; Path=/', '_vercel_jwt=good; Path=/; HttpOnly'),
    );
    expect(got.map((c) => [c.name, c.value])).toEqual([['_vercel_jwt', 'good']]);
  });
  test('reads a rotated secret afresh', async () => {
    const origin = 'https://rotated.example.test';
    const answer = (v: string) => async () =>
      new Response('', { headers: { 'set-cookie': `_vercel_jwt=${v}; Path=/` } });
    const first = await bypassCookies(
      origin,
      { VERCEL_AUTOMATION_BYPASS_SECRET: 'one' },
      answer('1'),
    );
    const second = await bypassCookies(
      origin,
      { VERCEL_AUTOMATION_BYPASS_SECRET: 'two' },
      answer('2'),
    );
    expect([first[0]!.value, second[0]!.value]).toEqual(['1', '2']);
  });
  test("prefers the step's resolved trace mode, and forgets it after the step", () => {
    expect(currentTrace('off')).toBe('off');
    noteTrace('on');
    expect(currentTrace('off')).toBe('on');
    noteTrace(undefined);
    expect(currentTrace('off')).toBe('off');
  });
  test('refuses a run that would record a trace', () => {
    for (const m of [undefined, 'off', { mode: 'off' }]) expect(traceRefusal(m)).toBeNull();
    for (const m of ['on', 'retain-on-failure', 'on-first-retry', { mode: 'on' }]) {
      expect(traceRefusal(m), JSON.stringify(m)).toMatch(/keeps no trace/);
    }
  });
  test('stops when a secret is set and the deployment gives no cookie', async () => {
    await expect(
      bypassCookies(
        'https://no-cookie.example.test',
        { VERCEL_AUTOMATION_BYPASS_SECRET: 's' },
        async () => new Response('', { status: 200 }),
      ),
    ).rejects.toThrow(/no bypass cookie/);
  });
  test('sends the bypass only when a secret is set', () => {
    expect(originHeaders({})).toEqual({});
    expect(originHeaders({ VERCEL_AUTOMATION_BYPASS_SECRET: '  ' })).toEqual({});
    expect(originHeaders({ VERCEL_AUTOMATION_BYPASS_SECRET: 's3' })).toEqual({
      'x-vercel-protection-bypass': 's3',
    });
  });
});

test.describe('the staging admin client', () => {
  const ok = {
    SUPABASE_URL: 'https://qfgkrnnjuiasahspavbc.supabase.co',
    STAGING_PROJECT_REF: 'qfgkrnnjuiasahspavbc',
    SUPABASE_SERVICE_ROLE_KEY: 'k',
  };
  test("allows staging's project, with or without a trailing slash", () => {
    expect(stagingAdminRefusal(ok)).toBeNull();
    expect(
      stagingAdminRefusal({ ...ok, SUPABASE_URL: 'https://qfgkrnnjuiasahspavbc.supabase.co/' }),
    ).toBeNull();
  });
  test("refuses production's project and every other project", () => {
    expect(
      stagingAdminRefusal({ ...ok, SUPABASE_URL: 'https://ezspnfeyzwsisymytssm.supabase.co' }),
    ).toMatch(/production/);
    expect(
      stagingAdminRefusal({
        ...ok,
        SUPABASE_URL: 'https://qfgkrnnjuiasahspavbc.supabase.co.evil.test',
      }),
    ).toMatch(/is not/);
    expect(
      stagingAdminRefusal({ ...ok, SUPABASE_URL: 'http://qfgkrnnjuiasahspavbc.supabase.co' }),
    ).toMatch(/is not/);
    expect(stagingAdminRefusal({ ...ok, STAGING_PROJECT_REF: 'ezspnfeyzwsisymytssm' })).toMatch(
      /STAGING_PROJECT_REF/,
    );
    expect(stagingAdminRefusal({ ...ok, SUPABASE_SERVICE_ROLE_KEY: '' })).toMatch(/not set/);
  });
  test('makes only lab-domain test addresses, and accepts no other', () => {
    const a = testAddress('j1', 2, 1_700_000_000_000);
    expect(a).toBe('qa+j1-loyw3v28-2@lab.crawlmouse.com');
    expect(isTestAddress(a)).toBe(true);
    for (const x of [
      'someone@example.test',
      'qa+j1-x-1@lab.crawlmouse.com.evil.test',
      'qa+j9-x-1@lab.crawlmouse.com',
    ]) {
      expect(isTestAddress(x), x).toBe(false);
    }
    expect(() => testAddress('j9')).toThrow(/not a journey/);
  });
  test('builds no admin client from a refused environment', () => {
    expect(() =>
      stagingAdmin({ ...ok, SUPABASE_URL: 'https://ezspnfeyzwsisymytssm.supabase.co' }),
    ).toThrow(/refusing the admin client/);
  });
  test('creates a user only for a test address', async () => {
    const calls: string[] = [];
    const admin = () => ({
      auth: {
        admin: {
          createUser: async (a: { email: string }) => {
            calls.push(a.email);
            return { data: { user: { id: 'u' } }, error: null };
          },
          generateLink: async () => ({ data: { properties: null }, error: null }),
        },
        getUser: async () => ({ data: { user: null }, error: null }),
      },
    });
    await expect(createTestUser('someone@example.test', admin)).rejects.toThrow(/only a journey/);
    expect(calls).toEqual([]);
    const a = testAddress('j1', 1, 1_700_000_000_000);
    expect(await createTestUser(a, admin)).toBe('u');
    expect(calls).toEqual([a]);
  });
  test('asks for no sign-in link for another address or another deployment', async () => {
    let links = 0;
    const admin = () => ({
      auth: {
        admin: {
          createUser: async () => ({ data: { user: null }, error: null }),
          generateLink: async () => {
            links += 1;
            return { data: { properties: { hashed_token: 'h' } }, error: null };
          },
        },
        getUser: async () => ({ data: { user: null }, error: null }),
      },
    });
    const a = testAddress('j1', 1, 1_700_000_000_000);
    const page = (csp: string) =>
      ({
        request: { get: async () => ({ headers: () => ({ 'content-security-policy': csp }) }) },
      }) as never;
    const staging = 'https://qfgkrnnjuiasahspavbc.supabase.co';
    const prod = 'https://ezspnfeyzwsisymytssm.supabase.co';
    const host = 'https://staging.crawlmouse.com';
    const was = process.env.JOURNEY_ALLOW_WRITES;
    process.env.JOURNEY_ALLOW_WRITES = '1';
    try {
      await expect(signIn(page(staging), host, 'someone@example.test', admin)).rejects.toThrow(
        /only a journey/,
      );
      await expect(signIn(page(staging), 'https://crawlmouse.com', a, admin)).rejects.toThrow(
        /is production/,
      );
      await expect(signIn(page(prod), host, a, admin)).rejects.toThrow(/signIn:/);
      expect(links).toBe(0);
    } finally {
      if (was === undefined) delete process.env.JOURNEY_ALLOW_WRITES;
      else process.env.JOURNEY_ALLOW_WRITES = was;
    }
  });
  test.describe('the sign-in flow', () => {
    const address = testAddress('j1', 1, 1_700_000_000_000);
    const TOKEN = 'SENTINEL-TOKEN-HASH';
    const host = 'https://staging.crawlmouse.com';
    const csp = {
      'content-security-policy': 'connect-src https://qfgkrnnjuiasahspavbc.supabase.co',
    };
    const cookie = (email: string) => ({
      name: 'sb-qfgkrnnjuiasahspavbc-auth-token',
      value: `base64-${Buffer.from(JSON.stringify({ access_token: `jwt-${email}` })).toString('base64url')}`,
    });
    const admin = () => ({
      auth: {
        admin: {
          createUser: async () => ({ data: { user: null }, error: null }),
          generateLink: async () => ({
            data: { properties: { hashed_token: TOKEN } },
            error: null,
          }),
        },
        getUser: async (jwt: string) => ({
          data: { user: jwt.startsWith('jwt-') ? { email: jwt.slice(4) } : null },
          error: null,
        }),
      },
    });
    /** A page that follows the product's door, with each stage changeable. */
    const door = (o: {
      name?: string;
      session?: Array<{ name: string; value: string; domain?: string }>;
      gotoThrows?: boolean;
      native?: boolean;
    }) => {
      let at = 'about:blank';
      let clicks = 0;
      const page = {
        request: { get: async () => ({ headers: () => csp }) },
        url: () => at,
        goto: async (url: string) => {
          if (o.gotoThrows) throw new Error(`page.goto: net::ERR at ${url}`);
          at = `${host}/login/verify/continue`;
        },
        getByRole: () => ({
          click: async () => {
            clicks += 1;
            if (clicks === 2 || o.native) at = `${host}/dashboard`;
          },
        }),
        getByText: () => ({
          waitFor: async () => {
            if (o.native) await new Promise(() => {});
          },
          textContent: async () => `Signed in as ${o.name ?? address}.`,
        }),
        waitForURL: async (ok: (u: URL) => boolean) => {
          if (ok(new URL(at))) return;
          await new Promise(() => {});
        },
        context: () => ({
          cookies: async (url?: string) =>
            (o.session ?? [cookie(address)]).filter(
              (c) => !url || !c.domain || c.domain === new URL(url).hostname,
            ),
        }),
      };
      return { page: page as never, clicks: () => clicks };
    };
    const off = () => 'off';
    const withWrites = async (run: () => Promise<void>) => {
      const was = process.env.JOURNEY_ALLOW_WRITES;
      process.env.JOURNEY_ALLOW_WRITES = '1';
      try {
        await run();
      } finally {
        if (was === undefined) delete process.env.JOURNEY_ALLOW_WRITES;
        else process.env.JOURNEY_ALLOW_WRITES = was;
      }
    };

    test('clicks Continue on both screens and returns for the right session', async () => {
      await withWrites(async () => {
        const d = door({});
        await signIn(d.page, host, address, admin, off);
        expect(d.clicks()).toBe(2);
      });
    });
    test('accepts the no-script path, where the post lands past the naming screen', async () => {
      await withWrites(async () => {
        const d = door({ native: true });
        await signIn(d.page, host, address, admin, off);
        expect(d.clicks()).toBe(1);
      });
    });
    test('refuses a screen naming someone else', async () => {
      await withWrites(async () => {
        await expect(
          signIn(door({ name: 'qa+j1-x-2@lab.crawlmouse.com' }).page, host, address, admin, off),
        ).rejects.toThrow(/did not name/);
      });
    });
    test('refuses when the browser holds no session', async () => {
      await withWrites(async () => {
        await expect(signIn(door({ session: [] }).page, host, address, admin, off)).rejects.toThrow(
          /holds no staging session/,
        );
      });
    });
    test("refuses a session that is someone else's", async () => {
      await withWrites(async () => {
        await expect(
          signIn(
            door({ session: [cookie('qa+j1-x-2@lab.crawlmouse.com')] }).page,
            host,
            address,
            admin,
            off,
          ),
        ).rejects.toThrow(/is not/);
      });
    });
    test("does not read a session from another host's cookie", async () => {
      await withWrites(async () => {
        const elsewhere = { ...cookie(address), domain: 'other.example' };
        await expect(
          signIn(door({ session: [elsewhere] }).page, host, address, admin, off),
        ).rejects.toThrow(/holds no staging session/);
        const theirs = {
          ...cookie('qa+j1-x-2@lab.crawlmouse.com'),
          domain: 'staging.crawlmouse.com',
        };
        await expect(
          signIn(door({ session: [elsewhere, theirs] }).page, host, address, admin, off),
        ).rejects.toThrow(/is not/);
      });
    });
    test('keeps the token out of the error when the link fails to open', async () => {
      await withWrites(async () => {
        const e = await signIn(door({ gotoThrows: true }).page, host, address, admin, off).catch(
          (x: Error) => x,
        );
        expect(String(e)).toMatch(/did not open/);
        expect(String(e)).not.toContain(TOKEN);
      });
    });
    test('asks for no link while tracing is on', async () => {
      await withWrites(async () => {
        let links = 0;
        const counting = () => {
          const a = admin();
          return {
            auth: {
              ...a.auth,
              admin: {
                ...a.auth.admin,
                generateLink: async () => {
                  links += 1;
                  return a.auth.admin.generateLink();
                },
              },
            },
          };
        };
        await expect(
          signIn(door({}).page, host, address, counting as never, () => 'on'),
        ).rejects.toThrow(/keeps no trace/);
        expect(links).toBe(0);
      });
    });
    test('reads a session cookie whole or split', () => {
      const whole = cookie('a@b.test');
      expect(sessionToken([whole])).toBe('jwt-a@b.test');
      const cut = 12;
      expect(
        sessionToken([
          { name: `${whole.name}.1`, value: whole.value.slice(cut) },
          { name: `${whole.name}.0`, value: whole.value.slice(0, cut) },
        ]),
      ).toBe('jwt-a@b.test');
      expect(sessionToken([{ name: 'other', value: whole.value }])).toBeNull();
      expect(sessionToken([{ name: whole.name, value: 'not json' }])).toBeNull();
    });
  });
  test('refuses a sign-in token for any deployment that is not staging', () => {
    const csp = {
      'content-security-policy': 'connect-src https://qfgkrnnjuiasahspavbc.supabase.co',
    };
    const env = { JOURNEY_ALLOW_WRITES: '1' };
    expect(signInRefusal('https://staging.crawlmouse.com', csp, env)).toBeNull();
    expect(signInRefusal('https://crawlmouse.com', csp, env)).toMatch(/is production/);
    expect(signInRefusal('https://staging.crawlmouse.com', csp, {})).toMatch(/ALLOW_WRITES/);
    expect(
      signInRefusal(
        'https://staging.crawlmouse.com',
        { 'content-security-policy': 'connect-src https://ezspnfeyzwsisymytssm.supabase.co' },
        env,
      ),
    ).not.toBeNull();
  });
});
