/**
 * The routes under `/audit/[id]` (CC-22b D1, D4, plan-review 2 and 14): what each answers with
 * V2_CHECKS_PUBLIC off and on, the metadata each sets, and what the v1 page may import.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { CheckRead } from '../../../lib/v2/pipeline/public';

vi.mock('server-only', () => ({}));

const readAudit = vi.fn<(id: string) => Promise<CheckRead | null>>();
vi.mock('./_lib/access', () => ({ readAudit: (id: string) => readAudit(id) }));

const v1Audit = vi.fn<() => { id: string; url: string } | null>(() => null);
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: v1Audit() }) }) }),
    }),
  }),
}));

const HERE = __dirname;
const ID = 'b0000000-0000-4000-8000-0000000000c1';
const FIX = 'f0000000-0000-4000-8000-000000000001';

function pages(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return pages(path);
    return name === 'page.tsx' ? [relative(HERE, path)] : [];
  });
}
const ALL = pages(HERE).sort();
const SUB = ALL.filter((p) => p !== 'page.tsx');
/** The sub-pages that show a graded check only. */
const GRADED = SUB.filter((p) => p !== 'overview/page.tsx');
const params = (file: string) =>
  Promise.resolve(file.startsWith('fix/') ? { id: ID, fixId: FIX } : { id: ID });
/** The path a route file serves for `ID`. */
const pathOf = (file: string) =>
  `/audit/${ID}${file === 'page.tsx' ? '' : `/${file.replace(/\/page\.tsx$/, '').replace('[fixId]', FIX)}`}`;

const flag = (on: boolean) => vi.stubEnv('V2_CHECKS_PUBLIC', on ? '1' : '');
/** What a thrown `notFound()` or `redirect()` carries. */
const digestOf = async (run: () => Promise<unknown>): Promise<string> => {
  try {
    await run();
  } catch (error) {
    return String((error as { digest?: string }).digest);
  }
  return 'returned';
};
const waiting: CheckRead = {
  state: 'waiting',
  checkId: ID,
  host: 'example.com',
  status: 'queued',
  queuedAt: '2026-11-06T10:00:00Z',
  startedAt: null,
  progress: null,
  kept: false,
};

// The first import of a route loads the screens behind it, which takes longer than one test's time.
beforeAll(async () => {
  await import('./access/page');
  await import('./overview/page');
  await import('./page');
}, 120_000);

afterEach(() => {
  vi.unstubAllEnvs();
  readAudit.mockReset();
  v1Audit.mockReset();
  v1Audit.mockReturnValue(null);
});

describe('the route files', () => {
  it('are the v1 page, the v2 overview, six segments, the fix page and the map', () => {
    expect(ALL).toEqual([
      'access/page.tsx',
      'changes/page.tsx',
      'content/page.tsx',
      'fix/[fixId]/page.tsx',
      'map/page.tsx',
      'nojs/page.tsx',
      'overview/page.tsx',
      'page.tsx',
      'signals/page.tsx',
      'structure/page.tsx',
    ]);
  });

  it('have no layout, which would wrap the v1 page too', () => {
    expect(readdirSync(HERE)).not.toContain('layout.tsx');
  });

  it.each(ALL)('%s is not indexed, and its canonical is its own path', async (file) => {
    const route = (await import(`./${file}`)) as {
      generateMetadata(p: { params: ReturnType<typeof params> }): Promise<unknown>;
    };
    expect(await route.generateMetadata({ params: params(file) })).toEqual({
      robots: { index: false, follow: true },
      alternates: { canonical: pathOf(file) },
    });
  });
});

describe('with V2_CHECKS_PUBLIC off', () => {
  it.each(SUB)('%s is a 404 before any check is read', async (file) => {
    flag(false);
    const route = (await import(`./${file}`)) as { default(p: object): Promise<unknown> };
    const digest = await digestOf(() =>
      route.default({ params: params(file), searchParams: Promise.resolve({}) }),
    );
    expect(digest).toContain('404');
    expect(readAudit).not.toHaveBeenCalled();
  });

  it('the overview reads no v2 check and serves the v1 audit', async () => {
    flag(false);
    v1Audit.mockReturnValue({ id: ID, url: 'https://example.com' });
    const route = await import('./page');
    const node = (await route.default({
      params: params('page.tsx'),
      searchParams: Promise.resolve({}),
    })) as ReactElement;
    expect(readAudit).not.toHaveBeenCalled();
    expect(v1Audit).toHaveBeenCalledTimes(1);
    // The v1 page's own markup (a fragment), not a v2 component.
    expect(typeof node.type).not.toBe('function');
  });

  it('the 404 page is the site’s own', async () => {
    flag(false);
    const { default: AuditNotFound } = await import('./not-found');
    const { default: RootNotFound } = await import('../../not-found');
    expect(renderToStaticMarkup(<AuditNotFound />)).toBe(renderToStaticMarkup(<RootNotFound />));
  });
});

