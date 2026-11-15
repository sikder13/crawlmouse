/**
 * CC-36 D3: each kept v1 public page's target in app/(v2-kept). For each page, against v1's own
 * module:
 * - with V2_CHECKS_PUBLIC off the target is a 404;
 * - it exports what v1's page exports, by name, and each export is v1's: the metadata (deep-equal,
 *   or for a page that reads params, the same answer for a representative param), the static
 *   params, and each route-segment literal;
 * - with the flag on it draws v2's shell, and inside the shell exactly v1's markup with v1's header
 *   and footer taken out. The expected markup is cut from v1's render with a DOM parser, not with
 *   the element walk the target uses (`withoutV1Chrome`), so the two are not the same code.
 *
 * Header and Footer are stood in for by elements this file can find. Data a page reads (the audit,
 * the verification, the report row) comes from stubs.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import type { PublicReportRow } from '@/lib/reports';

vi.mock('@/components/layout/Header', () => ({
  Header: () => <header data-v1-chrome="header">v1 header</header>,
}));
vi.mock('@/components/layout/Footer', () => ({
  Footer: () => <footer data-v1-chrome="footer">v1 footer</footer>,
}));

const AUDIT_ID = '0b1c2d3e-4f50-4a6b-8c7d-9e0f1a2b3c4d';
const VERIFY_ID = '1c2d3e4f-5061-4b7c-9d8e-0f1a2b3c4d5e';
const SLUG = 'aB3dE5fG7hJ9kL1mN3pQ5r';

const row = (data: unknown) => {
  const chain = {
    select: () => chain,
    eq: () => chain,
    maybeSingle: async () => ({ data, error: null }),
  };
  return chain;
};
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({ from: () => row({ id: AUDIT_ID, url: 'https://example.com/' }) }),
}));
vi.mock('@/lib/supabase/server', () => ({
  supabaseServer: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'user-1' } } }) },
    from: () =>
      row({
        id: VERIFY_ID,
        domain: 'example.com',
        method: 'dns_txt',
        verification_token: 'token',
        verified_at: null,
      }),
  }),
}));
vi.mock('@/app/audit/[id]/_lib/access', () => ({ isReadableAudit: async () => false }));
vi.mock('@/lib/reports', () => ({
  getPublicReport: async (): Promise<PublicReportRow> => ({
    domain: 'example.com',
    grade: 'B',
    score: 81,
    cms_detected: 'wordpress',
    orphan_count: 3,
    avg_depth: 2.1,
    takedown_requested_at: null,
    created_at: '2026-10-01T00:00:00.000Z',
    claimed_at: null,
    listed: false,
    indexable: false,
    hidden_at: null,
    white_label: null,
    report_snapshot: null,
  }),
}));
// The client components a page draws read the App Router's context, which a static render has not
// mounted; notFound() and redirect() stay Next's.
vi.mock('next/navigation', async (actual) => ({
  ...(await actual<typeof import('next/navigation')>()),
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {}, prefetch: () => {} }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@/components/v2/screens/public-report/ReportViewBeacon', () => ({
  ReportViewBeacon: () => <i data-beacon="" />,
}));

type Module = Record<string, unknown> & {
  default: (props: never) => ReactNode | Promise<ReactNode>;
};
interface Kept {
  from: string;
  v1: () => Promise<Module>;
  target: () => Promise<Module>;
  params?: Record<string, string>;
  searchParams?: Record<string, string>;
  /** Markup the target draws before v1's page: the report's view beacon (CC-29), as before CC-36. */
  before?: string;
}

/** Each row of `V2_REWRITES` under `/v2-kept`, and the report's (its target is v2-report's). */
const PAGES: Kept[] = [
  {
    from: '/ai-readiness-checker',
    v1: () => import('@/app/ai-readiness-checker/page'),
    target: () => import('./v2-kept/ai-readiness-checker/page'),
  },
  {
    from: '/audit/:id',
    v1: () => import('@/app/audit/[id]/page'),
    target: () => import('./v2-kept/audit/[id]/page'),
    params: { id: AUDIT_ID },
    searchParams: { view: 'ai' },
  },
  {
    from: '/authors/:slug',
    v1: () => import('@/app/authors/[slug]/page'),
    target: () => import('./v2-kept/authors/[slug]/page'),
    params: { slug: 'udaay-sikder' },
  },
  {
    from: '/blog',
    v1: () => import('@/app/blog/page'),
    target: () => import('./v2-kept/blog/page'),
  },
  {
    from: '/blog/research',
    v1: () => import('@/app/blog/research/page'),
    target: () => import('./v2-kept/blog/research/page'),
  },
  {
    from: '/blog/:slug',
    v1: () => import('@/app/blog/[slug]/page'),
    target: () => import('./v2-kept/blog/[slug]/page'),
    params: { slug: 'orphan-pages' },
  },
  { from: '/bot', v1: () => import('@/app/bot/page'), target: () => import('./v2-kept/bot/page') },
  {
    from: '/guides',
    v1: () => import('@/app/guides/page'),
    target: () => import('./v2-kept/guides/page'),
  },
  {
    from: '/login',
    v1: () => import('@/app/login/page'),
    target: () => import('./v2-kept/login/page'),
  },
  {
    from: '/status',
    v1: () => import('@/app/status/page'),
    target: () => import('./v2-kept/status/page'),
  },
  {
    from: '/takedown',
    v1: () => import('@/app/takedown/page'),
    target: () => import('./v2-kept/takedown/page'),
  },
  {
    from: '/verify/:id',
    v1: () => import('@/app/verify/[id]/page'),
    target: () => import('./v2-kept/verify/[id]/page'),
    params: { id: VERIFY_ID },
    searchParams: { next: '/r/x' },
  },
  {
    from: '/privacy',
    v1: () => import('@/app/privacy/page'),
    target: () => import('./v2-kept/privacy/page'),
  },
  {
    from: '/terms',
    v1: () => import('@/app/terms/page'),
    target: () => import('./v2-kept/terms/page'),
  },
  { from: '/aup', v1: () => import('@/app/aup/page'), target: () => import('./v2-kept/aup/page') },
  {
    from: '/subprocessors',
    v1: () => import('@/app/subprocessors/page'),
    target: () => import('./v2-kept/subprocessors/page'),
  },
  {
    from: '/r/:slug',
    v1: () => import('@/app/r/[slug]/page'),
    target: () => import('@/app/v2-report/[slug]/page'),
    params: { slug: SLUG },
    before: '<i data-beacon=""></i>',
  },
];

