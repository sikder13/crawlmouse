import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, vi } from 'vitest';
import sitemap from '../../app/sitemap';
import { V2_REWRITES, type RewriteFlag } from '../../lib/v2/rewrites';
import type { Build } from '../../lib/seo/page-exceptions';

// The walk over every public page of both builds, shared by the CC-40 page tests
// (seo-public-pages.test.tsx, seo-banned-phrases.test.tsx). The two builds are the flags off
// (today's site) and all four v2 flags on. A test that uses this module declares the mocks its
// routes need itself (see seo-public-pages.test.tsx): vi.mock applies to the file that calls it.

export const ORIGIN = 'https://crawlmouse.com';
export const FLAGS = ['V2_ACCOUNT_DOOR', 'V2_PIPELINE', 'V2_CHECKS_PUBLIC', 'V2_BILLING'] as const;
const REWRITE_FLAG_ON: Record<Build, Record<RewriteFlag, boolean>> = {
  off: { checksPublic: false, billing: false, publicPages: false },
  on: { checksPublic: true, billing: true, publicPages: true },
};

type RouteModule = {
  default: (props: never) => ReactNode | Promise<ReactNode>;
  metadata?: Metadata;
  generateMetadata?: (props: never) => Promise<Metadata>;
};

/** Each page route that serves a public URL, by its path pattern (`:name` is one segment). */
const ROUTES: Readonly<Record<string, () => Promise<RouteModule>>> = {
  '/': () => import('../../app/page'),
  '/pricing': () => import('../../app/pricing/page'),
  '/developers': () => import('../../app/developers/page'),
  '/ai-readiness-checker': () => import('../../app/ai-readiness-checker/page'),
  '/blog': () => import('../../app/blog/page'),
  '/blog/research': () => import('../../app/blog/research/page'),
  '/blog/:slug': () => import('../../app/blog/[slug]/page'),
  '/guides': () => import('../../app/guides/page'),
  '/authors/:slug': () => import('../../app/authors/[slug]/page'),
  '/bot': () => import('../../app/bot/page'),
  '/status': () => import('../../app/status/page'),
  '/privacy': () => import('../../app/privacy/page'),
  '/terms': () => import('../../app/terms/page'),
  '/aup': () => import('../../app/aup/page'),
  '/subprocessors': () => import('../../app/subprocessors/page'),
  '/takedown': () => import('../../app/takedown/page'),
  '/agencies': () => import('../../app/agencies/page'),
  '/check/:question': () => import('../../app/check/[question]/page'),
  '/help': () => import('../../app/help/page'),
  '/help/:slug': () => import('../../app/help/[slug]/page'),
  '/v2-home': () => import('../../app/v2-home/page'),
  '/v2-pricing': () => import('../../app/v2-pricing/page'),
  '/v2-developers': () => import('../../app/v2-developers/page'),
  '/v2-kept/ai-readiness-checker': () =>
    import('../../app/(v2-kept)/v2-kept/ai-readiness-checker/page'),
  '/v2-kept/blog': () => import('../../app/(v2-kept)/v2-kept/blog/page'),
  '/v2-kept/blog/research': () => import('../../app/(v2-kept)/v2-kept/blog/research/page'),
  '/v2-kept/blog/:slug': () => import('../../app/(v2-kept)/v2-kept/blog/[slug]/page'),
  '/v2-kept/guides': () => import('../../app/(v2-kept)/v2-kept/guides/page'),
  '/v2-kept/authors/:slug': () => import('../../app/(v2-kept)/v2-kept/authors/[slug]/page'),
  '/v2-kept/bot': () => import('../../app/(v2-kept)/v2-kept/bot/page'),
  '/v2-kept/status': () => import('../../app/(v2-kept)/v2-kept/status/page'),
  '/v2-kept/privacy': () => import('../../app/(v2-kept)/v2-kept/privacy/page'),
  '/v2-kept/terms': () => import('../../app/(v2-kept)/v2-kept/terms/page'),
  '/v2-kept/aup': () => import('../../app/(v2-kept)/v2-kept/aup/page'),
  '/v2-kept/subprocessors': () => import('../../app/(v2-kept)/v2-kept/subprocessors/page'),
  '/v2-kept/takedown': () => import('../../app/(v2-kept)/v2-kept/takedown/page'),
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

/** Sets the four flags for `build` (undone by `vi.unstubAllEnvs`). */
export function stubBuild(build: Build): void {
  for (const f of FLAGS) vi.stubEnv(f, build === 'on' ? '1' : '');
}

/** The paths `app/sitemap.ts` lists under the flags currently set, each on the production origin. */
export async function sitemapPaths(): Promise<string[]> {
  return (await sitemap()).map((e) => {
    const u = new URL(e.url);
    expect(u.origin, e.url).toBe(ORIGIN);
    return u.pathname === '' ? '/' : u.pathname;
  });
}

export interface LoadedPage {
  path: string;
  /** The page path whose route module serves `path` in this build. */
  servedBy: string;
  /** The route's own metadata: its `metadata` export, or what `generateMetadata` returns. */
  meta: Metadata;
  /** `renderToStaticMarkup` of the page element: the server's HTML, before hydration. */
  html: string;
}

/** Reads `path`'s route module as it serves `build`: its metadata and its rendered body. */
export async function loadPage(path: string, build: Build): Promise<LoadedPage> {
  const page = servedBy(path, build);
  const { load, params } = routeFor(page);
  const mod = await load();
  const props = { params: Promise.resolve(params), searchParams: Promise.resolve({}) } as never;
  const meta: Metadata =
    mod.metadata ?? (mod.generateMetadata ? await mod.generateMetadata(props) : {});
  const html = renderToStaticMarkup(await mod.default(props));
  return { path, servedBy: page, meta, html };
}
