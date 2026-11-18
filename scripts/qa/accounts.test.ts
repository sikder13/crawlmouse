/**
 * The QA hosts and the lab that serves them (CC-QA). `QA_HOSTS` names the sites the QA accounts
 * audit; every `*.lab.crawlmouse.com` one is a static site under `fixtures/qa-lab/sites/<label>/`,
 * routed by host in `fixtures/qa-lab/vercel.json`. These tests hold the list, the folders and the
 * routes to one another. The routes are read through a model of Vercel's legacy `routes` matching
 * (`routeFor`), which accepts only the keys it models and fails on any other; that the deployed
 * project behaves as the model says is the live check in `fixtures/qa-lab/README.md`.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CANARY, CONTROL, CRAWL, CRAWLERS } from '../../packages/worker/src/identities';
import { QA_ACCOUNTS, QA_HOSTS } from './accounts';

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
}

const ROUTE_KEYS = ['src', 'dest', 'status', 'has'];

const routes = (): Route[] =>
  (JSON.parse(readFileSync(join(LAB, 'vercel.json'), 'utf8')) as { routes: Route[] }).routes;

const allHosts = (): string[] => Object.values(QA_HOSTS).flat();
const labHosts = (): string[] => allHosts().filter((h) => h.endsWith(LAB_ZONE));
const label = (host: string): string => host.slice(0, -LAB_ZONE.length);

/** Vercel matches `src` and a `has` value as regular expressions anchored at both ends. */
const whole = (pattern: string, text: string): RegExpExecArray | null =>
  new RegExp(`^(?:${pattern})$`).exec(text);

function holds(c: Condition, host: string, userAgent: string): boolean {
  if (c.type === 'host' && c.key === undefined && c.value !== undefined)
    return whole(c.value, host) !== null;
  if (c.type === 'header' && c.key === 'user-agent' && c.value !== undefined)
    return whole(c.value, userAgent) !== null;
  throw new Error(`routeFor does not model the condition ${JSON.stringify(c)}`);
}

/**
 * Where a request goes: the first route whose `src` matches the path and whose `has` conditions all
 * hold, with `$1` filled from the match. Undefined when no route takes it.
 */
function routeFor(
  host: string,
  path: string,
  userAgent: string,
): { status?: number; dest?: string } | undefined {
  for (const r of routes()) {
    const unmodelled = Object.keys(r).filter((k) => !ROUTE_KEYS.includes(k));
    if (unmodelled.length) throw new Error(`routeFor does not model ${unmodelled.join(', ')}`);
    const m = whole(r.src, path);
    if (!m || !(r.has ?? []).every((c) => holds(c, host, userAgent))) continue;
    return {
      status: r.status,
      dest: r.dest?.replace(/\$(\d)/g, (_, i: string) => m[Number(i)] ?? ''),
    };
  }
  return undefined;
}

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

/** Every user agent the product sends that discloses Crawlmouse: the engine's and the worker's. */
const taggedUserAgents = (): string[] => [
  ...engineUserAgents(),
  ...[CRAWL, CANARY, ...CRAWLERS].map((i) => i.userAgent),
];

describe('QA_HOSTS', () => {
  it('names the thirteen lab sites under lab.crawlmouse.com, and the owner’s two domains', () => {
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
    ]);
  });

  it('names no host under the old, unbuilt lab.nahltech.com zone, in the hosts or any account’s sites', () => {
    const named = [...allHosts(), ...QA_ACCOUNTS.flatMap((a) => a.sites)];
    expect(named.filter((h) => h.includes('lab.nahltech'))).toEqual([]);
  });
});

describe('the lab serves every lab host', () => {
  it('has a site folder with an index page for each lab host, and no folder no host names', () => {
    const folders = readdirSync(SITES).filter((f) => statSync(join(SITES, f)).isDirectory());
    expect(folders.sort()).toEqual(labHosts().map(label).sort());
    for (const host of labHosts()) {
      expect(existsSync(join(SITES, label(host), 'index.html')), host).toBe(true);
    }
  });

  it('routes each lab host, from a browser, into its own folder, at any path', () => {
    for (const host of labHosts()) {
      for (const path of PATHS) {
        expect(routeFor(host, path, CONTROL.userAgent), `${host}${path}`).toEqual({
          status: undefined,
          dest: `/sites/${label(host)}${path}`,
        });
      }
    }
  });

  it('answers 403 on cf-blocked to every user agent we send that says Crawlmouse, and on no other host', () => {
    const tagged = taggedUserAgents();
    expect(tagged.length).toBeGreaterThan(3);
    for (const ua of tagged) {
      expect(ua).toMatch(/crawlmouse/i);
      for (const path of PATHS) {
        expect(routeFor(QA_HOSTS.cfBlocked, path, ua)?.status, `${path} ${ua}`).toBe(403);
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

  it('holds under 500 pages across every host, so a QA run stays cheap', () => {
    const pages = (dir: string): number =>
      readdirSync(dir, { withFileTypes: true }).reduce(
        (n, e) =>
          n + (e.isDirectory() ? pages(join(dir, e.name)) : e.name.endsWith('.html') ? 1 : 0),
        0,
      );
    expect(pages(SITES)).toBeLessThan(500);
  });

  it('is what the generator writes, so the served sites are the reviewed ones', () => {
    const run = spawnSync(process.execPath, [join(LAB, 'generate.mjs'), '--check'], {
      encoding: 'utf8',
    });
    expect(run.stderr).toBe('');
    expect(run.status).toBe(0);
  });
});
