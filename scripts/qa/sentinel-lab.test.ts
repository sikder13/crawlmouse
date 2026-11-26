import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error a plain .mjs served by Vercel as it is, with no declaration file
import * as lab from '../../fixtures/qa-lab/api/sentinel.mjs';

const { answer, fileFor, gptbotBlockedAt, gptbotBlockedOnDayAt, hostOf, robotsAt, HOSTS } = lab;
const handler = lab.default;

const SITES = join(__dirname, '..', '..', 'fixtures', 'qa-lab', 'sites');
const SITE = join(SITES, 'sentinel');
const SITE_B = join(SITES, 'sentinel-b');
const walk = (root: string, dir = root): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(root, join(dir, e.name)) : [relative(root, join(dir, e.name))],
  );
const files = walk(SITE);
const read = (f: string) => readFileSync(join(SITE, f), 'utf8');
const filesB = walk(SITE_B);
const readB = (f: string) => readFileSync(join(SITE_B, f), 'utf8');
const at = (iso: string) => Date.parse(iso);

describe('the sentinel lab site', () => {
  it('disallows GPTBot during each odd UTC hour, and during no even one', () => {
    for (let h = 0; h < 24; h++) {
      const ms = Date.UTC(2026, 10, 24, h, 30);
      expect([h, gptbotBlockedAt(ms)]).toEqual([h, h % 2 === 1]);
      const robots = robotsAt(ms);
      expect([h, robots.includes('User-agent: GPTBot\nDisallow: /')]).toEqual([h, h % 2 === 1]);
      expect(robots.startsWith('User-agent: *\nAllow: /\n')).toBe(true);
    }
  });

  it('turns at the hour, to the millisecond', () => {
    expect(gptbotBlockedAt(at('2026-11-24T06:59:59.999Z'))).toBe(false);
    expect(gptbotBlockedAt(at('2026-11-24T07:00:00.000Z'))).toBe(true);
    expect(gptbotBlockedAt(at('2026-11-24T07:59:59.999Z'))).toBe(true);
    expect(gptbotBlockedAt(at('2026-11-24T08:00:00.000Z'))).toBe(false);
  });

  it('answers robots.txt from the clock and every other file as it is', () => {
    const odd = at('2026-11-24T07:10:00Z');
    expect(answer('/robots.txt', { files, read, now: odd })).toEqual({
      status: 200,
      type: 'text/plain; charset=utf-8',
      body: robotsAt(odd),
    });
    const pages = files.filter((f) => f.endsWith('index.html'));
    expect(pages.length).toBeGreaterThan(8);
    for (const f of pages) {
      const path = `/${f.slice(0, -'index.html'.length)}`;
      const out = answer(path, { files, read, now: odd });
      expect([path, out.status, out.body === read(f)]).toEqual([path, 200, true]);
    }
  });

  it('serves only the files in its own folder', () => {
    const now = at('2026-11-24T06:00:00Z');
    for (const path of ['/../slow/index.html', '/api/sentinel.mjs', 'robots.txt', null, '/nope/']) {
      expect(answer(path, { files, read, now }).status).toBe(404);
    }
    expect(fileFor('/', files)).toBe('index.html');
  });

  it('serves through the handler, and lets no cache keep robots.txt across an hour', () => {
    const served = (path: string) => {
      const headers: Record<string, string> = {};
      const res = {
        statusCode: 0,
        body: '',
        setHeader: (k: string, v: string) => void (headers[k.toLowerCase()] = v),
        end(b: string) {
          this.body = b;
        },
      };
      handler(
        {
          url: `/api/sentinel?path=${encodeURIComponent(path)}`,
          headers: { host: 'sentinel.lab.crawlmouse.com' },
        },
        res,
      );
      return { status: res.statusCode, headers, body: res.body };
    };
    const robots = served('/robots.txt');
    expect(robots.status).toBe(200);
    expect(robots.headers['cache-control']).toBe('no-store');
    expect(robots.body).toMatch(/^User-agent: \*\nAllow: \/\n/);
    const home = served('/');
    expect([home.status, home.headers['cache-control']]).toEqual([200, undefined]);
    expect(home.body).toBe(read('index.html'));
    expect(served('/nope/').status).toBe(404);
  });
});

