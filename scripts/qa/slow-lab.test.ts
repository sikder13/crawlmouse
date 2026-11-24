import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error a plain .mjs served by Vercel as it is, with no declaration file
import { answer, DELAY_MS, fileFor } from '../../fixtures/qa-lab/api/slow.mjs';

const SITE = join(__dirname, '..', '..', 'fixtures', 'qa-lab', 'sites', 'slow');
const walk = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name)) : [relative(SITE, join(dir, e.name))],
  );
const files = walk(SITE);
const read = (f: string) => readFileSync(join(SITE, f), 'utf8');

async function timed(path: unknown) {
  const waits: number[] = [];
  const out = await answer(path, {
    files,
    read,
    wait: async (ms: number) => {
      waits.push(ms);
    },
  });
  return { ...out, waits };
}

describe('the slow lab site', () => {
  it('answers every HTML page, and only those, after the fixed delay', async () => {
    expect(DELAY_MS).toBe(3000);
    const pages = files.filter((f) => f.endsWith('index.html'));
    expect(pages.length).toBeGreaterThan(10);
    for (const f of pages) {
      const path = `/${f.slice(0, -'index.html'.length)}`;
      const out = await timed(path);
      expect([path, out.status, out.waits]).toEqual([path, 200, [DELAY_MS]]);
      expect(out.type).toMatch(/text\/html/);
      expect(out.body).toBe(read(f));
    }
    for (const path of ['/robots.txt', '/sitemap.xml', '/style.css']) {
      const out = await timed(path);
      expect([path, out.status, out.waits]).toEqual([path, 200, []]);
    }
  });

  it('answers a real 404 at once for a path the site does not list', async () => {
    for (const path of ['/no-such-page/', '/mugs', '/index.htm']) {
      const out = await timed(path);
      expect([path, out.status, out.waits]).toEqual([path, 404, []]);
    }
  });

  it('cannot be walked out of its folder', () => {
    for (const path of [
      '/../healthy/index.html',
      '/../../vercel.json',
      '/..%2f..%2fvercel.json',
      '//etc/passwd',
      '/api/slow.mjs',
      'robots.txt',
      '',
      null,
      undefined,
      ['/'],
    ]) {
      expect(fileFor(path, files), String(path)).toBeNull();
    }
  });
});
