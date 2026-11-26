/**
 * The QA hosts and the lab that serves them (CC-QA). `QA_HOSTS` names the sites the QA accounts
 * audit; every `*.lab.crawlmouse.com` one is a static site under `fixtures/qa-lab/sites/<label>/`,
 * routed by host in `fixtures/qa-lab/vercel.json`. These tests hold the list, the folders and the
 * routes to one another. The routes are read through a model of Vercel's legacy `routes` matching
 * (`walk`), which accepts only the keys it models and fails on any other. Whether the deployed
 * project behaves as the model says is not checked here: `fixtures/qa-lab/README.md` lists the live
 * `curl` checks, which cover a sample of these cases, not all of them.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CRAWLER_REGISTRY_V2, isAllowedByRobots, parseRobotsTxt } from '@crawlmouse/engine/worker';
import {
  CANARY,
  CONTROL,
  CRAWL,
  CRAWLERS,
  OUR_ROBOTS_TOKENS,
} from '../../packages/worker/src/identities';
import { QA_ACCOUNTS, QA_HOSTS } from './accounts';
import {
  createLab,
  HOSTS as LARGE,
  paths as largePaths,
  // @ts-expect-error a plain .mjs served by Vercel as it is, with no declaration file
} from '../../fixtures/qa-lab/api/large.mjs';
import {
  answer as denseAnswer,
  HOSTS as DENSE,
  paths as densePaths,
  // @ts-expect-error a plain .mjs served by Vercel as it is, with no declaration file
} from '../../fixtures/qa-lab/api/dense.mjs';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const LAB = join(REPO, 'fixtures', 'qa-lab');
const SITES = join(LAB, 'sites');
const LAB_ZONE = '.lab.crawlmouse.com';

interface Condition {
  type: string;
  key?: string;
  value?: string;
}
interface Route {
  src: string;
  dest?: string;
  status?: number;
  has?: Condition[];
  missing?: Condition[];
  headers?: Record<string, string>;
  continue?: boolean;
}

/** Written into the lab folder by `vercel link`; gitignored, never uploaded. */
const LOCAL_ONLY = ['.vercel', '.env.local'];

const ROUTE_KEYS = ['src', 'dest', 'status', 'has', 'missing', 'headers', 'continue'];

const routes = (): Route[] =>
  (JSON.parse(readFileSync(join(LAB, 'vercel.json'), 'utf8')) as { routes: Route[] }).routes;

const allHosts = (): string[] => Object.values(QA_HOSTS).flat();
const labHosts = (): string[] => allHosts().filter((h) => h.endsWith(LAB_ZONE));
const label = (host: string): string => host.slice(0, -LAB_ZONE.length);

/** The large lab's four hosts: one function renders their pages (api/large.mjs), so they have no folder. */
const largeHosts = (): string[] => Object.values(LARGE as Record<string, string>);
/** The dense lab's host: its function renders its pages (api/dense.mjs), so it has no folder either. */
const denseHosts = (): string[] => Object.values(DENSE as Record<string, string>);
/** The hosts a function renders, with no folder of their own. */
const renderedHosts = (): string[] => [...largeHosts(), ...denseHosts()];
const staticHosts = (): string[] => labHosts().filter((h) => !renderedHosts().includes(h));
/** A rendered host's pages, as its function lists them. */
const renderedPaths = (host: string): string[] =>
  denseHosts().includes(host) ? (densePaths() as string[]) : (largePaths() as string[]);
/** A large host's robots.txt, as its function answers it. */
const largeRobots = async (host: string): Promise<string> =>
  (
    (await (
      createLab({ log: () => {} }) as {
        answer: (r: object) => Promise<{ body: string }>;
      }
    ).answer({ host, path: '/robots.txt', client: 'test' })) as { body: string }
  ).body;

