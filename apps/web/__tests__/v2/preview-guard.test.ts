import { describe, it, expect, vi, afterEach } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import type { Metadata } from 'next';
import { WEB_ROOT } from './_lib/tokens-css';
import { V2_REWRITES } from '../../lib/v2/rewrites';
import { isFlagGated } from '../v1-inventory-source';

const GROUP = join(WEB_ROOT, 'app', '(v2-preview)');
/**
 * The account door's pages (CC-25), the first live pages on the v2 design system: their group's
 * layout loads the tokens and sets noindex. No other live route may import v2.
 */
const ACCOUNT_GROUP = join(WEB_ROOT, 'app', '(account)');
const PREVIEW = join(GROUP, 'v2-preview');
/**
 * The public check flow's live pages (CC-22b), each a 404 while V2_CHECKS_PUBLIC is off: a v2
 * check's pages, which sit under v1's audit route with no layout of their own, and the page `/` is
 * rewritten to. `__tests__/v1-inventory.test.ts` holds the list of flag-gated page files.
 */
const V2_LIVE = [join(WEB_ROOT, 'app', 'audit', '[id]'), join(WEB_ROOT, 'app', 'v2-home')];

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
 * What may sit in the group: the root layout, page files, and anything in a folder whose name
 * starts with "_" (a private folder, which Next does not route). Everything else Next could serve
 * without a page's own guard: a loading or not-found UI, a route handler, a metadata route
 * (including numbered ones such as opengraph-image2.tsx or icon1.png). An allowlist, so no list of
 * Next's special names has to be kept current.
 */
