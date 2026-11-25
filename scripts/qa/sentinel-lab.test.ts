import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error a plain .mjs served by Vercel as it is, with no declaration file
import * as lab from '../../fixtures/qa-lab/api/sentinel.mjs';

const { answer, fileFor, gptbotBlockedAt, robotsAt } = lab;
const handler = lab.default;

const SITE = join(__dirname, '..', '..', 'fixtures', 'qa-lab', 'sites', 'sentinel');
const walk = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name)) : [relative(SITE, join(dir, e.name))],
  );
const files = walk(SITE);
const read = (f: string) => readFileSync(join(SITE, f), 'utf8');
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
      handler({ url: `/api/sentinel?path=${encodeURIComponent(path)}` }, res);
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