describe('with V2_CHECKS_PUBLIC on', () => {
  it('/audit/[id] sends a v2 check the viewer may read to its overview, without a v1 lookup', async () => {
    flag(true);
    readAudit.mockResolvedValue(waiting);
    const route = await import('./page');
    const digest = await digestOf(() =>
      route.default({ params: params('page.tsx'), searchParams: Promise.resolve({}) }),
    );
    expect(digest).toContain('NEXT_REDIRECT');
    expect(digest).toContain(`/audit/${ID}/overview;`);
    expect(v1Audit).not.toHaveBeenCalled();
  });

  it('the overview shows the check in whatever state it is, and is a 404 for an id that reads none', async () => {
    flag(true);
    readAudit.mockResolvedValue(waiting);
    const route = await import('./overview/page');
    const node = (await route.default({ params: params('overview/page.tsx') })) as ReactElement<{
      read: CheckRead;
    }>;
    expect(node.type).toBe((await import('./_lib/CheckPage')).CheckPage);
    expect(node.props.read).toBe(waiting);
    readAudit.mockResolvedValue(null);
    expect(await digestOf(() => route.default({ params: params('overview/page.tsx') }))).toContain(
      '404',
    );
  });

  it('an id that reads no v2 check is looked up as a v1 audit, and is a 404 when it is neither', async () => {
    flag(true);
    readAudit.mockResolvedValue(null);
    const route = await import('./page');
    const run = () =>
      route.default({ params: params('page.tsx'), searchParams: Promise.resolve({}) });
    expect(await digestOf(run)).toContain('404');
    expect(v1Audit).toHaveBeenCalledTimes(1);
    v1Audit.mockReturnValue({ id: ID, url: 'https://example.com' });
    expect(await digestOf(run)).toBe('returned');
  });

  it.each(GRADED)('%s is a 404 for an id that reads no check', async (file) => {
    flag(true);
    readAudit.mockResolvedValue(null);
    const route = (await import(`./${file}`)) as { default(p: object): Promise<ReactElement> };
    const digest = await digestOf(async () => {
      const node = await route.default({ params: params(file), searchParams: Promise.resolve({}) });
      // The route returns its page component; rendering it is what reads the check.
      await (node.type as (p: object) => Promise<unknown>)(node.props as object);
    });
    expect(digest).toContain('404');
    expect(readAudit).toHaveBeenCalledWith(ID);
  });

  it.each(GRADED)(
    '%s sends a check that is not graded to the overview, which shows its state',
    async (file) => {
      flag(true);
      readAudit.mockResolvedValue(waiting);
      const route = (await import(`./${file}`)) as { default(p: object): Promise<ReactElement> };
      const digest = await digestOf(async () => {
        const node = await route.default({
          params: params(file),
          searchParams: Promise.resolve({}),
        });
        await (node.type as (p: object) => Promise<unknown>)(node.props as object);
      });
      expect(digest).toContain('NEXT_REDIRECT');
      expect(digest).toContain(`/audit/${ID}/overview;`);
    },
  );

  it('the 404 page says the audit does not exist or has expired', async () => {
    flag(true);
    const { default: AuditNotFound } = await import('./not-found');
    const markup = renderToStaticMarkup(<AuditNotFound />);
    expect(markup).toContain('This audit does not exist, or it has expired.');
    expect(markup).toContain('24 hours');
    expect(markup).toContain('href="/"');
  });
});

describe('what the v1 page and its 404 import', () => {
  /** The module specifiers a file imports statically (`import … from`), not through `import()`. */
  const staticImports = (file: string) =>
    [...readFileSync(join(HERE, file), 'utf8').matchAll(/^import\s[^;]*?from\s+'([^']+)';/gms)].map(
      (m) => m[1]!,
    );
  const V2 = /_lib\/|_crawl\/|components\/v2|styles\/v2|lib\/v2/;

  /** A v2 module that holds no screen, and so no stylesheet: the reader of a check. */
  const NO_SCREEN = ['./_lib/access'];
  /** Each module a file reaches: `import … from`, and `import()`. */
  const reached = (file: string) => [
    ...staticImports(file),
    ...[...readFileSync(join(HERE, file), 'utf8').matchAll(/import\(\s*'([^']+)'/g)].map(
      (m) => m[1]!,
    ),
  ];

  it.each(['page.tsx', 'not-found.tsx'])(
    '%s reaches no v2 screen, by import or by import(), so the v1 page links no v2 stylesheet',
    (file) => {
      const modules = reached(file);
      expect(modules.length).toBeGreaterThan(3);
      expect(modules.filter((m) => V2.test(m) && !NO_SCREEN.includes(m))).toEqual([]);
    },
  );

  it('the reader of a check, which the v1 page loads under the flag, imports no screen and no stylesheet', () => {
    const imports = staticImports('_lib/access.ts');
    expect(imports.length).toBeGreaterThan(2);
    expect(imports.filter((m) => /components\/|\.css$|\.tsx$|CheckPage|ReadyPage/.test(m))).toEqual(
      [],
    );
  });

  it('the scan sees a static v2 import where there is one', () => {
    expect(staticImports('access/page.tsx').filter((m) => V2.test(m))).not.toEqual([]);
  });
});