/**
 * `src` and a `has` value as regular expressions anchored at both ends, ignoring case. The case part
 * is measured live (`/SITES/…` and a `CRAWLMOUSE` user agent match their lower-case forms); the
 * anchoring follows Vercel's documented route matching and is not measured. Not modelled: query
 * strings, and Vercel's own 308s for http and `//`, which run before any route.
 */
const whole = (pattern: string, text: string): RegExpExecArray | null =>
  new RegExp(`^(?:${pattern})$`, 'i').exec(text);

/** `userAgent` undefined is a request that sends no User-Agent header. */
function holds(c: Condition, host: string, userAgent: string | undefined): boolean {
  if (c.type === 'host' && c.key === undefined && c.value !== undefined)
    return whole(c.value, host) !== null;
  if (c.type === 'header' && c.key === 'user-agent' && c.value !== undefined)
    return userAgent !== undefined && whole(c.value, userAgent) !== null;
  throw new Error(`routeFor does not model the condition ${JSON.stringify(c)}`);
}

interface Outcome {
  /** The route that ended the walk; undefined when none did. */
  final?: { status?: number; dest?: string };
  /** Headers set by every route the request matched on the way, `continue` routes included. */
  headers: Record<string, string>;
}

/**
 * Vercel's walk: each route whose `src` matches the path, whose `has` conditions all hold and none of
 * whose `missing` conditions hold, adds its headers; a `continue` route walks on, any other ends the
 * walk with its status and its `dest` (`$1` filled from the match).
 */
function walk(host: string, path: string, userAgent: string | undefined): Outcome {
  const headers: Record<string, string> = {};
  for (const r of routes()) {
    const unmodelled = Object.keys(r).filter((k) => !ROUTE_KEYS.includes(k));
    if (unmodelled.length) throw new Error(`routeFor does not model ${unmodelled.join(', ')}`);
    const m = whole(r.src, path);
    if (!m) continue;
    if (!(r.has ?? []).every((c) => holds(c, host, userAgent))) continue;
    if ((r.missing ?? []).some((c) => holds(c, host, userAgent))) continue;
    Object.assign(headers, r.headers ?? {});
    if (r.continue) continue;
    return {
      final: {
        status: r.status,
        dest: r.dest?.replace(/\$(\d)/g, (_, i: string) => m[Number(i)] ?? ''),
      },
      headers,
    };
  }
  return { headers };
}

/** Where a request goes: the route that ends the walk. Undefined when no route takes it. */
const routeFor = (
  host: string,
  path: string,
  userAgent: string | undefined,
): { status?: number; dest?: string } | undefined => walk(host, path, userAgent).final;

const PATHS = ['/', '/some/deep/page/', '/robots.txt'];

/** The engine's own user agents, read from its source: they are module-private constants. */
const engineUserAgents = (): string[] => {
  const crawler = readFileSync(join(REPO, 'packages/engine/src/crawler.ts'), 'utf8');
  const safeFetch = readFileSync(join(REPO, 'packages/engine/src/safe-fetch.ts'), 'utf8');
  const uas = [
    /const DEFAULT_UA = '([^']+)'/.exec(crawler)?.[1],
    /'user-agent': userAgent \?\? '([^']+)'/.exec(safeFetch)?.[1],
  ];
  expect(uas.every(Boolean), 'the engine user agents moved; update this reader').toBe(true);
  return uas as string[];
};

/**
 * The user agents that disclose Crawlmouse, read from the engine's source and the worker's identities
 * (apps/web sends copies of these; the engine's render client sends an untagged browser agent).
 */
const taggedUserAgents = (): string[] => [
  ...engineUserAgents(),
  ...[CRAWL, CANARY, ...CRAWLERS].map((i) => i.userAgent),
];