const propsOf = (p: Kept) =>
  ({
    params: Promise.resolve(p.params ?? {}),
    searchParams: Promise.resolve(p.searchParams ?? {}),
  }) as never;

/** Next's notFound() throws an error whose digest names the 404 fallback. */
async function digestOf(render: () => unknown): Promise<string> {
  try {
    await render();
  } catch (error) {
    return String((error as { digest?: unknown }).digest);
  }
  return 'rendered';
}

const SEGMENT_CONFIG = [
  'dynamic',
  'dynamicParams',
  'revalidate',
  'fetchCache',
  'runtime',
  'preferredRegion',
  'maxDuration',
];

/** v1's markup with its header and footer cut out by a DOM parser, and a wrapper they leave empty. */
function withoutChromeByDom(markup: string): string {
  const doc = new JSDOM(`<body><div id="root">${markup}</div></body>`).window.document;
  const root = doc.getElementById('root')!;
  for (const el of [...root.querySelectorAll('[data-v1-chrome]')]) {
    const parent = el.parentElement!;
    const alone = parent !== root && parent.childNodes.length === 1;
    (alone ? parent : el).remove();
  }
  return root.innerHTML;
}

/** Markup parsed as the children of one element (a leading script stays in the body). */
const fragment = (markup: string): HTMLElement => {
  const doc = new JSDOM(`<body><div id="root">${markup}</div></body>`).window.document;
  return doc.getElementById('root')!;
};

/** The ai-readiness form's container: the parent of the one form. */
const formBox = (root: ParentNode) => root.querySelector('form')!.parentElement!;

async function render(mod: Module, p: Kept): Promise<string> {
  return renderToStaticMarkup(<>{await mod.default(propsOf(p))}</>);
}

beforeEach(() => vi.stubEnv('V2_CHECKS_PUBLIC', '1'));
afterEach(() => vi.unstubAllEnvs());

describe.each(PAGES)('the kept page $from', (p) => {
  it('is a 404 with V2_CHECKS_PUBLIC off', async () => {
    vi.stubEnv('V2_CHECKS_PUBLIC', '');
    const target = await p.target();
    expect(await digestOf(() => target.default(propsOf(p)))).toContain('404');
  }, 60_000);

  it('exports what v1’s page exports, each the same: metadata, static params, segment literals', async () => {
    const [v1, target] = [await p.v1(), await p.target()];
    expect(Object.keys(target).sort()).toEqual(Object.keys(v1).sort());
    if ('metadata' in v1) expect(target.metadata).toEqual(v1.metadata);
    if ('generateStaticParams' in v1)
      expect(target.generateStaticParams).toBe(v1.generateStaticParams);
    for (const key of SEGMENT_CONFIG) expect(target[key], key).toBe(v1[key]);
    if ('generateMetadata' in v1) {
      type Gen = (props: never) => Promise<Metadata>;
      const want = await (v1.generateMetadata as Gen)(propsOf(p));
      const got = await (target.generateMetadata as Gen)(propsOf(p));
      if (p.from === '/blog/:slug') {
        // The post's share image, which v1's segment file supplies, is named by the target.
        const image = {
          url: `/blog/${p.params!.slug}/opengraph-image`,
          ...(await import('@/app/blog/[slug]/opengraph-image').then((m) => ({
            alt: m.alt,
            type: m.contentType,
            width: m.size.width,
            height: m.size.height,
          }))),
        };
        expect(got).toEqual({
          ...want,
          openGraph: { ...want.openGraph, images: [image] },
          twitter: { ...want.twitter, images: [image] },
        });
      } else expect(got).toEqual(want);
    }
  }, 60_000);

  it('draws v2’s shell around v1’s own markup, v1’s header and footer taken out', async () => {
    const [v1, target] = [await p.v1(), await p.target()];
    const want = fragment(withoutChromeByDom(await render(v1, p)));
    const page = fragment(await render(target, p));
    expect(page.querySelectorAll('[data-v1-chrome]')).toHaveLength(0);
    expect(
      page.querySelectorAll('[data-v2-shell] > header nav[aria-label="Primary"]'),
    ).toHaveLength(1);
    expect(page.querySelectorAll('[data-v2-shell] > footer')).toHaveLength(1);
    const got = page.querySelector('[data-v2-shell] > [data-v1-content]')!;
    if (p.from === '/ai-readiness-checker') {
      // The one part that differs: v1's form posts to a route the cutover retires (Q4).
      expect(formBox(want).querySelector('form')).not.toBeNull();
      expect(
        formBox(page).querySelector('form[aria-label="Start an audit"] input[name="url"]'),
      ).not.toBeNull();
      formBox(want).innerHTML = '';
      formBox(page).innerHTML = '';
    }
    expect(got.innerHTML).toBe(`${p.before ?? ''}${want.innerHTML}`);
    expect(got.innerHTML.length).toBeGreaterThan(200);
  }, 60_000);
});