// Inbox c/025: a site's daily look falls in the same hour every day, so on the hourly host a site
// whose look is in an even hour never meets a block. The daily host blocks on even UTC days instead.
describe('the daily sentinel lab site (sentinel-b)', () => {
  const B = 'sentinel-b.lab.crawlmouse.com';
  const blockedLine = 'User-agent: GPTBot\nDisallow: /';

  it('names its two hosts', () => {
    expect(HOSTS).toEqual({ hourly: 'sentinel.lab.crawlmouse.com', daily: B });
  });

  it('disallows GPTBot on an even UTC day and on no odd one, whatever the hour', () => {
    // Day numbers computed apart from the code: 1970-01-01 is day 0; 2026-11-25 is day 20782.
    for (const [iso, blocked] of [
      ['1970-01-01T00:00:00Z', true],
      ['1970-01-02T12:00:00Z', false],
      ['2026-11-25T00:00:00Z', true],
      ['2026-11-25T14:29:00Z', true],
      ['2026-11-25T23:59:59.999Z', true],
      ['2026-11-26T00:00:00Z', false],
      ['2026-11-26T15:00:00Z', false],
      ['2026-11-27T06:00:00Z', true],
    ] as const) {
      expect([iso, gptbotBlockedOnDayAt(at(iso))]).toEqual([iso, blocked]);
      expect([iso, robotsAt(at(iso), B).includes(blockedLine)]).toEqual([iso, blocked]);
    }
  });

  it('holds one answer through all 24 hours of a day, so the hour a look falls in does not matter', () => {
    for (let h = 0; h < 24; h++) {
      expect([h, robotsAt(Date.UTC(2026, 10, 25, h, 30), B).includes(blockedLine)]).toEqual([
        h,
        true,
      ]);
      expect([h, robotsAt(Date.UTC(2026, 10, 26, h, 30), B).includes(blockedLine)]).toEqual([
        h,
        false,
      ]);
    }
  });

  it('writes its own host in robots.txt, and the hourly host keeps its rule', () => {
    const evenHourOddDay = at('2026-11-26T14:29:00Z');
    expect(robotsAt(evenHourOddDay, B)).toBe(
      `User-agent: *\nAllow: /\n\nSitemap: https://${B}/sitemap.xml\n`,
    );
    expect(robotsAt(evenHourOddDay)).toBe(robotsAt(evenHourOddDay, HOSTS.hourly));
    expect(robotsAt(evenHourOddDay).includes(blockedLine)).toBe(false);
    expect(robotsAt(at('2026-11-26T15:29:00Z')).includes(blockedLine)).toBe(true);
  });

  it('serves its own folder, a different site from the hourly host', () => {
    const now = at('2026-11-26T10:00:00Z');
    const home = answer('/', { files: filesB, read: readB, now, host: B });
    expect([home.status, home.body]).toEqual([200, readB('index.html')]);
    expect(home.body).not.toBe(read('index.html'));
    expect(readB('index.html')).toContain(`<link rel="canonical" href="https://${B}/" />`);
    expect(readB('sitemap.xml')).not.toContain('https://sentinel.lab.crawlmouse.com/');
  });

  it('reads the host from Host, then X-Forwarded-Host, and refuses any other', () => {
    expect(hostOf({ host: 'Sentinel-B.lab.crawlmouse.com:443' })).toBe(B);
    expect(hostOf({ host: 'x.vercel.app', 'x-forwarded-host': B })).toBe(B);
    expect(hostOf({ host: 'sentinel.lab.crawlmouse.com' })).toBe('sentinel.lab.crawlmouse.com');
    expect(hostOf({ host: 'slow.lab.crawlmouse.com' })).toBeNull();
    expect(hostOf({})).toBeNull();
  });

  // QA's gate on #211, M6: a forwarded host the function does not serve is refused, so the handler
  // answers 404 rather than reaching for a folder it has not got.
  it('refuses a forged X-Forwarded-Host, and the handler answers 404, not an error', () => {
    expect(hostOf({ host: 'x.vercel.app', 'x-forwarded-host': 'evil.test' })).toBeNull();
    expect(hostOf({ host: B, 'x-forwarded-host': 'evil.test' })).toBe(B);
    const res = {
      statusCode: 0,
      body: '',
      setHeader: () => {},
      end(b: string) {
        this.body = b;
      },
    };
    handler(
      {
        url: '/api/sentinel?path=%2F',
        headers: { host: 'x.vercel.app', 'x-forwarded-host': 'evil.test' },
      },
      res,
    );
    expect(res.statusCode).toBe(404);
  });

  it('serves through the handler by host, and answers 404 to a host it does not serve', () => {
    const served = (host: string, path: string) => {
      const res = {
        statusCode: 0,
        body: '',
        setHeader: () => {},
        end(b: string) {
          this.body = b;
        },
      };
      handler({ url: `/api/sentinel?path=${encodeURIComponent(path)}`, headers: { host } }, res);
      return { status: res.statusCode, body: res.body };
    };
    expect(served(B, '/')).toEqual({ status: 200, body: readB('index.html') });
    expect(served(B, '/robots.txt').body).toContain(`Sitemap: https://${B}/sitemap.xml`);
    expect(served('sentinel.lab.crawlmouse.com', '/')).toEqual({
      status: 200,
      body: read('index.html'),
    });
    expect(served('other.lab.crawlmouse.com', '/').status).toBe(404);
  });
});
