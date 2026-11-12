/**
 * docs/ops/v1-inventory.json lists every v1 page, metadata file, route handler, Inngest function,
 * cron and table once, with a ruling (CC-V1AUDIT, docs/specs/v2/v1-audit.md). This file holds it to
 * disk in both directions: an item on disk with no entry fails, and a live entry naming nothing
 * fails. What is v2, and so not listed, is the rule in v1-inventory-source.ts.
 *
 *   pnpm --filter @crawlmouse/web exec vitest run __tests__/v1-inventory.test.ts
 *
 * What it cannot see: a `delete` entry names a file this step removed, so the test can check the
 * file is gone but not that it existed (CI's test job checks out one commit); the lead's verification
 * table shows each deleted path at the base commit. Middleware and `next.config` redirects are not
 * items here.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  REPO_ROOT,
  fileUrl,
  isFlagGated,
  deleteProblems,
  pageUrl,
  redirectProblems,
  refProblems,
  urlMatches,
  v1InngestFunctions,
  v1MetadataFiles,
  v1Pages,
  v1Routes,
  v1Tables,
} from './v1-inventory-source';
import {
  BLOCKS,
  CHECK_KEYS,
  type Finding,
  readBlock,
  renderCounts,
  renderCutover,
  verdictOf,
  writeBlocks,
} from './v1-inventory-report';

// The serve route's list reaches CC-03's billing functions, which import 'server-only'; vitest has
// no such module, so it is mocked, as lib/billing/inngest-functions.test.ts does.
vi.mock('server-only', () => ({}));

vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({}) }));
vi.mock('@/lib/sitemap-reports', () => ({
  fetchIndexableReportSlugs: () =>
    Promise.resolve([{ slug: 'probe-slug', lastModified: '2026-01-01T00:00:00Z' }]),
}));

type Kind = 'page' | 'metadata' | 'route' | 'inngest' | 'cron' | 'table';
type Entry = {
  kind: Kind;
  path: string;
  url?: string;
  id?: string;
  schedule?: string;
  ruling: 'retire' | 'keep' | 'delete';
  reason: string;
  evidence: string;
  replacedBy?: string;
  redirect?: string;
  checks?: Record<string, string>;
  e2e?: Record<string, unknown>;
};

const WEB = join(REPO_ROOT, 'apps/web');
const INVENTORY = join(REPO_ROOT, 'docs/ops/v1-inventory.json');
const inventory = JSON.parse(readFileSync(INVENTORY, 'utf8')) as {
  items: Entry[];
  findings: Finding[];
};
const items = inventory.items;
const live = items.filter((e) => e.ruling !== 'delete');
const pathsOf = (kind: Kind) =>
  live
    .filter((e) => e.kind === kind)
    .map((e) => e.path)
    .sort();
const APP_KINDS: readonly Kind[] = ['page', 'metadata', 'route'];

function writeFixture(root: string, files: Record<string, string> | string[]) {
  const entries = Array.isArray(files) ? files.map((f) => [f, ''] as const) : Object.entries(files);
  for (const [f, text] of entries) {
    mkdirSync(dirname(join(root, f)), { recursive: true });
    writeFileSync(join(root, f), text);
  }
}

function withDir(run: (dir: string) => void) {
  const dir = mkdtempSync(join(tmpdir(), 'v1inv-'));
  try {
    run(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('the finders see what they claim to see', () => {
  it('pages, metadata files and routes, with v2 groups at any depth and _folders left out', () =>
    withDir((dir) => {
      writeFixture(dir, [
        'page.tsx',
        'probe/page.tsx',
        'probe/[id]/route.ts',
        'probe/opengraph-image.tsx',
        'probe/icon.png',
        'favicon.ico',
        'probe/Helper.tsx',
        '(v2-preview)/v2-preview/x/page.tsx',
        '(account)/signup/page.tsx',
        '(marketing)/(account)/nested/page.tsx',
        '_private/page.tsx',
        '(marketing)/about/page.tsx',
      ]);
      expect(v1Pages(dir)).toEqual([
        'app/(marketing)/about/page.tsx',
        'app/page.tsx',
        'app/probe/page.tsx',
      ]);
      expect(v1Routes(dir)).toEqual(['app/probe/[id]/route.ts']);
      expect(v1MetadataFiles(dir)).toEqual([
        'app/favicon.ico',
        'app/probe/icon.png',
        'app/probe/opengraph-image.tsx',
      ]);
    }));

  it('a file is flag-gated only when every handler is a 404 with a v2 flag off', () =>
    withDir((dir) => {
      const imp = "import { billingV2Enabled } from '@/lib/billing/flags';";
      const gate = 'if (!billingV2Enabled()) return new Response(null, { status: 404 });';
      writeFixture(dir, {
        'gated.ts': `${imp}\nexport async function POST() { ${gate} return 1; }`,
        'helper404.ts': `${imp}\nexport async function POST() { if (!billingV2Enabled()) return refuse(404, 'x'); return 1; }`,
        'fake404.ts': `${imp}\nexport async function GET() { if (!billingV2Enabled()) return Response.json({ code: 404 }); return 1; }`,
        'arg404.ts': `${imp}\nexport async function GET() { if (!billingV2Enabled()) return legacy('x', 404); return 1; }`,
        'page.tsx': `import { accountDoorEnabled as on } from '../../lib/auth/flags';\nexport default function P() { if (!on()) { return notFound(); } return 1; }`,
        'arrow.ts': `${imp}\nexport const GET = async () => { ${gate} return 1; };`,
        'fallback.ts': `${imp}\nexport async function GET() { if (!billingV2Enabled()) return legacy(); return 2; }`,
        'helperonly.ts': `${imp}\nfunction h() { ${gate} }\nexport async function GET() { h(); return 1; }`,
        'onegated.ts': `${imp}\nexport async function GET() { ${gate} return 1; }\nexport async function POST() { return 2; }`,
        'nested.ts': `${imp}\nexport async function GET() { if (x) { ${gate} } return 1; }`,
        'branch.ts': `${imp}\nexport function GET() { const v2 = billingV2Enabled(); return v2; }`,
        'typeonly.ts': `import type { billingV2Enabled } from '@/lib/billing/flags';\nexport async function POST() { ${gate} }`,
        'comment.ts': `// ${imp}\nexport async function POST() { ${gate} }`,
        'other.ts': `import { billingV2Enabled } from '@/lib/x';\nexport async function POST() { ${gate} }`,
      });
      const gated = (f: string) => isFlagGated(join(dir, f));
      const yes = ['gated.ts', 'helper404.ts', 'page.tsx', 'arrow.ts'];
      expect(yes.filter(gated)).toEqual(yes);
      const no = [
        'fallback.ts',
        'fake404.ts',
        'arg404.ts',
        'helperonly.ts',
        'onegated.ts',
        'nested.ts',
        'branch.ts',
      ];
      expect([...no, 'typeonly.ts', 'comment.ts', 'other.ts'].filter(gated)).toEqual([]);
    }));

  it('the flag rule hides exactly the v2 routes on disk today (a new one is a choice, not a slip)', () => {
    // A merge that adds a flag-gated v2 route outside the v2 groups adds it here, on purpose.
    const hidden = [...v1Pages(), ...v1MetadataFiles(), ...v1Routes()].filter((p) =>
      isFlagGated(join(WEB, p)),
    );
    expect(hidden).toEqual([
      'app/audit/[id]/access/page.tsx',
      'app/audit/[id]/changes/page.tsx',
      'app/audit/[id]/content/page.tsx',
      'app/audit/[id]/fix/[fixId]/page.tsx',
      'app/audit/[id]/map/page.tsx',
      'app/audit/[id]/nojs/page.tsx',
      'app/audit/[id]/overview/page.tsx',
      'app/audit/[id]/signals/page.tsx',
      'app/audit/[id]/structure/page.tsx',
      'app/dashboard/v2/page.tsx',
      'app/invite/page.tsx',
      'app/reports/[id]/page.tsx',
      'app/s/view/[reportId]/page.tsx',
      'app/seats/page.tsx',
      'app/sites/[id]/page.tsx',
      'app/v2-home/page.tsx',
      'app/api/account/delete/confirm/route.ts',
      'app/api/account/email/confirm/route.ts',
      'app/api/account/email/route.ts',
      'app/api/account/email/undo/route.ts',
      'app/api/account/restore/route.ts',
      'app/api/account/route.ts',
      'app/api/alert-rules/route.ts',
      'app/api/billing/agency-trial/route.ts',
      'app/api/billing/cancel/route.ts',
      'app/api/billing/pro-trial/start/route.ts',
      'app/api/billing/seats/route.ts',
      'app/api/checks/[id]/cancel/route.ts',
      'app/api/checks/[id]/claim/route.ts',
      'app/api/checks/[id]/notify/route.ts',
      'app/api/checks/[id]/stream/route.ts',
      'app/api/checks/route.ts',
      'app/api/fixes/[id]/done/route.ts',
      'app/api/fixes/[id]/email-developer/route.ts',
      'app/api/fixes/[id]/packet/route.ts',
      'app/api/me/route.ts',
      'app/api/report-files/[id]/share/route.ts',
      'app/api/seats/accept/route.ts',
      'app/api/seats/id/[id]/resend/route.ts',
      'app/api/seats/id/[id]/route.ts',
      'app/api/seats/route.ts',
      'app/api/sites/[id]/checks/route.ts',
      'app/api/sites/[id]/route.ts',
      'app/api/sites/route.ts',
      'app/api/webhooks/stripe-account/route.ts',
      'app/invite/[token]/route.ts',
      'app/s/[token]/route.ts',
    ]);
  });

  it('top-level exported Inngest functions with their cron, and not a factory-built one', () =>
    withDir((dir) => {
      writeFixture(dir, {
        'probe.ts': [
          "export const a = inngest.createFunction({ id: 'p.a' }, { cron: '1 2 * * *' }, h);",
          "export const b = inngest.createFunction({ id: 'p.b' }, { event: 'x' }, h);",
          "export const d = inngest.createFunction({ id: 'p.d' }, [{ event: 'y' }, { cron: '5 * * * *' }], h);",
          "export function c() { return inngest.createFunction({ id: 'p.c' }, { cron: '* * * * *' }, h); }",
        ].join('\n'),
        'probe.test.ts': "export const t = inngest.createFunction({ id: 't' }, {}, h);",
      });
      expect(v1InngestFunctions(dir)).toEqual([
        { path: 'inngest/probe.ts#a', id: 'p.a', cron: '1 2 * * *' },
        { path: 'inngest/probe.ts#b', id: 'p.b', cron: null },
        { path: 'inngest/probe.ts#d', id: 'p.d', cron: '5 * * * *' },
      ]);
    }));

  it.each([
    ['no receiver', "export const z = createFunction({ id: 'z' }, {}, h);"],
    ['not exported', "const z = inngest.createFunction({ id: 'z' }, {}, h);\nexport { z as y };"],
    ['a default export', "export default inngest.createFunction({ id: 'z' }, {}, h);"],
    [
      'a cron constant',
      "const C = '1 * * * *';\nexport const z = inngest.createFunction({ id: 'z' }, { cron: C }, h);",
    ],
    [
      'an id constant',
      "const I = 'z';\nexport const z = inngest.createFunction({ id: I }, {}, h);",
    ],
    ['an IIFE', "export const z = (() => inngest.createFunction({ id: 'z' }, {}, h))();"],
    ['an element access', "export const z = inngest['createFunction']({ id: 'z' }, {}, h);"],
  ])('an Inngest shape the finder cannot read throws: %s', (_name, text) =>
    withDir((dir) => {
      writeFixture(dir, { 'probe.ts': text });
      expect(() => v1InngestFunctions(dir)).toThrow();
    }),
  );

  it('tables from non-v2 migrations, with their schema, ignoring comments', () =>
    withDir((dir) => {
      writeFixture(dir, {
        '20260101000001_a.sql':
          'create table foo (id int);\n-- create table ghost (x int);\n/* create table ghost2 */',
        '20260101000002_b.sql':
          'CREATE TABLE IF NOT EXISTS public.Bar (id int);\ncreate unlogged table baz (i int);',
        '20260101000003_c.sql': 'create table research.runs (id int);',
        '20260101000004_engine_v2_e.sql': 'create table enginev2 (id int);',
        '20261101000001_v2_001_d.sql': 'create table v2thing (id int);',
      });
      expect(v1Tables(dir)).toEqual([
        'public.bar',
        'public.baz',
        'public.enginev2',
        'public.foo',
        'research.runs',
      ]);
    }));

  it('the serve route registers exactly the v1 functions the finder sees, with the pipeline off', async () => {
    // The route hands serve() the list inngestFunctions builds (CC-20b), so the list is read by
    // running that function with the flag unset, not by reading source text.
    const route = readFileSync(join(WEB, 'app/api/webhooks/inngest/route.ts'), 'utf8');
    expect(route).toMatch(/functions:\s*inngestFunctions\(process\.env\)/);
    const { inngestFunctions } = await import('../lib/v2/pipeline/functions');
    const served = inngestFunctions({});
    const found = await Promise.all(
      v1InngestFunctions().map(async (f) => {
        const [file, name] = f.path.split('#');
        const mod = (await import(join(REPO_ROOT, file!))) as Record<string, unknown>;
        expect(mod[name!], f.path).toBeDefined();
        return mod[name!];
      }),
    );
    expect(found.length).toBeGreaterThan(0);
    expect(served).toHaveLength(found.length);
    expect(new Set(served)).toEqual(new Set(found));
    // Importing the function module loads the pipeline and the engine: seconds, not milliseconds.
  }, 60_000);

  it("a file:line reference is checked against the file it names, or the entry's own", () => {
    const lines: Record<string, number> = { 'apps/web/app/x/route.ts': 40, 'inngest/a.ts': 10 };
    const count = (p: string) => lines[p] ?? 0;
    expect(
      refProblems(
        'ok (app/x/route.ts:12-40) and (:3, :7) inngest/a.ts:10',
        'app/x/route.ts',
        count,
      ),
    ).toEqual([]);
    expect(refProblems('(:41)', 'app/x/route.ts', count)).toEqual(['app/x/route.ts:41']);
    expect(refProblems('(:3-99)', 'app/x/route.ts', count)).toEqual(['app/x/route.ts:3-99']);
    expect(refProblems('see (:3)', undefined, count)).toEqual(['relative :3 with no file']);
    expect(refProblems('Foo.tsx:9', 'app/x/route.ts', count)).toEqual(['bare Foo.tsx:9']);
    expect(refProblems('inngest/a.ts:11', undefined, count)).toEqual(['inngest/a.ts:11']);
    expect(refProblems('lib/missing.ts:1', undefined, count)).toEqual(['lib/missing.ts:1']);
    expect(refProblems('at 13:25 UTC, 0 3 * * *', undefined, count)).toEqual([]);
    const local = (seg: string) => seg === 'x';
    expect(refProblems('x/route.ts:40', undefined, count, local)).toEqual([]);
    expect(refProblems('x/route.ts:41', undefined, count, local)).toEqual(['x/route.ts:41']);
    expect(refProblems('x/nope.ts:1', undefined, count, local)).toEqual(['unresolved x/nope.ts:1']);
    expect(refProblems('dep/dist/index.js:543', undefined, count, local)).toEqual([]);
    expect(refProblems('src/nope.ts:9999', undefined, count)).toEqual([
      'unresolved src/nope.ts:9999',
    ]);
    expect(refProblems('(x/route.ts:41)', undefined, count, local)).toEqual(['x/route.ts:41']);
  });

  it('reads the real tree (anti-vacuity)', () => {
    expect(v1Pages()).toContain('app/r/[slug]/page.tsx');
    expect(v1Routes()).toContain('app/api/webhooks/stripe/route.ts');
    expect(isFlagGated(join(WEB, 'app/api/checks/[id]/claim/route.ts'))).toBe(true);
    // v1 routes with a v2 branch import a flag reader but do not refuse with it off.
    expect(isFlagGated(join(WEB, 'app/api/auth/magic-link/route.ts'))).toBe(false);
    expect(isFlagGated(join(WEB, 'app/login/verify/route.ts'))).toBe(false);
    expect(v1InngestFunctions().map((f) => f.id)).toContain('crawlmouse.audit');
    expect(v1Tables()).toContain('public.public_reports');
  });
});

