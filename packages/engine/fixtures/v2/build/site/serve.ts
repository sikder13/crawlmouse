/**
 * The built site over HTTP, as generate.ts serves it with the worker's test server. It answers each
 * identity the worker sends (worker/src/test-support/discriminators.ts whoSent): ClaudeBot is refused
 * on every page, PerplexityBot on the blog, everyone else served.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { whoSent } from '../../../../../worker/src/test-support/discriminators.js';
import {
  CLIENT_RENDERED,
  COLLECTIONS,
  EDGE_REFUSED,
  guideWithIntro,
  pages,
  REDIRECT_TO,
  renderedGuide,
  renderedGuideWithIntro,
  ROBOTS_TXT,
  sitemapPaths,
  STAGE2_CRAWLER,
} from './site.js';

/**
 * How the site is served. Both false is the recorded fixture.
 *   `linkRedirectTarget`  one more link, to the redirect chain's final URL (generate.ts `variant/`)
 *   `guidesWithIntro`     the guides serve their heading and intro and leave their sections to a
 *                         script (site.ts `guideWithIntro`), for the live proof (live-proof.ts)
 */
export interface SiteVariant {
  linkRedirectTarget: boolean;
  guidesWithIntro?: boolean;
}

/** What the server answers at each path under `variant`, and the rendered side of each guide. */
export function servedSite(variant: SiteVariant): {
  pages: ReturnType<typeof pages>;
  renderedGuide: (path: string) => string;
} {
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
  if (variant.guidesWithIntro) {
    for (const g of CLIENT_RENDERED) site.set(g, { ...site.get(g)!, body: guideWithIntro(g) });
  }
  return {
    pages: site,
    renderedGuide: variant.guidesWithIntro ? renderedGuideWithIntro : renderedGuide,
  };
}

/** The request handler generate.ts serves the site with. */
export function handler(variant: SiteVariant = { linkRedirectTarget: false }) {
  const site = servedSite(variant).pages;
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