describe('QA_HOSTS', () => {
  it('names the twenty-one lab sites under lab.crawlmouse.com, and the owner’s two domains', () => {
    expect(allHosts()).toEqual([
      'nahltech.com',
      'crawlmouse.com',
      'healthy.lab.crawlmouse.com',
      'app-shell.lab.crawlmouse.com',
      'cf-blocked.lab.crawlmouse.com',
      'client-1.lab.crawlmouse.com',
      'client-2.lab.crawlmouse.com',
      'client-3.lab.crawlmouse.com',
      'client-4.lab.crawlmouse.com',
      'client-5.lab.crawlmouse.com',
      'client-6.lab.crawlmouse.com',
      'trial-client-1.lab.crawlmouse.com',
      'demo-1.lab.crawlmouse.com',
      'demo-2.lab.crawlmouse.com',
      'demo-3.lab.crawlmouse.com',
      'slow.lab.crawlmouse.com',
      'sentinel.lab.crawlmouse.com',
      'sentinel-b.lab.crawlmouse.com',
      'large.lab.crawlmouse.com',
      'large-slow.lab.crawlmouse.com',
      'large-throttle.lab.crawlmouse.com',
      'large-throttle-bare.lab.crawlmouse.com',
      'dense.lab.crawlmouse.com',
    ]);
  });

  it('names no host under the old, unbuilt lab.nahltech.com zone, in the hosts or any account’s sites', () => {
    const named = [...allHosts(), ...QA_ACCOUNTS.flatMap((a) => a.sites)];
    expect(named.filter((h) => h.includes('lab.nahltech'))).toEqual([]);
  });
});