describe('the inventory matches the tree', () => {
  /** Files on disk that no entry rules, minus those the flag rule calls v2. */
  const unruled = (kind: Kind, onDisk: string[]) => {
    const listed = new Set(items.filter((e) => e.kind === kind).map((e) => e.path));
    return onDisk.filter(
      (p) => !listed.has(p) && !(APP_KINDS.includes(kind) && isFlagGated(join(WEB, p))),
    );
  };
  const cases: Array<[Kind, () => string[]]> = [
    ['page', () => v1Pages()],
    ['metadata', () => v1MetadataFiles()],
    ['route', () => v1Routes()],
    ['inngest', () => v1InngestFunctions().map((f) => f.path)],
    ['cron', () => v1InngestFunctions().flatMap((f) => (f.cron === null ? [] : [f.path]))],
    ['table', () => v1Tables()],
  ];

  it.each(cases)('every %s on disk has an entry', (kind, onDisk) => {
    expect(unruled(kind, onDisk())).toEqual([]);
  });

  it.each(cases)('every live %s entry names something on disk', (kind, onDisk) => {
    const found = new Set(onDisk());
    expect(pathsOf(kind).filter((p) => !found.has(p))).toEqual([]);
  });

  it('no item has two entries', () => {
    const keys = items.map((e) => `${e.kind} ${e.path}`);
    expect(keys.length).toBe(new Set(keys).size);
  });

  it('a page entry carries the URL its file serves, and only pages carry one', () => {
    for (const e of items)
      expect(e.url, e.path).toBe(e.kind === 'page' ? pageUrl(e.path) : undefined);
  });

  it('an Inngest entry carries the function id, and a cron entry its schedule', () => {
    const found = new Map(v1InngestFunctions().map((f) => [f.path, f]));
    for (const e of live.filter((i) => i.kind === 'inngest')) {
      expect(e.id, e.path).toBe(found.get(e.path)?.id);
    }
    for (const e of live.filter((i) => i.kind === 'cron')) {
      expect(e.schedule, e.path).toBe(found.get(e.path)?.cron);
    }
  });
});

