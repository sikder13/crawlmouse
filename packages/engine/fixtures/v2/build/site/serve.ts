/**
 * The built site over HTTP, as generate.ts serves it with the worker's test server. It answers each
 * identity the worker sends (worker/src/test-support/discriminators.ts whoSent): ClaudeBot is refused
 * on every page, PerplexityBot on the blog, everyone else served.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { whoSent } from '../../../../../worker/src/test-support/discriminators.js';
import {
  COLLECTIONS,
  EDGE_REFUSED,
  pages,
  REDIRECT_TO,
  ROBOTS_TXT,
  sitemapPaths,
  STAGE2_CRAWLER,
} from './site.js';

/** The request handler generate.ts serves the site with. `variant` adds one link (see generate.ts). */
export function handler(variant: { linkRedirectTarget: boolean } = { linkRedirectTarget: false }) {
  const site = pages();
  if (variant.linkRedirectTarget) {
    const c = site.get(`/collections/${COLLECTIONS[1]}`)!;
    site.set(`/collections/${COLLECTIONS[1]}`, {
      ...c,
      body: c.body.replace(
        '</main>',
        `<p><a href="${REDIRECT_TO}">dome tent classic</a></p></main>`,
      ),
    });
  }
  return (req: IncomingMessage, res: ServerResponse): void => {
    const path = req.url ?? '/';
    const who = whoSent(String(req.headers['user-agent'] ?? ''));
    if (path === '/robots.txt') {
      res.setHeader('content-type', 'text/plain');
      return void res.end(ROBOTS_TXT);
    }
    if (path === '/sitemap.xml') {
      res.setHeader('content-type', 'application/xml');
      const urls = sitemapPaths()
        .map((p) => `<url><loc>${p}</loc></url>`)
        .join('');
      return void res.end(`<?xml version="1.0"?><urlset>${urls}</urlset>`);
    }
    const r = site.get(path);
    if (!r) {
      res.statusCode = 404;
      return void res.end('not found');
    }
    const refused = who === EDGE_REFUSED || (who === STAGE2_CRAWLER && path.startsWith('/blog/'));
    if (refused && r.status === 200) {
      res.statusCode = 403;
      res.setHeader('content-type', 'text/html');
      return void res.end('<html><body>Forbidden</body></html>');
    }
    res.statusCode = r.status;
    if (r.type) res.setHeader('content-type', r.type);
    if (r.location) res.setHeader('location', r.location);
    res.end(r.body);
  };
}