const ALLOWED = (rel: string) =>
  rel === 'layout.tsx' || PAGE.test(`/${rel}`) || rel.split('/').some((seg) => seg.startsWith('_'));

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
    // Importing every page transforms each one's module tree, so the time grows with the pages. On
    // 2026-11-06 it took 4.0 s on main and 5.0 s with the CC-26 account previews, past vitest's 5 s.
  }, 15_000);

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

  it('holds nothing Next could serve but the root layout and the guarded pages', () => {
    const other = walk(GROUP)
      .map((f) => relative(GROUP, f))
      .filter((rel) => !ALLOWED(rel));
    expect(other).toEqual([]);
  });

  it('allows exactly the layout, pages and private folders', () => {
    for (const rel of [
      'layout.tsx',
      'v2-preview/page.tsx',
      'v2-preview/x/page.jsx',
      'v2-preview/_preview/guard.ts',
    ]) {
      expect(ALLOWED(rel), rel).toBe(true);
    }
    for (const rel of [
      'v2-preview/opengraph-image2.tsx',
      'v2-preview/icon1.png',
      'v2-preview/loading.tsx',
      'v2-preview/x/route.ts',
      'v2-preview/sitemap.ts',
      'v2-preview/x/layout.tsx',
      'template.tsx',
    ]) {
      expect(ALLOWED(rel), rel).toBe(false);
    }
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
  /**
   * The signed-in v2 pages outside the groups (CC-26b): the targets of `V2_REWRITES`, which the
   * middleware alone serves, and the site page; and CC-31's Seats page and the page an invitation's
   * link lands on. Each page in them is a 404 with V2_CHECKS_PUBLIC off, checked below with the v1
   * inventory's own reader of that shape.
   */
  const V2_PAGE_DIRS = [
    ...V2_REWRITES.map((r) => join(WEB_ROOT, 'app', ...r.to.split('/').filter(Boolean))),
    join(WEB_ROOT, 'app', 'sites'),
    join(WEB_ROOT, 'app', 'seats'),
    join(WEB_ROOT, 'app', 'invite'),
    // CC-31: the agency's client matrix and client page.
    join(WEB_ROOT, 'app', 'agency'),
    // CC-28: the Alerts page and the changes log.
    join(WEB_ROOT, 'app', 'alerts'),
    join(WEB_ROOT, 'app', 'changes'),
  ];
  const inV2PageDir = (file: string) => V2_PAGE_DIRS.some((d) => file.startsWith(d + '/'));
  const allowed = (file: string) =>
    file.startsWith(GROUP + '/') ||
    file.startsWith(ACCOUNT_GROUP + '/') ||
    V2_LIVE.some((dir) => file.startsWith(dir + '/')) ||
    inV2PageDir(file) ||
    file.startsWith(join(WEB_ROOT, 'components', 'v2') + '/') ||
    file.startsWith(join(WEB_ROOT, '__tests__', 'v2') + '/') ||
    // CC-31: a report's document prints a verdict's word as the screens do. It imports
    // components/v2/verdicts.ts, which is data: a type import and no style.
    file === join(WEB_ROOT, 'lib', 'v2', 'reports', 'generate-doc.ts') ||
    // A test beside the code it tests; the next case holds that no other module imports one.
    /\.test\.tsx?$/.test(file);

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

  it('each page in the signed-in v2 page folders is a 404 with its flag off', () => {
    const pages = sources.filter((f) => inV2PageDir(f) && PAGE.test(f));
    expect(pages.map((f) => relative(WEB_ROOT, f)).sort()).toEqual([
      'app/agency/clients/[siteId]/page.tsx',
      'app/agency/page.tsx',
      'app/alerts/page.tsx',
      'app/changes/page.tsx',
      'app/dashboard/v2/page.tsx',
      'app/invite/page.tsx',
      'app/seats/page.tsx',
      'app/sites/[id]/page.tsx',
      'app/v2-home/page.tsx',
    ]);
    for (const page of pages) expect(isFlagGated(page), relative(WEB_ROOT, page)).toBe(true);
  });

  it('no module outside the preview group, the account group, the public check pages and the signed-in v2 pages imports the v2 components or tokens', () => {
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

  it('no module that is not a test imports a test file, which the rule above lets import v2', () => {
    // An import can name a test file with no extension, with its own, or with `.js` (which
    // next.config.mjs resolves to the `.ts` or `.tsx` file).
    const isTest = (file: string) => /\.test(\.[cm]?[jt]sx?)?$/.test(file);
    for (const spec of ['./x.test', './x.test.ts', './x.test.tsx', '@/lib/x.test', './x.test.js'])
      expect(isTest(spec), spec).toBe(true);
    for (const spec of ['./x', './testing', './x.tests', './x.test.css', '@/lib/test'])
      expect(isTest(spec), spec).toBe(false);
    const offenders: string[] = [];
    for (const file of sources.filter((f) => !isTest(f))) {
      for (const m of readFileSync(file, 'utf8').matchAll(SPEC)) {
        const spec = m[1] ?? '';
        if (isTest(spec)) offenders.push(`${relative(WEB_ROOT, file)} -> ${spec}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('the account group holds exactly the account-door files, the account’s link pages, and the Settings and Trial ending pages', () => {
    const inGroup = sources.filter((f) => f.startsWith(ACCOUNT_GROUP + '/'));
    expect(inGroup.map((f) => relative(WEB_ROOT, f)).sort()).toEqual([
      'app/(account)/account/delete/[token]/route.ts',
      'app/(account)/account/delete/page.tsx',
      'app/(account)/account/email-undo/[token]/route.ts',
      'app/(account)/account/email-undo/page.tsx',
      'app/(account)/account/email/[token]/route.ts',
      'app/(account)/account/email/page.test.tsx',
      'app/(account)/account/email/page.tsx',
      'app/(account)/account/restore/[token]/route.ts',
      'app/(account)/account/restore/page.tsx',
      'app/(account)/check-email/page.tsx',
      'app/(account)/layout.tsx',
      'app/(account)/login/verify/continue/page.tsx',
      'app/(account)/settings/delete/page.tsx',
      'app/(account)/settings/page.tsx',
      'app/(account)/settings/pages.test.tsx',
      'app/(account)/settings/plan/page.tsx',
      'app/(account)/signup/page.tsx',
      'app/(account)/trial-ended/page.tsx',
    ]);
  });
});
