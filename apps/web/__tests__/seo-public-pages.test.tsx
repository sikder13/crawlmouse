/**
 * CC-40 D3: every URL the sitemap lists, in both builds, held to the technical SEO rules in
 * `lib/seo/page-rules.ts`. The two builds are the flags off (today's site) and all four v2 flags on
 * (V2_ACCOUNT_DOOR, V2_PIPELINE, V2_CHECKS_PUBLIC, V2_BILLING).
 *
 * For each build the test calls `app/sitemap.ts`, maps every listed URL to the route module that
 * serves it in that build (v1's page, or the row of `V2_REWRITES` whose flag is on: a v2 page or a
 * kept page), and fails on a URL it cannot map. For each page it reads the route's own `Metadata`
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
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
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
  readPricingViewer: async () => ({ kind: 'signed_out' }),
}));
vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
vi.mock('next/server', async (actual) => ({
  ...(await actual<typeof import('next/server')>()),
  after: () => {},
}));
vi.mock('@/lib/analytics-server', () => ({ captureServerEvent: async () => {} }));

import sitemap from '../app/sitemap';
import { metadata as rootMetadata } from '../app/layout';
import { V2_REWRITES, type RewriteFlag } from '../lib/v2/rewrites';
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
import {
  CANONICAL_TARGETS,
  LIVE_OUTSIDE_SITEMAP,
  PAGE_EXCEPTIONS,
  type Build,
} from '../lib/seo/page-exceptions';

const ORIGIN = 'https://crawlmouse.com';
const FLAGS = ['V2_ACCOUNT_DOOR', 'V2_PIPELINE', 'V2_CHECKS_PUBLIC', 'V2_BILLING'] as const;
const REWRITE_FLAG_ON: Record<Build, Record<RewriteFlag, boolean>> = {
  off: { checksPublic: false, billing: false },
  on: { checksPublic: true, billing: true },
};

type RouteModule = {
  default: (props: never) => ReactNode | Promise<ReactNode>;
  metadata?: Metadata;
  generateMetadata?: (props: never) => Promise<Metadata>;
};

/** Each page route that serves a public URL, by its path pattern (`:name` is one segment). */
const ROUTES: Readonly<Record<string, () => Promise<RouteModule>>> = {
  '/': () => import('../app/page'),
  '/pricing': () => import('../app/pricing/page'),
  '/developers': () => import('../app/developers/page'),
  '/ai-readiness-checker': () => import('../app/ai-readiness-checker/page'),
  '/blog': () => import('../app/blog/page'),
  '/blog/research': () => import('../app/blog/research/page'),
  '/blog/:slug': () => import('../app/blog/[slug]/page'),
  '/guides': () => import('../app/guides/page'),
  '/authors/:slug': () => import('../app/authors/[slug]/page'),
  '/bot': () => import('../app/bot/page'),
  '/status': () => import('../app/status/page'),
  '/privacy': () => import('../app/privacy/page'),
  '/terms': () => import('../app/terms/page'),
  '/aup': () => import('../app/aup/page'),
  '/subprocessors': () => import('../app/subprocessors/page'),
  '/takedown': () => import('../app/takedown/page'),
  '/agencies': () => import('../app/agencies/page'),
  '/check/:question': () => import('../app/check/[question]/page'),
  '/help': () => import('../app/help/page'),
  '/help/:slug': () => import('../app/help/[slug]/page'),
  '/v2-home': () => import('../app/v2-home/page'),
  '/v2-pricing': () => import('../app/v2-pricing/page'),
  '/v2-developers': () => import('../app/v2-developers/page'),
  '/v2-kept/ai-readiness-checker': () =>
    import('../app/(v2-kept)/v2-kept/ai-readiness-checker/page'),
  '/v2-kept/blog': () => import('../app/(v2-kept)/v2-kept/blog/page'),
  '/v2-kept/blog/research': () => import('../app/(v2-kept)/v2-kept/blog/research/page'),
  '/v2-kept/blog/:slug': () => import('../app/(v2-kept)/v2-kept/blog/[slug]/page'),
  '/v2-kept/guides': () => import('../app/(v2-kept)/v2-kept/guides/page'),
  '/v2-kept/authors/:slug': () => import('../app/(v2-kept)/v2-kept/authors/[slug]/page'),
  '/v2-kept/bot': () => import('../app/(v2-kept)/v2-kept/bot/page'),
  '/v2-kept/status': () => import('../app/(v2-kept)/v2-kept/status/page'),
  '/v2-kept/privacy': () => import('../app/(v2-kept)/v2-kept/privacy/page'),
  '/v2-kept/terms': () => import('../app/(v2-kept)/v2-kept/terms/page'),
  '/v2-kept/aup': () => import('../app/(v2-kept)/v2-kept/aup/page'),
  '/v2-kept/subprocessors': () => import('../app/(v2-kept)/v2-kept/subprocessors/page'),
  '/v2-kept/takedown': () => import('../app/(v2-kept)/v2-kept/takedown/page'),
};

/** A path against a pattern: the params it binds, or null. Exact patterns win over `:name` ones. */
function matchPattern(pattern: string, path: string): Record<string, string> | null {
  const p = pattern.split('/');
  const g = path.split('/');
  if (p.length !== g.length) return null;
  const params: Record<string, string> = {};
  for (const [i, part] of p.entries()) {
    if (part.startsWith(':')) params[part.slice(1)] = g[i]!;
    else if (part !== g[i]) return null;
  }
  return params;
}

/** The page path that serves `path` in `build`: the v2 target when its row's flag is on. */
function servedBy(path: string, build: Build): string {
  for (const row of V2_REWRITES) {
    if (!REWRITE_FLAG_ON[build][row.flag]) continue;
    const params = matchPattern(row.from, path);
    if (params === null) continue;
    return Object.entries(params).reduce((to, [k, v]) => to.replace(`:${k}`, v), row.to);
  }
  return path;
}

function routeFor(page: string): {
  load: () => Promise<RouteModule>;
  params: Record<string, string>;
} {
  const patterns = Object.keys(ROUTES).sort(
    (a, b) => Number(a.includes(':')) - Number(b.includes(':')),
  );
  for (const pattern of patterns) {
    const params = matchPattern(pattern, page);
    if (params) return { load: ROUTES[pattern]!, params };
  }
  throw new Error(`no route module mapped for ${page}`);
}

interface Rendered {
  path: string;
  servedBy: string;
  head: PageHead;
  body: PageFacts;
}

async function renderPage(path: string, build: Build): Promise<Rendered> {
  const page = servedBy(path, build);
  const { load, params } = routeFor(page);
  const mod = await load();
  const props = { params: Promise.resolve(params), searchParams: Promise.resolve({}) } as never;
  const meta: Metadata =
    mod.metadata ?? (mod.generateMetadata ? await mod.generateMetadata(props) : {});
  const html = renderToStaticMarkup(await mod.default(props));
  const doc = new JSDOM(`<!doctype html><html><head></head><body>${html}</body></html>`).window
    .document;
  return {
    path,
    servedBy: page,
    head: headFromMetadata(meta, rootMetadata, ORIGIN),
    body: pageFacts(doc, { url: `${ORIGIN}${path}`, status: 200, origins: [ORIGIN] }),
  };
}

async function buildRun(build: Build) {
  for (const f of FLAGS) vi.stubEnv(f, build === 'on' ? '1' : '');
  const paths = (await sitemap()).map((e) => {
    const u = new URL(e.url);
    expect(u.origin, e.url).toBe(ORIGIN);
    return u.pathname === '' ? '/' : u.pathname;
  });
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
