/**
 * CC-40 D8: no public page uses a phrase in `lib/seo/banned-phrases.ts`, in either build (the flags
 * off, and all four v2 flags on). The pages are the ones `app/sitemap.ts` lists, read through the
 * same walk as the D3 test (`__tests__/helpers/public-pages.ts`), plus `/llms.txt`.
 *
 * Per page it reads: the visible text of the server render (scripts, styles and templates removed)
 * and each image's `alt`; every string in the route's own `Metadata` (title, description, Open Graph,
 * Twitter, keywords); and every string value of every JSON-LD block the page renders, at any depth.
 * Once per build it reads the root layout's `Metadata` and its Organization block (`organizationLd`),
 * as the page `(layout)`, and the body `GET /llms.txt` returns.
 *
 * A match fails unless `PHRASE_EXCEPTIONS` (lib/seo/banned-phrase-exceptions.ts) lists it, with its
 * reason; an exception that no longer fires fails too.
 *
 * What it cannot see:
 * - `/r/` reports: the sitemap's Supabase read is stubbed to none, so no report is listed. Their
 *   text is the audited site's, not ours, apart from the report shell.
 * - Mixed-flag states (one v2 flag on, another off): only all-off and all-on are built.
 * - Next's merge of the layout's and the page's metadata as emitted in `<head>`; both are read
 *   here separately, so a string either one holds is seen.
 * - The root layout's body other than its Organization block (the consent banner, which renders
 *   after hydration), and what any client component draws after hydration.
 * - Image text: the share cards (`opengraph-image.tsx`) are rendered pictures. The root card's words
 *   are `V2_SHARE_CARD` in `lib/seo/site-copy.ts`, which is checked here as data.
 * - Pages outside the sitemap (app surfaces, `noindex`).
 */
import { JSDOM } from 'jsdom';
import { afterEach, describe, expect, it, vi } from 'vitest';

// --- Mocks: the same as seo-public-pages.test.tsx, for the same routes (see its comments) -------
vi.mock('@/lib/fonts', () => ({
  fraunces: { variable: '' },
  geist: { variable: '' },
  geistMono: { variable: '' },
}));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({}) }));
vi.mock('@/lib/sitemap-reports', () => ({ fetchIndexableReportSlugs: async () => [] }));
vi.mock('next/navigation', async (actual) => ({
  ...(await actual<typeof import('next/navigation')>()),
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {}, prefetch: () => {} }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}));
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

import { metadata as rootMetadata } from '../app/layout';
import { GET as llmsTxt } from '../app/llms.txt/route';
import { organizationLd } from '../lib/seo/jsonld';
import { pageFacts } from '../lib/seo/page-facts';
import { V2_SHARE_CARD } from '../lib/seo/site-copy';
import { bannedMatches } from '../lib/seo/banned-phrases';
import { PHRASE_EXCEPTIONS } from '../lib/seo/banned-phrase-exceptions';
import type { Build } from '../lib/seo/page-exceptions';
import { loadPage, ORIGIN, sitemapPaths, stubBuild } from './helpers/public-pages';

type Where = 'text' | 'metadata' | 'json-ld' | 'llms.txt';

interface Found {
  path: string;
  phrase: string;
  where: Where;
  match: string;
}

/** Every string value in `value`, at any depth (object keys are names, not copy, and are skipped). */
function stringsIn(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (value === null || typeof value !== 'object') return [];
  if (value instanceof URL) return [value.href];
  return Object.values(value).flatMap(stringsIn);
}

interface Run {
  paths: string[];
  found: Found[];
  /** Characters read, per kind of source: a source that read nothing would pass by doing nothing. */
  read: Record<Where, number>;
}

async function buildRun(build: Build): Promise<Run> {
  stubBuild(build);
  const read: Record<Where, number> = { text: 0, metadata: 0, 'json-ld': 0, 'llms.txt': 0 };
  const find = (path: string, where: Where, texts: readonly string[]): Found[] => {
    for (const t of texts) read[where] += t.length;
    return texts.flatMap((t) =>
      bannedMatches(t).map((m) => ({ path, phrase: m.id, where, match: m.match })),
    );
  };
  const paths = await sitemapPaths();
  const found: Found[] = [
    ...find('(layout)', 'metadata', stringsIn(rootMetadata)),
    ...find('(layout)', 'json-ld', stringsIn(organizationLd())),
    ...find('(layout)', 'metadata', stringsIn(V2_SHARE_CARD)),
    ...find('/llms.txt', 'llms.txt', [await llmsTxt().text()]),
  ];
  for (const path of paths) {
    const { meta, html } = await loadPage(path, build);
    const doc = new JSDOM(`<!doctype html><html><head></head><body>${html}</body></html>`).window
      .document;
    const facts = pageFacts(doc, { url: `${ORIGIN}${path}`, status: 200, origins: [ORIGIN] });
    const alts = [...doc.querySelectorAll('img[alt]')].map((i) => i.getAttribute('alt')!);
    found.push(
      ...find(path, 'text', [facts.visibleText, ...alts]),
      ...find(path, 'metadata', stringsIn(meta)),
      ...find(
        path,
        'json-ld',
        facts.jsonLd.flatMap((b) => stringsIn(b.data ?? b.raw)),
      ),
    );
  }
  return { paths, found, read };
}

const key = (v: { path: string; phrase: string }) => `${v.path} ${v.phrase}`;

afterEach(() => vi.unstubAllEnvs());

describe.each(['off', 'on'] as const)('banned phrases, flags %s', (build) => {
  it('no public page uses one, apart from the documented exceptions', async () => {
    const run = await buildRun(build);
    expect(run.paths.length).toBeGreaterThan(20);
    expect(run.paths.includes('/check/gptbot')).toBe(build === 'on');
    // Each kind of source was read: the pages' text and metadata run to many thousand characters.
    for (const [where, chars] of Object.entries(run.read))
      expect(chars, where).toBeGreaterThan(1000);
    const excepted = PHRASE_EXCEPTIONS.filter((e) => e.builds.includes(build));
    const firing = new Set(run.found.map(key));
    const unexcused = run.found.filter((f) => !excepted.some((e) => key(e) === key(f)));
    const stale = excepted.filter((e) => !firing.has(key(e)));
    expect(unexcused, 'banned phrases not in PHRASE_EXCEPTIONS').toEqual([]);
    expect(stale, 'exceptions that no longer fire: delete them').toEqual([]);
  }, 240_000);
});
