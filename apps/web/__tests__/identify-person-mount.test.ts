/**
 * Every signed-in page identifies its browser (CC-41 D1): each page under `app/` whose imports reach
 * a module that calls `loadViewer(` or `readViewer(` (the viewer read, lib/v2/account/viewer.ts) has
 * a `layout.tsx` on its path that renders `<IdentifyPersonMount`. The root layout never does: it
 * would make every public page dynamic (CC-41 rulings Q7).
 *
 * How "reach" is read: import and export specifiers (`@/…` and relative) are followed through the
 * files they resolve to under apps/web; packages are not followed. A whole-statement type import
 * (`import type … from`, `export type … from`) is not followed: TypeScript erases it, so it puts no
 * code on the page. Comments are stripped before a call is looked for.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const WEB = resolve(__dirname, '..');
const APP = join(WEB, 'app');

/** Pages that read the viewer and are public, so no signed-in layout is theirs. */
const PUBLIC_VIEWER_PAGES: Record<string, string> = {
  'app/v2-pricing/page.tsx':
    'Pricing is a public page; it reads the viewer only to label its buttons (rulings Q7).',
};

const strip = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

function resolveImport(from: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith('@/')) base = join(WEB, spec.slice(2));
  else if (spec.startsWith('.')) base = resolve(dirname(from), spec);
  else return null;
  for (const candidate of [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}/index.ts`,
    `${base}/index.tsx`,
  ]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

const IMPORT =
  /(?:import|export)\s[^'";]*?from\s+['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g;
const VIEWER_CALL = /\b(?:loadViewer|readViewer)\(/;
/** A statement that imports or re-exports types only, which compiles to nothing. */
const TYPE_ONLY = /^(?:import|export)\s+type\s/;

function reachesViewer(page: string): boolean {
  const seen = new Set<string>();
  const stack = [page];
  while (stack.length > 0) {
    const file = stack.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    const src = readFileSync(file, 'utf8');
    if (VIEWER_CALL.test(strip(src))) return true;
    for (const m of src.matchAll(IMPORT)) {
      if (TYPE_ONLY.test(m[0])) continue;
      const next = resolveImport(file, m[1] ?? m[2]!);
      if (next !== null) stack.push(next);
    }
  }
  return false;
}

const mounts = (layout: string) =>
  /<IdentifyPersonMount\b/.test(strip(readFileSync(layout, 'utf8')));

/** The layouts from the page's own directory up to, not including, the root layout. */
function layoutChain(page: string): string[] {
  const out: string[] = [];
  for (let dir = dirname(page); dir !== APP; dir = dirname(dir)) {
    const layout = join(dir, 'layout.tsx');
    if (existsSync(layout)) out.push(layout);
  }
  return out;
}

const viewerPages = walk(APP)
  .filter((p) => /\/page\.tsx?$/.test(p))
  .filter(reachesViewer)
  .map((p) => relative(WEB, p))
  .sort();

describe('the signed-in layouts identify the browser', () => {
  it('finds the pages that read the viewer (the scan is live)', () => {
    expect(viewerPages).toContain('app/dashboard/v2/page.tsx');
    expect(viewerPages).toContain('app/(account)/settings/page.tsx');
    expect(viewerPages).toContain('app/sites/[id]/page.tsx');
    expect(viewerPages.length).toBeGreaterThanOrEqual(10);
  });

  it.each(viewerPages.filter((p) => !(p in PUBLIC_VIEWER_PAGES)))(
    '%s has a layout that mounts IdentifyPersonMount',
    (page) => {
      const chain = layoutChain(join(WEB, page));
      expect(chain.filter(mounts).map((l) => relative(WEB, l))).not.toEqual([]);
    },
  );

  it('does not follow a type-only import, which puts no code on the page', () => {
    // The vector: the public pages' header link imports lib/v2/session-header.ts, which imports
    // only a type from the viewer read. Followed, it would ask the prerendered home and help pages
    // for a signed-in layout.
    const header = readFileSync(join(WEB, 'lib/v2/session-header.ts'), 'utf8');
    expect(header).toMatch(/^import type \{ ViewerResult \} from '\.\/account\/viewer-read';$/m);
    expect(readFileSync(join(WEB, 'lib/v2/account/viewer-read.ts'), 'utf8')).toMatch(VIEWER_CALL);
    expect(readFileSync(join(WEB, 'components/v2/AccountLink.tsx'), 'utf8')).toContain(
      "from '../../lib/v2/session-header'",
    );
    expect(viewerPages).not.toContain('app/v2-home/page.tsx');
    expect(viewerPages).not.toContain('app/help/page.tsx');
  });

  it('each public exemption still reads the viewer, so none is stale', () => {
    for (const page of Object.keys(PUBLIC_VIEWER_PAGES)) expect(viewerPages).toContain(page);
  });

  it('the root layout does not mount it', () => {
    expect(mounts(join(APP, 'layout.tsx'))).toBe(false);
  });
});

describe('a signed-in layout refuses under the same flag as every page beneath it', () => {
  // RC-01: the Agency trial alone refuses with a redirect to For agencies. A layout and its pages
  // must agree on both the flag and the refusal.
  const GATE = /if \(!(\w+Enabled)\(\)\) (return notFound\(\)|redirect\('\/agencies'\));/;
  const REDIRECTS = new Set(['agency-trial']);
  /** The gate in the default export's own code: a comment or a helper above it does not count. */
  const gateOf = (file: string) => {
    const source = readFileSync(join(APP, file), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    return source.slice(source.indexOf('export default')).match(GATE);
  };
  const APP = join(__dirname, '../app');
  const layouts = [
    'agency',
    'agency-trial',
    'alerts',
    'changes',
    'dashboard/v2',
    'reports',
    'seats',
    'sites',
  ];
  const pagesUnder = (dir: string): string[] =>
    readdirSync(join(APP, dir), { recursive: true, encoding: 'utf8' })
      .filter((f) => f === 'page.tsx' || f.endsWith('/page.tsx'))
      .map((f) => join(dir, f));

  it.each(layouts)('%s', (dir) => {
    const gate = gateOf(join(dir, 'layout.tsx'));
    expect(gate?.[1], `${dir}/layout.tsx refuses on no flag`).toBeDefined();
    const [, own, refusal] = gate!;
    expect(refusal!.startsWith('redirect'), `${dir}/layout.tsx refusal`).toBe(REDIRECTS.has(dir));
    const pages = pagesUnder(dir);
    expect(pages.length).toBeGreaterThan(0);
    for (const page of pages) {
      // Without the same gate, the layout would 404 a page that serves with its own flag on.
      const pageGate = gateOf(page);
      expect(pageGate?.[1], page).toBe(own);
      expect(pageGate?.[2], page).toBe(refusal);
    }
  });
});
