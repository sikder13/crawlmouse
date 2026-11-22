import { expect, test } from './pw';
import { assertCheckableSite } from './lib/sites';
import { writeRefusal } from './lib/target';

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
