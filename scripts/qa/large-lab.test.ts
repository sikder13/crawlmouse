/**
 * The large lab site (fixtures/qa-lab/api/large.mjs): about 2,500 pages rendered by one function, on four
 * hosts that differ only in how they answer. The walk below reads the HTML the function serves, not its
 * page list, so the page list is checked against what a crawler following links would find.
 */
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import handler, {
  createLab,
  HOSTS,
  paths,
  SLOW_DELAY_MS,
  THROTTLE_LIMIT,
  THROTTLE_WINDOW_MS,
  // @ts-expect-error a plain .mjs served by Vercel as it is, with no declaration file
} from '../../fixtures/qa-lab/api/large.mjs';

interface Answer {
  status: number;
  headers: Record<string, string>;
  body: string;
}
type Lab = { answer: (r: { host: string; path: unknown; client: string }) => Promise<Answer> };

const ALL_HOSTS: string[] = [HOSTS.fast, HOSTS.slow, HOSTS.throttle, HOSTS.throttleBare];
/** A whole window boundary, so offsets below read as "n ms into a window". */
const T0 = 1_700_000_000_000;

/** A lab with no real waiting, a clock the test moves, and its log lines kept. */
function lab(start = T0) {
  let now = start;
  const waits: number[] = [];
  const lines: string[] = [];
  const l = createLab({
    now: () => now,
    wait: async (ms: number) => {
      waits.push(ms);
    },
    log: (line: string) => lines.push(line),
  }) as Lab;
  return {
    ...l,
    waits,
    lines,
    at: (t: number) => {
      now = t;
    },
  };
}

const hrefs = (html: string): string[] =>
  [...html.matchAll(/<a\s[^>]*href="([^"]*)"/g)].map((m) => m[1]!);

/** Breadth-first over the links the served HTML holds, from the home page, on the fast host. */
async function crawl() {
  const l = lab();
  const depth = new Map<string, number>([['/', 0]]);
  const broken: string[] = [];
  const queue = ['/'];
  for (let i = 0; i < queue.length; i++) {
    const path = queue[i]!;
    const out = await l.answer({ host: HOSTS.fast, path, client: 'walker' });
    // A new window per request, so the walk itself is never throttled on any host.
    l.at(T0 + (i + 1) * THROTTLE_WINDOW_MS);
    if (out.status !== 200 || !/text\/html/.test(out.headers['content-type'] ?? '')) {
      broken.push(`${path} ${out.status}`);
      continue;
    }
    for (const href of hrefs(out.body)) {
      if (!href.startsWith('/') || href.startsWith('//')) continue;
      if (!depth.has(href)) {
        depth.set(href, depth.get(path)! + 1);
        queue.push(href);
      }
    }
  }
  return { depth, broken };
}

let walked: Awaited<ReturnType<typeof crawl>> | undefined;
const walk = async () => (walked ??= await crawl());