describe('every ruling is one of three and carries its consequence (D2, D3)', () => {
  const REDIRECT: Record<Kind, RegExp> = {
    page: /^(\/\S*|410|none|same)$/,
    route: /^(\/\S*|alias|none)$/,
    metadata: /^(\/\S*|none)$/,
    inngest: /^n\/a$/,
    cron: /^n\/a$/,
    table: /^n\/a$/,
  };

  it.each(items.map((e) => [`${e.kind} ${e.path}`, e] as const))('%s', (_key, e) => {
    expect(['retire', 'keep', 'delete']).toContain(e.ruling);
    expect(e.reason.trim()).not.toBe('');
    expect(e.evidence.trim()).not.toBe('');
    if (e.ruling === 'retire') {
      expect(e.replacedBy?.trim(), 'retire names its replacement').toBeTruthy();
      expect(e.redirect, 'retire states its redirect in the form its kind allows').toMatch(
        REDIRECT[e.kind],
      );
    } else {
      expect(e.replacedBy).toBeUndefined();
      expect(e.redirect).toBeUndefined();
    }
  });

  it('a delete is an app file that is gone, with its PostHog traffic query in evidence', () => {
    expect(deleteProblems(items, (p) => existsSync(join(WEB, p)))).toEqual([]);
  });

  it('the delete rule refuses what D3 forbids (fixture: no entry is a delete today)', () => {
    const del = (kind: Kind, path: string, evidence = 'PostHog: 0 views') =>
      ({ kind, path, ruling: 'delete', reason: 'r', evidence }) as Entry;
    const exists = (p: string) => p === 'app/here/page.tsx';
    expect(deleteProblems([del('page', 'app/gone/page.tsx')], exists)).toEqual([]);
    expect(deleteProblems([del('page', 'app/here/page.tsx')], exists)).toEqual([
      'app/here/page.tsx: still on disk',
    ]);
    expect(deleteProblems([del('page', 'app/gone/page.tsx', 'no traffic')], exists)).toEqual([
      'app/gone/page.tsx: no PostHog query',
    ]);
    expect(deleteProblems([del('table', 'public.x')], exists)).toEqual([
      'public.x: only app files are deleted here',
    ]);
  });

  it('a retired page that redirects to a path names a page that stays served, with segments it has', () => {
    expect(redirectProblems(items)).toEqual([]);
    const page = (path: string, url: string, ruling: string, redirect?: string) => ({
      kind: 'page',
      path,
      url,
      ruling,
      redirect,
    });
    const keep = page('app/k/page.tsx', '/k', 'keep');
    const a = (to: string) => page('app/a/page.tsx', '/a', 'retire', to);
    expect(redirectProblems([keep, a('/k')])).toEqual([]);
    expect(redirectProblems([keep, a('/a')])).toEqual([
      'app/a/page.tsx: redirects to itself (use same)',
    ]);
    expect(redirectProblems([keep, a('/r/[x]')])).toEqual([
      'app/a/page.tsx: /r/[x] names [x], which /a does not have',
    ]);
    expect(redirectProblems([keep, page('app/b/page.tsx', '/b', 'retire'), a('/b')])).toEqual([
      'app/a/page.tsx: /b is not a page that stays served',
    ]);
    // A dynamic target: its shape is a served page's, and its segments come from the source's.
    const served = page('app/s/[id]/page.tsx', '/s/[id]', 'retire', 'same');
    const pair = (to: string) => page('app/c/[a]/[b]/page.tsx', '/c/[a]/[b]', 'retire', to);
    expect(redirectProblems([served, pair('/s/[a]')])).toEqual([]);
    expect(redirectProblems([served, pair('/s/[z]')])).toEqual([
      'app/c/[a]/[b]/page.tsx: /s/[z] names [z], which /c/[a]/[b] does not have',
    ]);
    expect(redirectProblems([served, pair('/t/[a]')])).toEqual([
      'app/c/[a]/[b]/page.tsx: /t/[a] is not a page that stays served',
    ]);
    expect(
      redirectProblems([page('app/s/[id]/page.tsx', '/s/[id]', 'retire', 'none'), pair('/s/[a]')]),
    ).toEqual(['app/c/[a]/[b]/page.tsx: /s/[a] is not a page that stays served']);
  });

  it('every file:line in evidence, checks and findings holds on the tracked tree', () => {
    const tracked = new Set(
      execFileSync('git', ['ls-files'], { cwd: REPO_ROOT, encoding: 'utf8' }).split('\n'),
    );
    const count = (p: string) =>
      tracked.has(p) ? readFileSync(join(REPO_ROOT, p), 'utf8').split('\n').length : 0;
    const bad = [
      ...items.flatMap((e) => {
        const own = APP_KINDS.includes(e.kind) ? e.path : undefined;
        return [e.evidence, ...Object.values(e.checks ?? {})].flatMap((t) =>
          refProblems(t, own, count),
        );
      }),
      ...inventory.findings.flatMap((f) =>
        refProblems(`${f.evidence} ${f.what}`, undefined, count),
      ),
    ];
    expect(bad).toEqual([]);
  });
});

