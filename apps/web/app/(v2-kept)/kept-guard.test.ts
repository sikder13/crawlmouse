/**
 * CC-36 D3, by scan rather than by a list:
 * - every v1 page still served once V2_CHECKS_PUBLIC is on (not answered by a `V1_CUTOVER` row)
 *   whose imports reach v1's header or footer has a `V2_REWRITES` row, and that row's target is a
 *   page on disk, so no such page is drawn with v1's chrome under the flag;
 * - no kept page's target reaches a module that calls a v1 route the cutover answers with 410
 *   (lib/v2/cutover.ts), so no control on it is a dead end.
 *
 * - no v1 page imports the kept group: its shell brings v2's stylesheets, which a v1 page must not
 *   link (CC-22b measured a flag branch doing so).
 *
 * The import graph is read from source: every `from '…'`, `import '…'` and `import('…')` naming a
 * file in apps/web, through the `@/` alias or a relative path. Type-only imports are followed too,
 * which can only add files to a graph.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { cutoverOf } from '../../lib/v2/cutover';
import { rewriteOf, V2_REWRITES } from '../../lib/v2/rewrites';
import { isFlagGated, pageUrl, v1Pages } from '../../__tests__/v1-inventory-source';

const WEB = resolve(__dirname, '../..');
const APP = join(WEB, 'app');
const SPEC = /(?:from\s+|import\s*\(\s*|import\s+)['"]([^'"]+)['"]/g;
const EXTENSIONS = ['', '.ts', '.tsx', '.js', '.jsx', '/index.ts', '/index.tsx'];

/** An import specifier as a file in apps/web, or null for a package. */
function resolveSpec(from: string, spec: string): string | null {
  const base = spec.startsWith('@/')
    ? join(WEB, spec.slice(2))
    : spec.startsWith('.')
      ? resolve(dirname(from), spec)
      : null;
  if (base === null) return null;
  for (const ext of EXTENSIONS) {
    const file = base + ext;
    if (existsSync(file) && statSync(file).isFile()) return file;
  }
  return null;
}

/** Every apps/web file `entry` reaches through its imports, itself included. */
function graph(entry: string): Set<string> {
  const seen = new Set<string>();
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    if (!/\.(tsx?|jsx?)$/.test(file)) continue;
    for (const m of readFileSync(file, 'utf8').matchAll(SPEC)) {
      const next = resolveSpec(file, m[1]!);
      if (next !== null) queue.push(next);
    }
  }
  return seen;
}

const rel = (file: string) => relative(WEB, file);
const V1_CHROME = ['components/layout/Header.tsx', 'components/layout/Footer.tsx'];

/** A URL pattern of a page (`/blog/[slug]`) with each dynamic segment given a value. */
const example = (url: string) => url.replace(/\[[^\]]+\]/g, 'x1');

/** Every page file under app/, with the URL pattern it serves (`[x]` segments as `:x`). */
function pagesOnDisk(): { file: string; url: string }[] {
  const out: { file: string; url: string }[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!entry.name.startsWith('_')) walk(p);
      } else if (/^page\.tsx?$/.test(entry.name)) {
        out.push({ file: p, url: pageUrl(rel(p)).replace(/\[([^\]]+)\]/g, ':$1') });
      }
    }
  };
  walk(APP);
  return out;
}

const SERVED_V1_PAGES = v1Pages()
  .filter((page) => !isFlagGated(join(WEB, page)))
  .filter((page) => cutoverOf(example(pageUrl(page))) === null);