describe('the large lab site: its pages', () => {
  it('serves 2,400 to 2,600 pages, each reached from the home page by its links, none broken', async () => {
    const { depth, broken } = await walk();
    expect(broken).toEqual([]);
    expect(depth.size).toBeGreaterThanOrEqual(2400);
    expect(depth.size).toBeLessThanOrEqual(2600);
    // The function's own list and the walk agree: no page is served that links cannot reach.
    expect([...depth.keys()].sort()).toEqual([...(paths() as string[])].sort());

    const histogram: Record<number, number> = {};
    for (const d of depth.values()) histogram[d] = (histogram[d] ?? 0) + 1;
    console.log(`large lab: ${depth.size} pages; depth histogram ${JSON.stringify(histogram)}`);
    const within = (n: number) => [...depth.values()].filter((d) => d <= n).length / depth.size;
    // Most pages within four clicks, a tail deeper, nothing absurdly deep.
    expect(within(4)).toBeGreaterThanOrEqual(0.75);
    expect(1 - within(4)).toBeGreaterThanOrEqual(0.05);
    expect(Math.max(...depth.values())).toBeLessThanOrEqual(8);
  });

  it('lists in sitemap.xml exactly the pages the walk reaches, each on the host asked', async () => {
    const { depth } = await walk();
    for (const host of ALL_HOSTS) {
      const out = await lab().answer({ host, path: '/sitemap.xml', client: 'c' });
      expect(out.status).toBe(200);
      expect(out.headers['content-type']).toMatch(/xml/);
      const locs = [...out.body.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]!);
      expect(
        locs.every((u) => u.startsWith(`https://${host}/`)),
        host,
      ).toBe(true);
      const listed = locs.map((u) => u.slice(`https://${host}`.length));
      expect(listed.length, host).toBe(new Set(listed).size);
      expect(listed.sort(), host).toEqual([...depth.keys()].sort());
    }
  });

  it('serves a robots.txt that allows everything and names the host’s own sitemap', async () => {
    for (const host of ALL_HOSTS) {
      const out = await lab().answer({ host, path: '/robots.txt', client: 'c' });
      expect([out.status, out.body]).toEqual([
        200,
        `User-agent: *\nAllow: /\n\nSitemap: https://${host}/sitemap.xml\n`,
      ]);
    }
  });

  it('says on every page that the business is invented', async () => {
    const l = lab();
    for (const path of paths() as string[]) {
      const out = await l.answer({ host: HOSTS.fast, path, client: path });
      expect(out.body, path).toContain('A fictional business: a Crawlmouse QA test site.');
    }
  });

  it('is the same page on each host, but for the host name in its absolute URLs', async () => {
    const all = paths() as string[];
    const sample = [...all.filter((_, i) => i % 25 === 0), '/robots.txt', '/sitemap.xml'];
    for (const path of sample) {
      const bodies = await Promise.all(
        ALL_HOSTS.map(async (host) => {
          const out = await lab().answer({ host, path, client: 'c' });
          expect(out.status, `${host}${path}`).toBe(200);
          return out.body.replaceAll(host, 'HOST');
        }),
      );
      expect(new Set(bodies).size, path).toBe(1);
    }
    expect(sample.length).toBeGreaterThan(90);
  });

  it('answers 404 at once to a path it does not serve, and cannot be steered by an odd one', async () => {
    for (const host of ALL_HOSTS) {
      for (const path of [
        '/no-such-page/',
        '/no-such-page',
        '/index.html',
        '/../vercel.json',
        '/%2e%2e/',
        '//about/',
        'about/',
        '',
        null,
        undefined,
        ['/'],
      ]) {
        const l = lab();
        const out = await l.answer({ host, path, client: 'c' });
        expect([host, String(path), out.status, l.waits]).toEqual([host, String(path), 404, []]);
      }
    }
  });

  it('redirects a page asked for without its trailing slash to it (308), as most servers do', async () => {
    for (const host of ALL_HOSTS) {
      for (const [path, to] of [
        ['/about', '/about/'],
        ['/diary', '/diary/'],
        ['/topics', '/topics/'],
      ]) {
        const out = await lab().answer({ host, path, client: 'c' });
        expect([host, path, out.status, out.headers.location]).toEqual([host, path, 308, to]);
      }
      // The slashed address itself is the page, so the redirect leads somewhere real.
      expect((await lab().answer({ host, path: '/about/', client: 'c' })).status, host).toBe(200);
    }
  });

  it('answers 404 to a host it does not serve', async () => {
    for (const host of ['healthy.lab.crawlmouse.com', 'large.lab.crawlmouse.com.evil.test', '']) {
      expect((await lab().answer({ host, path: '/', client: 'c' })).status, host).toBe(404);
    }
  });
});