describe('each live page and route carries its D4 row, and each keep page its D7 block', () => {
  const rowed = items.filter(
    (e) => (e.kind === 'page' || e.kind === 'route') && e.ruling !== 'delete',
  );

  it.each(rowed.map((e) => [e.path, e] as const))('%s', (_path, e) => {
    expect(Object.keys(e.checks ?? {}).sort()).toEqual([...CHECK_KEYS].sort());
    for (const k of CHECK_KEYS) expect(e.checks![k], k).toMatch(/^(pass|n\/a|finding) — \S/);
    if (e.kind === 'page' && e.ruling === 'keep') expect(e.e2e, 'e2e block').toBeDefined();
  });

  it('a finding verdict names, as "(ID)", a finding that lists its item', () => {
    const byId = new Map(inventory.findings.map((f) => [f.id, f]));
    const flagged = items.flatMap((e) =>
      Object.entries(e.checks ?? {})
        .filter(([, t]) => verdictOf(t) === 'finding')
        .map(([k, t]) => ({ where: `${e.path}#${k}`, path: e.path, text: t })),
    );
    expect(flagged.length).toBeGreaterThan(0);
    const unnamed = flagged.filter(({ path, text }) => {
      const id = /^finding — \w+ \(([A-Z0-9-]+)\):/.exec(text)?.[1];
      return id === undefined || !byId.get(id)?.items.includes(path);
    });
    expect(unnamed.map((u) => u.where)).toEqual([]);
  });
});