describe('every served v1 page that draws v1’s chrome has a rewrite to a v2-shell target', () => {
  const drawsChrome = SERVED_V1_PAGES.filter((page) =>
    [...graph(join(WEB, page))].some((f) => V1_CHROME.includes(rel(f))),
  );

  it('finds the pages the scan is meant to find', () => {
    // A floor, not the list: the scan is the list. These are pages that drew v1's chrome at CC-36.
    for (const page of [
      'app/blog/page.tsx',
      'app/login/page.tsx',
      'app/privacy/page.tsx',
      'app/blog/[slug]/page.tsx',
      'app/r/[slug]/page.tsx',
      'app/audit/[id]/page.tsx',
    ])
      expect(drawsChrome).toContain(page);
    // Retired by a V1_CUTOVER row, so not served under the flag.
    expect(SERVED_V1_PAGES).not.toContain('app/top/[platform]/page.tsx');
    expect(SERVED_V1_PAGES).not.toContain('app/compare/page.tsx');
  });

  it.each(drawsChrome)('%s has a rewrite row, and its target is a page', (page) => {
    const row = rewriteOf(example(pageUrl(page)));
    expect(row, page).not.toBeNull();
    const target = V2_REWRITES.find((r) => r.from === row!.from)!.to;
    expect(pagesOnDisk().map((p) => p.url)).toContain(target);
  });
});

describe('no kept target reaches a module that calls a route the cutover retires', () => {
  /** Modules whose request goes to a `V1_CUTOVER` route (`/api/audits/start`, `…/notify`, `…/reaudit`). */
  const CALLS_RETIRED = [
    'lib/submit-audit.ts',
    'lib/notify-submit.ts',
    'components/dashboard/ReauditButton.tsx',
    'components/share/CompareForm.tsx',
  ];
  /**
   * The v1 audit page's "email me when it is done" (components/audit/EmailWhenDone.tsx) is drawn
   * only while a v1 audit is running, and no v1 audit starts once `/api/audits/start` answers 410.
   */
  const ALLOWED: Record<string, string[]> = {
    'app/(v2-kept)/v2-kept/audit/[id]/page.tsx': ['lib/notify-submit.ts'],
  };
  const targets = pagesOnDisk()
    .filter((p) => V2_REWRITES.some((r) => r.to === p.url && r.flag === 'checksPublic'))
    .map((p) => rel(p.file))
    .filter((f) => f.startsWith('app/(v2-kept)/') || f === 'app/v2-report/[slug]/page.tsx');

  it('has a target for each kept row, and the report’s', () => {
    expect(targets.length).toBe(V2_REWRITES.filter((r) => r.to.startsWith('/v2-kept/')).length + 1);
  });

  it('the graph reaches what it should: v1’s checker page reaches the start call', () => {
    const reached = [...graph(join(WEB, 'app/ai-readiness-checker/page.tsx'))].map(rel);
    expect(reached).toContain('lib/submit-audit.ts');
  });

  it.each(targets)('%s', (target) => {
    const reached = [...graph(join(WEB, target))].map(rel);
    const bad = CALLS_RETIRED.filter((f) => reached.includes(f));
    expect(bad).toEqual(ALLOWED[target] ?? []);
  });
});

describe('nothing outside the v2 pages imports the kept group', () => {
  const KEPT = join(APP, '(v2-kept)');
  /** Who may: the group itself, the report's target, the dev-only previews, and tests. */
  const mayImport = (file: string) =>
    file.startsWith(KEPT + '/') ||
    rel(file) === 'app/v2-report/[slug]/page.tsx' ||
    file.startsWith(join(APP, '(v2-preview)') + '/') ||
    /\.test\.tsx?$/.test(file);
  const sources: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === '.next') continue;
      const p = join(dir, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (/\.(tsx?|jsx?|mjs)$/.test(entry.name)) sources.push(p);
    }
  };
  walk(WEB);

  it('finds the report target’s import of the shell, so the scan reads imports', () => {
    const report = join(APP, 'v2-report/[slug]/page.tsx');
    const specs = [...readFileSync(report, 'utf8').matchAll(SPEC)].map((m) =>
      resolveSpec(report, m[1]!),
    );
    expect(specs).toContain(join(KEPT, '_lib/KeptShell.tsx'));
  });

  it('no other module imports it', () => {
    const offenders = sources
      .filter((file) => !mayImport(file))
      .flatMap((file) =>
        [...readFileSync(file, 'utf8').matchAll(SPEC)]
          .map((m) => resolveSpec(file, m[1]!))
          .filter((to): to is string => to !== null && to.startsWith(KEPT + '/'))
          .map((to) => `${rel(file)} -> ${rel(to)}`),
      );
    expect(offenders).toEqual([]);
  });
});
