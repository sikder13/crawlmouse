/**
 * The QA hosts and the lab that serves them (CC-QA). `QA_HOSTS` names the sites the QA accounts
 * audit; every `*.lab.crawlmouse.com` one is a static site under `fixtures/qa-lab/sites/<label>/`,
 * routed by host in `fixtures/qa-lab/vercel.json`. These tests hold the list, the folders and the
 * routes to one another, so a host cannot be seeded that the lab does not serve.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { QA_ACCOUNTS, QA_HOSTS } from './accounts';

const LAB = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'fixtures', 'qa-lab');
const SITES = join(LAB, 'sites');
const LAB_ZONE = '.lab.crawlmouse.com';

interface Route {
  src?: string;
  dest?: string;
  status?: number;
  handle?: string;
  has?: { type: string; key?: string; value?: string }[];
}

const routes = (): Route[] =>
  (JSON.parse(readFileSync(join(LAB, 'vercel.json'), 'utf8')) as { routes: Route[] }).routes;

const allHosts = (): string[] => Object.values(QA_HOSTS).flat();
const labHosts = (): string[] => allHosts().filter((h) => h.endsWith(LAB_ZONE));
const label = (host: string): string => host.slice(0, -LAB_ZONE.length);

/** The route a request takes: the first whose host and header conditions all hold (Vercel's order). */
function routeFor(host: string, userAgent: string): Route | undefined {
  return routes().find((r) =>
    (r.has ?? []).every((c) => {
      if (c.type === 'host') return c.value === host;
      if (c.type === 'header' && c.key === 'user-agent')
        return new RegExp(`^(?:${c.value})$`).test(userAgent);
      return false;
    }),
  );
}

const CRAWLER_UAS = ['CrawlmouseBot/1.0 (+https://crawlmouse.com/bot)', 'Crawlmouse/1.0'];
const BROWSER_UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

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

  it('routes each lab host, from a browser, into its own folder', () => {
    for (const host of labHosts()) {
      const r = routeFor(host, BROWSER_UA);
      expect(r?.dest, host).toBe(`/sites/${label(host)}/$1`);
      expect(r?.status, host).toBeUndefined();
    }
  });

  it('answers the crawler 403 on cf-blocked and on no other host', () => {
    for (const ua of CRAWLER_UAS) {
      expect(routeFor(QA_HOSTS.cfBlocked, ua)?.status, ua).toBe(403);
      for (const host of labHosts().filter((h) => h !== QA_HOSTS.cfBlocked)) {
        expect(routeFor(host, ua)?.status, `${host} ${ua}`).toBeUndefined();
      }
    }
    expect(routeFor(QA_HOSTS.cfBlocked, BROWSER_UA)?.status).toBeUndefined();
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
