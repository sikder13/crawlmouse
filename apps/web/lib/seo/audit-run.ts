/**
 * One pass of the SEO page audit over a running build: read its sitemap, fetch every listed URL and
 * every app surface, and record what each answered. `scripts/seo/audit.ts` runs it against a local
 * production build; the HTML parser and `fetch` are passed in, so a test can run it on fixtures.
 */
import { APP_SURFACES } from './app-surfaces';
import { hiddenFaqQuestions, jaccard, pageFacts, shingles, type PageFacts } from './page-facts';

export interface SurfaceAnswer {
  path: string;
  status: number;
  /** Where a redirect points, as a path when it stays on the site. */
  location: string | null;
  robots: string[];
}

/** A page as saved: its facts without the page text, plus what was measured from that text. */
export interface SavedPage extends Omit<PageFacts, 'visibleText' | 'mainText'> {
  /** FAQPage questions the visible page does not show. */
  faqNotVisible: string[];
  /** Each whole-dollar price the visible page shows ("$19"), in order, repeats removed. */
  visiblePrices: number[];
  /** For a post, the other post whose main text is most alike (word 5-gram Jaccard). */
  nearest: { path: string; jaccard: number } | null;
}

export interface AuditRun {
  /** "flags off" or "flags on". */
  label: string;
  /** The commit the build was made from. */
  sha: string;
  takenAt: string;
  /** The sitemap's URLs, as paths, in its order. */
  sitemap: string[];
  pages: SavedPage[];
  surfaces: SurfaceAnswer[];
}

type Fetch = (url: string, init: { redirect: 'manual' }) => Promise<Response>;

/** Every `<loc>` in a sitemap document. */
export function sitemapLocs(xml: string): string[] {
  return [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => m[1]!.replace(/&amp;/g, '&'));
}

export async function auditBuild(args: {
  /** The build being read, e.g. http://localhost:3100. */
  base: string;
  /** The site origin its sitemap and canonicals name, e.g. https://crawlmouse.com. */
  origin: string;
  label: string;
  sha: string;
  fetch: Fetch;
  parse: (html: string) => Document;
  now?: () => Date;
}): Promise<AuditRun> {
  const { base, origin } = args;
  const local = (path: string) => `${base}${path}`;
  const res = await args.fetch(local('/sitemap.xml'), { redirect: 'manual' });
  if (res.status !== 200) throw new Error(`sitemap.xml answered ${res.status}`);
  const sitemap = sitemapLocs(await res.text()).map((u) => {
    const url = new URL(u);
    if (url.origin !== origin) throw new Error(`sitemap lists ${u}, not on ${origin}`);
    return url.pathname;
  });

  const pages: PageFacts[] = [];
  for (const path of sitemap) {
    const r = await args.fetch(local(path), { redirect: 'manual' });
    const html = r.status === 200 ? await r.text() : '<html><head></head><body></body></html>';
    const facts = pageFacts(args.parse(html), {
      url: local(path),
      status: r.status,
      origins: [origin, base],
      xRobotsTag: r.headers.get('x-robots-tag'),
    });
    pages.push(facts);
  }

  const surfaces: SurfaceAnswer[] = [];
  for (const path of APP_SURFACES) {
    const r = await args.fetch(local(path), { redirect: 'manual' });
    const loc = r.headers.get('location');
    const html = r.status === 200 ? await r.text() : '';
    const facts = html
      ? pageFacts(args.parse(html), {
          url: local(path),
          status: r.status,
          origins: [origin, base],
          xRobotsTag: r.headers.get('x-robots-tag'),
        })
      : null;
    surfaces.push({
      path,
      status: r.status,
      location: loc ? new URL(loc, local(path)).pathname : null,
      robots:
        facts?.robots ?? (r.headers.get('x-robots-tag') ? [r.headers.get('x-robots-tag')!] : []),
    });
  }

  return {
    label: args.label,
    sha: args.sha,
    takenAt: (args.now ?? (() => new Date()))().toISOString(),
    sitemap,
    pages: savePages(pages),
    surfaces,
  };
}

const isPost = (path: string) => /^\/blog\/[^/]+$/.test(path) && path !== '/blog/research';

/** Facts without their text, with the near-duplicate and FAQ measurements taken from it. */
export function savePages(pages: readonly PageFacts[]): SavedPage[] {
  const posts = pages
    .filter((p) => isPost(p.path))
    .map((p) => ({ path: p.path, sh: shingles(p.mainText) }));
  return pages.map(({ visibleText, mainText, ...rest }) => {
    let best: { path: string; j: number } | null = null;
    if (isPost(rest.path)) {
      const own = shingles(mainText);
      for (const other of posts) {
        if (other.path === rest.path) continue;
        const j = jaccard(own, other.sh);
        if (!best || j > best.j) best = { path: other.path, j };
      }
    }
    const nearest = best ? { path: best.path, jaccard: Math.round(best.j * 1000) / 1000 } : null;
    return {
      ...rest,
      faqNotVisible: hiddenFaqQuestions({ jsonLd: rest.jsonLd, visibleText }),
      visiblePrices: visiblePrices(visibleText),
      nearest,
    };
  });
}

/** True when a robots value forbids indexing. */
export const isNoindex = (robots: readonly string[]) =>
  robots.some((r) => /(^|[\s,])(noindex|none)([\s,]|$)/i.test(r));

/** The whole-dollar amounts a text shows, as "$19" or "$1,990", in order, repeats removed. */
export function visiblePrices(text: string): number[] {
  const amounts = [...text.matchAll(/\$(\d{1,3}(?:,\d{3})*)(?![\d.,]\d)/g)];
  return [...new Set(amounts.map((m) => Number(m[1]!.replace(/,/g, ''))))];
}