describe('the large lab site: how each host answers', () => {
  it('makes the slow host wait SLOW_DELAY_MS before each HTML page, and nothing else wait', async () => {
    expect(SLOW_DELAY_MS).toBe(1000);
    const pages = (paths() as string[]).filter((_, i) => i % 50 === 0);
    for (const host of ALL_HOSTS) {
      for (const path of pages) {
        const l = lab();
        await l.answer({ host, path, client: 'c' });
        expect([host, path, l.waits]).toEqual([
          host,
          path,
          host === HOSTS.slow ? [SLOW_DELAY_MS] : [],
        ]);
      }
      for (const path of ['/robots.txt', '/sitemap.xml', '/style.css', '/no-such-page/']) {
        const l = lab();
        await l.answer({ host, path, client: 'c' });
        expect([host, path, l.waits]).toEqual([host, path, []]);
      }
    }
  });

  it('really takes about a second for a page on the slow host, and not on the fast one', async () => {
    const real = createLab({ log: () => {} }) as Lab;
    const time = async (host: string) => {
      const t = performance.now();
      const out = await real.answer({ host, path: '/about/', client: `timing ${host}` });
      expect(out.status).toBe(200);
      return performance.now() - t;
    };
    const slow = await time(HOSTS.slow);
    expect(slow).toBeGreaterThanOrEqual(950);
    expect(slow).toBeLessThan(1500);
    expect(await time(HOSTS.fast)).toBeLessThan(200);
  });

  it('answers 429 on the throttle hosts above THROTTLE_LIMIT requests a window per client, and 200 at or below it', async () => {
    expect([THROTTLE_LIMIT, THROTTLE_WINDOW_MS]).toEqual([18, 10_000]);
    for (const host of [HOSTS.throttle, HOSTS.throttleBare]) {
      const l = lab();
      const statuses: number[] = [];
      for (let i = 0; i < THROTTLE_LIMIT + 3; i++) {
        l.at(T0 + 4000 + i * 100);
        const out = await l.answer({ host, path: '/', client: '198.51.100.7' });
        statuses.push(out.status);
        if (out.status === 429) {
          // 4,000 ms into the window plus i·100 ms: the rest of the window, rounded up to a second.
          const left = Math.ceil((T0 + THROTTLE_WINDOW_MS - (T0 + 4000 + i * 100)) / 1000);
          expect(out.headers['retry-after'], host).toBe(
            host === HOSTS.throttle ? String(left) : undefined,
          );
          expect('retry-after' in out.headers, host).toBe(host === HOSTS.throttle);
        }
      }
      expect(statuses, host).toEqual([...Array(THROTTLE_LIMIT).fill(200), ...Array(3).fill(429)]);
      // Another client in the same window has its own count.
      expect((await l.answer({ host, path: '/', client: '198.51.100.8' })).status).toBe(200);
      // The next window starts at the next multiple of ten seconds of Unix time, and counts from one.
      l.at(T0 + THROTTLE_WINDOW_MS);
      expect((await l.answer({ host, path: '/', client: '198.51.100.7' })).status).toBe(200);
    }
  });

  it('throttles a crawler at a steady two requests a second on 2 of every 20, and one at 1.8 never', async () => {
    for (const host of [HOSTS.throttle, HOSTS.throttleBare]) {
      const run = async (intervalMs: number, seconds: number) => {
        const l = lab();
        const throttled: number[] = [];
        for (let i = 0; i * intervalMs < seconds * 1000; i++) {
          l.at(T0 + i * intervalMs);
          const out = await l.answer({ host, path: '/', client: 'steady' });
          if (out.status === 429) throttled.push(i);
        }
        return throttled;
      };
      // Requests 0..19 fall in the first window; the 19th and 20th (index 18, 19) are over the limit.
      expect(await run(500, 60), host).toEqual([18, 19, 38, 39, 58, 59, 78, 79, 98, 99, 118, 119]);
      expect(await run(Math.ceil(10_000 / 18), 60), host).toEqual([]);
    }
  });

  it('recovers: after many 429s, a client that waits out the window or slows below the rate gets 200 again', async () => {
    for (const host of [HOSTS.throttle, HOSTS.throttleBare]) {
      // Hammer: 60 requests in the first window, so 42 answers are 429, far past three.
      const l = lab();
      const first: number[] = [];
      for (let i = 0; i < 60; i++) {
        l.at(T0 + i * 100);
        first.push((await l.answer({ host, path: '/', client: 'hammer' })).status);
      }
      expect(
        first.filter((s) => s === 429),
        host,
      ).toHaveLength(60 - THROTTLE_LIMIT);
      expect(first.slice(-1), host).toEqual([429]);

      // (a) Wait out the window: the next one starts from a count of one, so the full limit is 200 again.
      const next: number[] = [];
      for (let i = 0; i < THROTTLE_LIMIT; i++) {
        l.at(T0 + THROTTLE_WINDOW_MS + i * 100);
        next.push((await l.answer({ host, path: '/', client: 'hammer' })).status);
      }
      expect(next, host).toEqual(Array(THROTTLE_LIMIT).fill(200));

      // (b) Slow below the rate: after the same burst, one request a second answers 200 for a minute,
      // from the first request of the next window on. Nothing from the burst survives its window.
      const m = lab();
      for (let i = 0; i < 60; i++) {
        m.at(T0 + i * 100);
        await m.answer({ host, path: '/', client: 'slows' });
      }
      const slowed: number[] = [];
      for (let s = 10; s < 70; s++) {
        m.at(T0 + s * 1000);
        slowed.push((await m.answer({ host, path: '/', client: 'slows' })).status);
      }
      expect(slowed, host).toEqual(Array(60).fill(200));
    }
  });

  it('never throttles the fast or the slow host', async () => {
    for (const host of [HOSTS.fast, HOSTS.slow]) {
      const l = lab();
      for (let i = 0; i < 100; i++) {
        expect((await l.answer({ host, path: '/robots.txt', client: 'burst' })).status).toBe(200);
      }
    }
  });

  it('writes one JSON line per request with the time, path, hashed client, count and answer', async () => {
    const l = lab();
    const sent: Array<[string, string, string, number]> = [];
    for (let i = 0; i < THROTTLE_LIMIT + 2; i++) {
      for (const host of ALL_HOSTS) {
        const path = i % 5 === 4 ? '/no-such-page/' : '/robots.txt';
        l.at(T0 + 1000 + i * 10);
        const out = await l.answer({ host, path, client: '203.0.113.5' });
        sent.push([host, path, new Date(T0 + 1000 + i * 10).toISOString(), out.status]);
      }
    }
    expect(l.lines).toHaveLength(sent.length);
    const hashed = createHash('sha256').update('203.0.113.5').digest('hex').slice(0, 16);
    const counts: Record<string, number> = {};
    l.lines.forEach((line, i) => {
      expect(line).not.toContain('\n');
      expect(line).not.toContain('203.0.113.5');
      const entry = JSON.parse(line) as Record<string, unknown>;
      const [host, path, t, status] = sent[i]!;
      counts[host] = (counts[host] ?? 0) + 1;
      const throttles = host === HOSTS.throttle || host === HOSTS.throttleBare;
      expect(entry).toMatchObject({ lab: 'large', t, host, path, client: hashed, status });
      expect(entry.count).toBe(throttles ? counts[host] : null);
      expect(entry.limit).toBe(throttles ? THROTTLE_LIMIT : null);
      expect(entry.window).toBe(throttles ? new Date(T0).toISOString() : null);
      expect(typeof entry.instance).toBe('string');
    });
    const answered = (host: string) => sent.filter((s) => s[0] === host).map((s) => s[3]);
    expect(answered(HOSTS.throttle).filter((s) => s === 429)).toHaveLength(2);
    expect(answered(HOSTS.fast).filter((s) => s === 429)).toHaveLength(0);
  });
});