describe('the findings (D8, D12)', () => {
  const paths = new Set(items.map((e) => e.path));

  it.each(inventory.findings.map((f) => [f.id, f] as const))('%s', (_id, f) => {
    expect(['blocker', 'major', 'minor']).toContain(f.severity);
    expect(f.items.length).toBeGreaterThan(0);
    expect(f.items.filter((i) => !paths.has(i))).toEqual([]);
    expect(f.evidence.trim()).not.toBe('');
    expect(f.what.trim()).not.toBe('');
    expect([f.owner, f.fixedIn].filter((x) => x !== undefined).length, 'owner xor fixedIn').toBe(1);
    if (f.fixedIn !== undefined) expect(f.fixedIn).toMatch(/^[0-9a-f]{8}$/);
  });

  it('ids are unique, and no blocker is left open', () => {
    const ids = inventory.findings.map((f) => f.id);
    expect(ids.length).toBe(new Set(ids).size);
    expect(inventory.findings.filter((f) => f.severity === 'blocker' && !f.fixedIn)).toEqual([]);
  });
});

describe('the sitemap (§13): nothing in it is deleted, and a retired URL in it names its target', () => {
  it('checks pages and routes against the sitemap the app serves', async () => {
    const { default: sitemap } = await import('../app/sitemap');
    const urls = (await sitemap()).map((s) => new URL(s.url).pathname.replace(/\/$/, '') || '/');
    expect(urls).toContain('/r/probe-slug');
    expect(urls).toContain('/blog');
    const urlOf = (e: Entry) => (e.kind === 'page' ? e.url! : fileUrl(e.path));
    const inSitemap = (e: Entry) => urls.some((u) => urlMatches(urlOf(e), u));
    const served = items.filter((e) => e.kind === 'page' || e.kind === 'route');
    expect(served.filter((e) => e.ruling === 'delete' && inSitemap(e)).map((e) => e.path)).toEqual(
      [],
    );
    const noTarget = served.filter(
      (e) =>
        e.ruling === 'retire' &&
        inSitemap(e) &&
        !(e.redirect!.startsWith('/') || e.redirect === 'same'),
    );
    expect(noTarget.map((e) => e.path)).toEqual([]);
    expect(served.filter(inSitemap).map((e) => e.path)).toContain('app/r/[slug]/page.tsx');
  });
});

