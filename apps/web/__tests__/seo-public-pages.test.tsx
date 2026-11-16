/**
 * CC-40 D3: every URL the sitemap lists, in both builds, held to the technical SEO rules in
 * `lib/seo/page-rules.ts`. The two builds are the flags off (today's site) and all four v2 flags on
 * (V2_ACCOUNT_DOOR, V2_PIPELINE, V2_CHECKS_PUBLIC, V2_BILLING).
 *
 * For each build the test calls `app/sitemap.ts`, maps every listed URL to the route module that
 * serves it in that build (v1's page, or the row of `V2_REWRITES` whose flag is on: a v2 page or a
 * kept page), and fails on a URL it cannot map; that walk is `__tests__/helpers/public-pages.ts`. For each page it reads the route's own `Metadata`
 * (its `metadata` export or `generateMetadata`), with the four head fields the page leaves unset
 * taken from the root layout's (`headFromMetadata`), and the body from `renderToStaticMarkup` of the
 * page element, as `__tests__/helpers/blog-render.tsx` renders posts.
 *
 * A violation fails unless `PAGE_EXCEPTIONS` (lib/seo/page-exceptions.ts) lists it, with its reason;
 * an exception that no longer fires fails too, so the list cannot outlive what it excuses.
 *
 * What it cannot see:
 * - `/r/` reports: the sitemap's Supabase read is stubbed to none here, so no report is listed.
 * - Mixed-flag states (one v2 flag on, another off): only all-off and all-on are built.
 * - The emitted `<head>`: Next's merge of the layout's and the page's metadata (Open Graph, images,
 *   anything beyond title, description, canonical and robots), and the root layout's own body (its
 *   Organization block). The page audit (`scripts/seo/audit.ts`) reads those from `next start`.
 * - What a client component draws after hydration: the render is the server's HTML.
 */
import { JSDOM } from 'jsdom';
import { afterEach, describe, expect, it, vi } from 'vitest';

// --- Mocks, by the routes that need them -------------------------------------------------------
// The root layout's fonts come from next/font/google, which only Next's compiler can load.
vi.mock('@/lib/fonts', () => ({
  fraunces: { variable: '' },
  geist: { variable: '' },
  geistMono: { variable: '' },
}));
// app/sitemap.ts: its /r/ section reads Supabase; stubbed to no reports (see the header).
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({}) }));
vi.mock('@/lib/sitemap-reports', () => ({ fetchIndexableReportSlugs: async () => [] }));
// Client components read the App Router's context, which a static render has not mounted.
vi.mock('next/navigation', async (actual) => ({
  ...(await actual<typeof import('next/navigation')>()),
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {}, prefetch: () => {} }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}));
// app/v2-pricing: rendered per request. It 404s unless reached through the middleware's rewrite
// (the rewrite header), reads the viewer from Supabase and the request's cookie, and sends an event
// after the response. Here: reached by the rewrite, an anonymous visitor, no cookie, no event.
vi.mock('server-only', () => ({}));
vi.mock('@/lib/v2/rewrite-target', () => ({ reachedByRewrite: async () => true }));
vi.mock('@/lib/v2/pricing/read', () => ({
  readPricingVisit: async () => ({ viewer: { kind: 'signed_out' }, userId: null }),
}));
vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
vi.mock('next/server', async (actual) => ({
  ...(await actual<typeof import('next/server')>()),
  after: () => {},
}));
vi.mock('@/lib/analytics-server', () => ({ captureServerEvent: async () => {} }));

import { metadata as rootMetadata } from '../app/layout';
import { earnsImpressions } from '../lib/seo/search-console';
import {
  headFromMetadata,
  linkViolations,
  pageViolations,
  siteViolations,
  type PageHead,
  type Violation,
} from '../lib/seo/page-rules';
import { pageFacts, type PageFacts } from '../lib/seo/page-facts';
import { loadPage, ORIGIN, sitemapPaths, stubBuild } from './helpers/public-pages';
import {
  CANONICAL_TARGETS,
  LIVE_OUTSIDE_SITEMAP,
  PAGE_EXCEPTIONS,
  type Build,
} from '../lib/seo/page-exceptions';

interface Rendered {
  path: string;
  servedBy: string;
  head: PageHead;
  body: PageFacts;
}

async function renderPage(path: string, build: Build): Promise<Rendered> {
  const { servedBy, meta, html } = await loadPage(path, build);
  const doc = new JSDOM(`<!doctype html><html><head></head><body>${html}</body></html>`).window
    .document;
  return {
    path,
    servedBy,
    head: headFromMetadata(meta, rootMetadata, ORIGIN),
    body: pageFacts(doc, { url: `${ORIGIN}${path}`, status: 200, origins: [ORIGIN] }),
  };
}

async function buildRun(build: Build) {
  stubBuild(build);
  const paths = await sitemapPaths();
  const pages: Rendered[] = [];
  for (const p of paths) pages.push(await renderPage(p, build));
  const live = new Set([
    ...paths,
    ...LIVE_OUTSIDE_SITEMAP.filter((l) => l.builds.includes(build)).map((l) => l.path),
  ]);
  const ctx = { origin: ORIGIN, live, earnsImpressions, canonicalTargets: CANONICAL_TARGETS };
  const violations: Violation[] = [];
  const reported: Violation[] = [];
  for (const p of pages) {
    const r = pageViolations(p, ctx);
    violations.push(...r.violations);
    reported.push(...r.reported);
  }
  violations.push(...siteViolations(pages));
  // No sitemap page without an in-link from another (the home is the root), and every post within
  // two clicks of /blog (CC-40 D6).
  violations.push(
    ...linkViolations(
      pages.map((p) => ({ path: p.path, links: p.body.links })),
      { root: '/', within: [{ from: '/blog', pattern: /^\/blog\/[^/]+$/, clicks: 2 }] },
    ),
  );
  return { paths, pages, violations, reported };
}

const key = (v: { path: string; rule: string }) => `${v.path} ${v.rule}`;

afterEach(() => vi.unstubAllEnvs());

describe.each(['off', 'on'] as const)('public pages, flags %s', (build) => {
  it('every sitemap URL maps to a route, and only the documented exceptions fire', async () => {
    const run = await buildRun(build);
    expect(run.paths.length).toBeGreaterThan(20);
    // The flag-gated pages are listed, and served by their v2 or kept route, only with the flags on.
    expect(run.paths.includes('/check/gptbot')).toBe(build === 'on');
    expect(run.pages.find((p) => p.path === '/blog')!.servedBy).toBe(
      build === 'on' ? '/v2-kept/blog' : '/blog',
    );
    const excepted = PAGE_EXCEPTIONS.filter((e) => e.builds.includes(build));
    const firing = new Set(run.violations.map(key));
    const unexcused = run.violations.filter((v) => !excepted.some((e) => key(e) === key(v)));
    const stale = excepted.filter((e) => !firing.has(key(e)));
    expect(unexcused, 'violations not in PAGE_EXCEPTIONS').toEqual([]);
    expect(stale, 'exceptions that no longer fire: delete them').toEqual([]);
  }, 240_000);
});
