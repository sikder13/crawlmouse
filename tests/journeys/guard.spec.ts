import { expect, test } from './pw';
import {
  createTestUser,
  isTestAddress,
  signIn,
  signInRefusal,
  stagingAdmin,
  stagingAdminRefusal,
  testAddress,
} from './lib/accounts';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { bypassCookies, originHeaders, protectionRefusal } from './lib/protection';
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