describe('the large lab site: the function Vercel calls', () => {
  afterEach(() => vi.restoreAllMocks());

  function call(headers: Record<string, string>, url: string) {
    const res = {
      statusCode: 0,
      headers: {} as Record<string, string>,
      body: '',
      setHeader(k: string, v: string) {
        this.headers[k.toLowerCase()] = v;
      },
      end(b: string) {
        this.body = b;
      },
    };
    return (handler as (req: unknown, r: typeof res) => Promise<void>)(
      { url, headers, socket: { remoteAddress: '10.0.0.9' } },
      res,
    ).then(() => res);
  }

  it('reads the host and the first forwarded address, answers uncached, and logs the line', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const res = await call(
      { host: HOSTS.fast, 'x-forwarded-for': '203.0.113.9, 10.0.0.1' },
      '/api/large?path=/about/',
    );
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body).toContain('<h1>About');
    expect(log).toHaveBeenCalledTimes(1);
    const entry = JSON.parse(String(log.mock.calls[0]![0])) as Record<string, unknown>;
    expect(entry.client).toBe(
      createHash('sha256').update('203.0.113.9').digest('hex').slice(0, 16),
    );
    expect(entry).toMatchObject({ host: HOSTS.fast, path: '/about/', status: 200 });
  });

  it('answers 404 to a host it does not serve, with a line logged', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const res = await call({ host: 'crawlmouse-qa-lab.vercel.app' }, '/api/large?path=/');
    expect(res.statusCode).toBe(404);
    expect(log).toHaveBeenCalledTimes(1);
  });
});