describe('the lab serves every lab host', () => {
  it('has a site folder with an index page for each lab host but the five a function renders, and no folder no host names', () => {
    expect(largeHosts().sort()).toEqual(
      [
        QA_HOSTS.large,
        QA_HOSTS.largeSlow,
        QA_HOSTS.largeThrottle,
        QA_HOSTS.largeThrottleBare,
      ].sort(),
    );
    expect(denseHosts()).toEqual([QA_HOSTS.dense]);
    const folders = readdirSync(SITES).filter((f) => statSync(join(SITES, f)).isDirectory());
    expect(folders.sort()).toEqual(staticHosts().map(label).sort());
    for (const host of staticHosts()) {
      expect(existsSync(join(SITES, label(host), 'index.html')), host).toBe(true);
    }
  });

  it('routes each lab host, from a browser, into its own folder, at a root, a deep and a file path', () => {
    for (const host of labHosts()) {
      for (const path of PATHS) {
        expect(routeFor(host, path, CONTROL.userAgent), `${host}${path}`).toEqual({
          status: undefined,
          // The slow and sentinel sites are served by their functions, which read the same folders
          // (api/slow.mjs; api/sentinel.mjs for both sentinel hosts); the large four by one function
          // that renders them (api/large.mjs); dense by its own (api/dense.mjs).
          dest:
            host === QA_HOSTS.slow
              ? `/api/slow?path=${path}`
              : host === QA_HOSTS.sentinel || host === QA_HOSTS.sentinelDaily
                ? `/api/sentinel?path=${path}`
                : largeHosts().includes(host)
                  ? `/api/large?path=${path}`
                  : denseHosts().includes(host)
                    ? `/api/dense?path=${path}`
                    : `/sites/${label(host)}${path}`,
        });
      }
    }
  });

  // Inbox c/025: "Links and pages" needs redirects to show. Each chain below is written out by hand,
  // not read from the generator, and followed through the route model to where it ends.
  it('answers client-3’s three moved addresses with 301 chains: one hop to a page, two to a page, two to a 404', () => {
    const host = QA_HOSTS.clients[2]!;
    const page = (path: string) => existsSync(join(SITES, 'client-3', path.slice(1), 'index.html'));
    const follow = (start: string): { hops: string[]; end: string } => {
      const hops: string[] = [];
      let path = start;
      for (let i = 0; i < 5; i++) {
        const out = walk(host, path, CRAWL.userAgent);
        if (out.final?.status !== 301) break;
        const to = out.headers.Location!;
        expect(to.startsWith(`https://${host}/`), to).toBe(true);
        expect(out.final.dest, path).toBeUndefined();
        path = to.slice(`https://${host}`.length);
        hops.push(path);
      }
      return { hops, end: path };
    };
    expect(follow('/check-ups/')).toEqual({
      hops: ['/treatments/check-ups/'],
      end: '/treatments/check-ups/',
    });
    expect(follow('/hygiene/')).toEqual({
      hops: ['/hygienist/', '/treatments/hygienist-visits/'],
      end: '/treatments/hygienist-visits/',
    });
    expect(follow('/offers/')).toEqual({
      hops: ['/offers/winter/', '/offers/winter-2025/'],
      end: '/offers/winter-2025/',
    });
    expect(page('/treatments/check-ups/')).toBe(true);
    expect(page('/treatments/hygienist-visits/')).toBe(true);
    expect(page('/offers/winter-2025/')).toBe(false);
    expect(routeFor(host, '/offers/winter-2025/', CRAWL.userAgent)).toEqual({
      status: undefined,
      dest: '/sites/client-3/offers/winter-2025/',
    });
    // Each first address is a link on a page the crawler reaches, and no moved address has a page.
    for (const [from, on] of [
      ['/check-ups/', 'patients/index.html'],
      ['/hygiene/', 'cosmetic/index.html'],
      ['/offers/', 'patients/fees/index.html'],
    ] as const) {
      expect(readFileSync(join(SITES, 'client-3', on), 'utf8'), on).toContain(`href="${from}"`);
    }
    for (const moved of [
      '/check-ups/',
      '/hygiene/',
      '/hygienist/',
      '/offers/',
      '/offers/winter/',
    ]) {
      expect(page(moved), moved).toBe(false);
    }
    // No other host redirects these addresses: each goes to its own folder.
    for (const other of labHosts().filter((h) => h !== host && staticHosts().includes(h))) {
      if (
        other === QA_HOSTS.slow ||
        other === QA_HOSTS.sentinel ||
        other === QA_HOSTS.sentinelDaily
      )
        continue;
      expect(routeFor(other, '/check-ups/', CONTROL.userAgent), other).toEqual({
        status: undefined,
        dest: `/sites/${label(other)}/check-ups/`,
      });
    }
  });

  it('answers 403 on cf-blocked to the engine’s and the worker’s Crawlmouse user agents, and on no other host', () => {
    const tagged = taggedUserAgents();
    expect(tagged.length).toBeGreaterThan(3);
    for (const ua of tagged) {
      expect(ua).toMatch(/crawlmouse/i);
      for (const path of PATHS) {
        expect(routeFor(QA_HOSTS.cfBlocked, path, ua), `${path} ${ua}`).toEqual({
          status: 403,
          dest: '/blocked.html',
        });
        for (const host of labHosts().filter((h) => h !== QA_HOSTS.cfBlocked)) {
          expect(routeFor(host, path, ua)?.status, `${host}${path} ${ua}`).toBeUndefined();
        }
      }
    }
  });

  it('serves cf-blocked to the untagged browser control, as a user-agent rule would', () => {
    expect(CONTROL.tagged).toBe(false);
    expect(routeFor(QA_HOSTS.cfBlocked, '/', CONTROL.userAgent)).toEqual({
      status: undefined,
      dest: '/sites/cf-blocked/',
    });
  });

  it('answers 404 to a host it does not name and to the bare deployment URL', () => {
    for (const host of [
      'other.lab.crawlmouse.com',
      'crawlmouse-qa-lab.vercel.app',
      'healthy.lab.crawlmouse.com.evil.test',
    ]) {
      for (const path of ['/', '/sites/healthy/', '/blocked.html']) {
        expect(routeFor(host, path, CONTROL.userAgent), `${host}${path}`).toEqual({
          status: 404,
          dest: '/404.html',
        });
      }
    }
  });

  it('answers 404 on every lab host to the lab’s own paths, which Vercel would otherwise serve as files', () => {
    for (const host of labHosts()) {
      for (const ua of [CONTROL.userAgent, CRAWL.userAgent]) {
        for (const path of [
          '/sites/cf-blocked/',
          '/sites/healthy/index.html',
          // Vercel matches paths ignoring case (measured live).
          '/SITES/healthy/',
          // A trailing slash after a root file, which Vercel served as the file (measured live).
          '/blocked.html/',
          '/404.html/',
          '/sites',
          '/blocked.html',
          '/404.html',
          // Percent-encoded spellings, which Vercel decodes to a file and `src` does not match.
          '/%73ites/cf-blocked/',
          '/sites%2fcf-blocked/',
          '/%62locked.html',
          '/%34%30%34.html',
        ]) {
          expect(routeFor(host, path, ua), `${host}${path} ${ua}`).toEqual({
            status: 404,
            dest: '/404.html',
          });
        }
      }
    }
  });

  // Vercel serves a file at the lab's root ahead of any host rewrite, and the routes refuse only the
  // root files they name. So the root may hold no other served file: a root robots.txt, say, would be
  // served on every host. vercel.json, .vercelignore and the ignored sources are not served (each
  // answers 404 live).
  it('serves at the lab root only the files the first route refuses, and ignores the sources', () => {
    const ignored = readFileSync(join(LAB, '.vercelignore'), 'utf8').split('\n').filter(Boolean);
    expect(ignored).toEqual(['generate.mjs', 'README.md', '.env*']);
    // `vercel link` writes .vercel/ and .env.local; both are gitignored and never uploaded. Any other
    // dotfile, a committed .env.production say, fails here.
    const served = readdirSync(LAB)
      .filter((f) => !['vercel.json', '.vercelignore', 'generate.mjs', 'README.md'].includes(f))
      .filter((f) => !LOCAL_ONLY.includes(f))
      .sort();
    expect(served).toEqual(['404.html', 'api', 'blocked.html', 'sites']);
    for (const host of labHosts()) {
      for (const f of [
        '404.html',
        'blocked.html',
        'sites/healthy/',
        'api/slow',
        'api/slow.mjs',
        'api/large',
        'api/large.mjs',
        'api/dense',
        'api/dense.mjs',
      ]) {
        expect(routeFor(host, `/${f}`, CONTROL.userAgent)?.status, `${host}/${f}`).toBe(404);
      }
    }
  });

  it('tells every request but Crawlmouse’s not to index, so the lab stays out of search', () => {
    const searchEngines = [
      'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
      'Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)',
    ];
    const paths = [...PATHS, '/sites/healthy/', '/no-such-page/'];
    for (const host of [...labHosts(), 'crawlmouse-qa-lab.vercel.app']) {
      for (const path of paths) {
        // 'Crawl mouse' is a near miss: the exception keys on the whole word.
        for (const ua of [CONTROL.userAgent, undefined, 'Crawl mouse/1.0', ...searchEngines]) {
          expect(walk(host, path, ua).headers['X-Robots-Tag'], `${host}${path} ${ua}`).toBe(
            'noindex',
          );
        }
        // Vercel matches header values ignoring case (measured live), so an upper-case tag counts.
        for (const ua of [...taggedUserAgents(), 'SOMEBOT CRAWLMOUSE/9']) {
          expect(walk(host, path, ua).headers, `${host}${path} ${ua}`).toEqual({});
        }
      }
    }
  });

  // robots.txt must not keep search engines out: one disallowed never fetches a page, so never reads
  // the noindex header above, and could list a linked lab URL without it (owner ruling).
  it('disallows nothing in any lab robots.txt but GPTBot on the two clients built to block it', async () => {
    // The two clients built to block GPTBot (README).
    const blocksGptbot = new Set(['client-3', 'client-6']);
    for (const host of labHosts()) {
      const rendered = renderedHosts().includes(host);
      const text = largeHosts().includes(host)
        ? await largeRobots(host)
        : denseHosts().includes(host)
          ? (denseAnswer({ host, path: '/robots.txt' }) as { body: string }).body
          : readFileSync(join(SITES, label(host), 'robots.txt'), 'utf8');
      // Structural: every non-empty Disallow, with the user agents of the group it sits in.
      const disallows: string[] = [];
      let agents: string[] = [];
      let inRules = false;
      for (const raw of text.split('\n')) {
        const line = raw.replace(/#.*/, '').trim();
        const m = /^([a-z-]+)\s*:\s*(.*)$/i.exec(line);
        if (!m) continue;
        const [key, value] = [m[1]!.toLowerCase(), m[2]!.trim()];
        if (key === 'user-agent') {
          if (inRules) agents = [];
          inRules = false;
          agents.push(value);
        } else if (key === 'disallow' || key === 'allow') {
          inRules = true;
          if (key === 'disallow' && value !== '') disallows.push(`${agents.join(',')} ${value}`);
        }
      }
      expect(disallows, host).toEqual(blocksGptbot.has(label(host)) ? ['GPTBot /'] : []);

      // Behavioural, through the engine's parser, over every page the site serves.
      const robots = parseRobotsTxt(text);
      const pages = (dir: string, at: string): string[] =>
        readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
          e.isDirectory()
            ? pages(join(dir, e.name), `${at}${e.name}/`)
            : e.name === 'index.html'
              ? [at]
              : [],
        );
      const paths = rendered ? renderedPaths(host) : pages(join(SITES, label(host)), '/');
      expect(paths).toContain('/');
      const tokens = [
        ...CRAWLER_REGISTRY_V2.map((e) => e.robots_token ?? e.token),
        ...OUR_ROBOTS_TOKENS,
      ];
      expect(tokens).toContain('Googlebot');
      for (const path of paths) {
        for (const t of tokens) {
          const blocked = t === 'GPTBot' && blocksGptbot.has(label(host));
          expect(isAllowedByRobots(robots, t, path), `${host} ${t} ${path}`).toBe(!blocked);
        }
      }
    }
  });

  // The large lab's four hosts and the dense lab exist to be crawled past 500 pages, so they alone are
  // exempt, each held to 2,600 (scripts/qa/large-lab.test.ts holds large's 2,400 floor,
  // scripts/qa/dense-lab.test.ts dense's 2,000). Every other host stays under 500 in all.
  it('holds under 500 pages across every host but the five rendered ones, and each of those to 2,600', () => {
    const pages = (dir: string): number =>
      readdirSync(dir, { withFileTypes: true }).reduce(
        (n, e) =>
          n + (e.isDirectory() ? pages(join(dir, e.name)) : e.name.endsWith('.html') ? 1 : 0),
        0,
      );
    const exempt = new Set(renderedHosts());
    expect([...exempt].sort()).toEqual(
      [
        'dense.lab.crawlmouse.com',
        'large.lab.crawlmouse.com',
        'large-slow.lab.crawlmouse.com',
        'large-throttle.lab.crawlmouse.com',
        'large-throttle-bare.lab.crawlmouse.com',
      ].sort(),
    );
    const served = (host: string): number =>
      exempt.has(host) ? renderedPaths(host).length : pages(join(SITES, label(host)));
    const others = labHosts().filter((h) => !exempt.has(h));
    expect(others.length).toBe(labHosts().length - 5);
    expect(others.reduce((n, h) => n + served(h), 0)).toBeLessThan(500);
    // Nothing else under sites/ escapes the count: the folders are the other hosts' and no more.
    expect(pages(SITES)).toBe(others.reduce((n, h) => n + served(h), 0));
    for (const host of exempt) expect(served(host), host).toBeLessThanOrEqual(2600);
  });

  it('is what the generator writes, so the served sites are the reviewed ones', () => {
    const run = spawnSync(process.execPath, [join(LAB, 'generate.mjs'), '--check'], {
      encoding: 'utf8',
    });
    expect(run.stderr).toBe('');
    expect(run.status).toBe(0);
  });
});