describe('the report renders its inventory sections from the JSON (D12, §10)', () => {
  const REPORT = join(REPO_ROOT, 'docs/specs/v2/v1-audit.md');

  it('renders counts that add up to the entries (anti-vacuity)', () => {
    expect(renderCounts(items).trim().endsWith(`| ${items.length} |`)).toBe(true);
    expect(renderCutover(items).split('\n').length - 2).toBe(
      items.filter((e) => e.ruling === 'retire').length,
    );
  });

  it('renders a known row literally (independent of the generator)', () => {
    expect(readFileSync(REPORT, 'utf8')).toContain(
      '| route | `app/billing/route.ts` | /settings/plan (v2 settings) | /settings/plan |',
    );
  });

  it('every full-path file:line in the report outside the rendered blocks holds', () => {
    const tracked = new Set(
      execFileSync('git', ['ls-files'], { cwd: REPO_ROOT, encoding: 'utf8' }).split('\n'),
    );
    const count = (p: string) =>
      tracked.has(p) ? readFileSync(join(REPO_ROOT, p), 'utf8').split('\n').length : 0;
    const prose = readFileSync(REPORT, 'utf8').replace(
      /<!-- v1-inventory:(\w+) -->[\s\S]*?<!-- \/v1-inventory:\1 -->/g,
      '',
    );
    const bad = refProblems(prose, undefined, count).filter(
      (b) => !b.startsWith('bare ') && !b.startsWith('relative '),
    );
    expect(bad).toEqual([]);
  });

  it.each(Object.keys(BLOCKS))('block %s equals what the generator renders', (name) => {
    let report = readFileSync(REPORT, 'utf8');
    if (process.env.V1_INVENTORY_WRITE === '1') {
      report = writeBlocks(report, inventory);
      writeFileSync(REPORT, report);
    }
    expect(readBlock(report, name)).toBe(BLOCKS[name]!(inventory));
  });
});
