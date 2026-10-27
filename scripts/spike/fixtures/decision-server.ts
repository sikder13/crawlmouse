import http from 'node:http';
import { CRAWLER_TOKENS, type IdentityName } from '../worker/identities.js';
import { SITE_NAMES, respond, robotsFor, type SiteName } from './shapes.js';
import { listen } from './ssrf.js';

/**
 * node:http server that answers as one of the five discriminator sites (spike spec 2.3), keyed on the
 * request's user agent. The responses come from the same recorded shapes the unit tests classify.
 */

export function identityOfUa(ua: string): IdentityName {
  if (/Googlebot/i.test(ua)) return 'googlebot';
  for (const t of CRAWLER_TOKENS) if (ua.includes(t)) return t;
  if (/Chrome\//.test(ua) && !/Crawlmouse/.test(ua)) return 'browser';
  return 'crawlmouse';
}

export function pageIndexOf(url: string): number {
  if (url === '/' || url === '') return 0;
  const m = url.match(/^\/p\/(\d+)$/);
  return m ? Number(m[1]) : -1;
}

export function createSiteServer(site: SiteName): http.Server {
  return http.createServer((req, res) => {
    const url = req.url ?? '/';
    if (url === '/robots.txt') {
      res.setHeader('content-type', 'text/plain; charset=utf-8');
      res.end(robotsFor(site));
      return;
    }
    const idx = pageIndexOf(url);
    if (idx < 0) {
      res.statusCode = 404;
      res.end('');
      return;
    }
    const r = respond(site, identityOfUa(String(req.headers['user-agent'] ?? '')), idx);
    res.statusCode = r.status;
    for (const [k, v] of Object.entries(r.headers)) res.setHeader(k, v);
    res.end(r.body);
  });
}

export async function startAllSiteServers(host = '127.0.0.1'): Promise<{ bases: Record<SiteName, string>; servers: http.Server[] }> {
  const bases = {} as Record<SiteName, string>;
  const servers: http.Server[] = [];
  for (const site of SITE_NAMES) {
    const s = createSiteServer(site);
    servers.push(s);
    bases[site] = await listen(s, host, 0);
  }
  return { bases, servers };
}
