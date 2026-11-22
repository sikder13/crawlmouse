import { expect, test } from './pw';
import { originHeaders, protectionRefusal } from './lib/protection';
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
    ]) {
      expect(on(url), url).toMatch(/is a Vercel deployment/);
    }
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
    for (const url of ['https://staging.crawlmouse.com', 'https://STAGING.crawlmouse.com.']) {
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
  });
  test('sends the bypass only when a secret is set', () => {
    expect(originHeaders({})).toEqual({});
    expect(originHeaders({ VERCEL_AUTOMATION_BYPASS_SECRET: '  ' })).toEqual({});
    expect(originHeaders({ VERCEL_AUTOMATION_BYPASS_SECRET: 's3' })).toEqual({
      'x-vercel-protection-bypass': 's3',
    });
  });
});
