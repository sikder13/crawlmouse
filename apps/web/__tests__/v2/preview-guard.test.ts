import { describe, it, expect, vi, afterEach } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import type { Metadata } from 'next';
import { WEB_ROOT } from './_lib/tokens-css';

const GROUP = join(WEB_ROOT, 'app', '(v2-preview)');
const PREVIEW = join(GROUP, 'v2-preview');

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.next') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

/** A page in any of Next's default page extensions, not only .tsx (a page.jsx is a page too). */
const PAGE = /(^|\/)page\.(t|j)sx?$/;

/**
 * Next's special file names. Each renders or answers on its own (a loading or not-found UI, a route
 * handler, a metadata image), so none of them is covered by a page's own guard.
 */
const SPECIAL = new Set([
  'layout',
  'template',
  'page',
  'loading',
  'error',
  'not-found',
  'global-error',
  'default',
  'route',
  'forbidden',
  'unauthorized',
  'opengraph-image',
  'twitter-image',
  'icon',
  'apple-icon',
  'sitemap',
  'robots',
  'manifest',
]);
const specialName = (file: string) => {
  const base = file.split('/').pop() ?? '';
  const name = base.slice(0, base.indexOf('.') < 0 ? undefined : base.indexOf('.'));
  return SPECIAL.has(name) ? name : null;
};

/** Next's notFound() throws an error whose digest names the 404 fallback. */
const isNotFound = (e: unknown) =>
  typeof e === 'object' &&
  e !== null &&
  /404|NOT_FOUND/.test(String((e as { digest?: unknown }).digest));

describe('v2 preview group: reachable only outside production', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  const layout = async () =>
    (await import('../../app/(v2-preview)/layout')) as {
      default: (p: { children: unknown }) => unknown;
      metadata: Metadata;
    };

  it('404s every preview page when NODE_ENV is production', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const { default: Layout } = await layout();
    let thrown: unknown;
    try {
      Layout({ children: 'x' });
    } catch (e) {
      thrown = e;
    }
    expect(isNotFound(thrown)).toBe(true);
  });

  // Next renders a layout and its page in parallel: a 404 thrown by the layout alone still ships
  // the page's payload inside the 404 response (measured under `next start`). So each page must
  // 404 by itself. This imports every page file on disk and calls it, rather than reading its text.
  it('404s every page by itself in production, before rendering anything', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const pages = walk(GROUP).filter((f) => PAGE.test(f));
    expect(pages.length).toBeGreaterThanOrEqual(12);
    const rendered: string[] = [];
    for (const file of pages) {
      const mod = (await import(file)) as { default: () => unknown };
      let thrown: unknown;
      try {
        mod.default();
      } catch (e) {
        thrown = e;
      }
      if (!isNotFound(thrown)) rendered.push(relative(GROUP, file));
    }
    expect(rendered).toEqual([]);
  });

  it('renders the preview in development and test', async () => {
    for (const env of ['development', 'test']) {
      vi.stubEnv('NODE_ENV', env);
      const { default: Layout } = await layout();
      expect(() => Layout({ children: 'x' })).not.toThrow();
    }
  });

  it('tells crawlers not to index or follow, with no canonical to the homepage', async () => {
    const { metadata } = await layout();
    expect(metadata.robots).toEqual({ index: false, follow: false });
    expect(metadata.alternates?.canonical).toBeNull();
  });

  it('has the guarded layout at the group root, above every preview page', () => {
    // A layout applies to everything below its folder, and every page is found inside the group.
    expect(existsSync(join(GROUP, 'layout.tsx'))).toBe(true);
    expect(walk(GROUP).filter((f) => PAGE.test(f)).length).toBeGreaterThanOrEqual(12);
  });

  it('has no route handler in the group: a route.ts would answer without the layout', () => {
    const handlers = walk(GROUP).filter((f) => /(^|\/)route\.(t|j)sx?$/.test(f));
    expect(handlers.map((f) => relative(WEB_ROOT, f))).toEqual([]);
  });

  it('has no Next special file in the group but the root layout and the pages', () => {
    const special = walk(GROUP)
      .filter((f) => specialName(f) !== null && !PAGE.test(f))
      .map((f) => relative(GROUP, f));
    expect(special).toEqual(['layout.tsx']);
  });

  it('recognises each page extension and special file it guards against', () => {
    for (const f of ['a/page.tsx', 'a/page.jsx', 'a/page.ts', 'a/page.js'])
      expect(PAGE.test(f)).toBe(true);
    for (const f of ['a/loading.tsx', 'a/not-found.jsx', 'a/route.ts', 'a/opengraph-image.png']) {
      expect(specialName(f), f).not.toBeNull();
    }
    expect(specialName('a/Stage.tsx')).toBeNull();
  });
});

describe('v2 preview registry', () => {
  it('lists every preview page, and has a page for every entry', async () => {
    const { PREVIEWS } = await import('../../app/(v2-preview)/v2-preview/_preview/registry');
    const onDisk = walk(PREVIEW)
      .filter((f) => PAGE.test(f))
      .map((f) => '/' + relative(join(GROUP), dirname(f)))
      .filter((r) => r !== '/v2-preview')
      .sort();
    expect(PREVIEWS.map((p) => p.path).sort()).toEqual(onDisk);
  });
});

describe('v2 stays out of live pages', () => {
  // Every import specifier in the app, resolved to a file path, so the check holds for the
  // alias, relative paths and bare directory imports alike.
  const SPEC = /(?:from\s+|import\s*\(\s*|import\s+|require\(\s*)['"]([^'"]+)['"]/g;
  const isV2 = (abs: string) =>
    abs.startsWith(join(WEB_ROOT, 'components', 'v2')) ||
    abs.startsWith(join(WEB_ROOT, 'styles', 'v2'));
  /** An import specifier as a file path; bare package names resolve to '' and never match. */
  const resolveSpec = (from: string, spec: string) =>
    spec.startsWith('@/')
      ? join(WEB_ROOT, spec.slice(2))
      : spec.startsWith('.')
        ? resolve(dirname(from), spec)
        : '';
  const allowed = (file: string) =>
    file.startsWith(GROUP + '/') ||
    file.startsWith(join(WEB_ROOT, 'components', 'v2') + '/') ||
    file.startsWith(join(WEB_ROOT, '__tests__', 'v2') + '/');

  const sources = walk(WEB_ROOT).filter(
    (f) => /\.(tsx?|jsx?|mjs|css)$/.test(f) && !f.includes('/tests/e2e/'),
  );

  it('scans the app source', () => {
    expect(sources.length).toBeGreaterThan(200);
  });

  it('resolves each spelling of a v2 import (alias, relative, directory)', () => {
    const from = join(WEB_ROOT, 'app', 'page.tsx');
    expect(isV2(resolveSpec(from, '@/components/v2'))).toBe(true);
    expect(isV2(resolveSpec(from, '../components/v2/Button'))).toBe(true);
    expect(isV2(resolveSpec(from, '@/styles/v2/tokens.css'))).toBe(true);
    expect(isV2(resolveSpec(from, '@/components/ui/Button'))).toBe(false);
    expect(isV2(resolveSpec(from, 'components/v2'))).toBe(false);
  });

  it('no module outside the preview group imports the v2 components or tokens', () => {
    const offenders: string[] = [];
    for (const file of sources) {
      if (allowed(file)) continue;
      const src = readFileSync(file, 'utf8');
      for (const m of src.matchAll(SPEC)) {
        const spec = m[1] ?? '';
        const abs = resolveSpec(file, spec);
        if (abs && isV2(abs)) offenders.push(`${relative(WEB_ROOT, file)} -> ${spec}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
