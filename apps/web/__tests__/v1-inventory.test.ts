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
  pageUrl,
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

  it('a file is flag-gated only when its code imports a …Enabled reader from a …/flags module', () =>
    withDir((dir) => {
      writeFixture(dir, {
        'gated.ts': "import { billingV2Enabled } from '@/lib/billing/flags';",
        'relative.ts': "import { accountDoorEnabled, x } from '../../lib/auth/flags';",
        'comment.ts': "// import { accountDoorEnabled } from '@/lib/auth/flags';",
        'other.ts':
          "import { enabled } from '@/lib/auth/flags';\nimport { aEnabled } from '@/lib/x';",
      });
      expect(isFlagGated(join(dir, 'gated.ts'))).toBe(true);
      expect(isFlagGated(join(dir, 'relative.ts'))).toBe(true);
      expect(isFlagGated(join(dir, 'comment.ts'))).toBe(false);
      expect(isFlagGated(join(dir, 'other.ts'))).toBe(false);
    }));

  it('top-level exported Inngest functions with their cron, and not a factory-built one', () =>
    withDir((dir) => {
      writeFixture(dir, {
        'probe.ts': [
          "export const a = inngest.createFunction({ id: 'p.a' }, { cron: '1 2 * * *' }, h);",
          "export const b = inngest.createFunction({ id: 'p.b' }, { event: 'x' }, h);",
          "export function c() { return inngest.createFunction({ id: 'p.c' }, { cron: '* * * * *' }, h); }",
        ].join('\n'),
        'probe.test.ts': "export const t = inngest.createFunction({ id: 't' }, {}, h);",
      });
      expect(v1InngestFunctions(dir)).toEqual([
        { path: 'inngest/probe.ts#a', id: 'p.a', cron: '1 2 * * *' },
        { path: 'inngest/probe.ts#b', id: 'p.b', cron: null },
      ]);
    }));

  it('tables from non-v2 migrations, with their schema, ignoring comments', () =>
    withDir((dir) => {
      writeFixture(dir, {
        '1_a.sql':
          'create table foo (id int);\n-- create table ghost (x int);\n/* create table ghost2 */',
        '2_b.sql':
          'CREATE TABLE IF NOT EXISTS public.Bar (id int);\ncreate unlogged table baz (i int);',
        '3_c.sql': 'create table research.runs (id int);',
        '4_v2_d.sql': 'create table v2thing (id int);',
      });
      expect(v1Tables(dir)).toEqual(['public.bar', 'public.baz', 'public.foo', 'research.runs']);
    }));

  it('reads the real tree (anti-vacuity)', () => {
    expect(v1Pages()).toContain('app/r/[slug]/page.tsx');
    expect(v1Routes()).toContain('app/api/webhooks/stripe/route.ts');
    expect(isFlagGated(join(WEB, 'app/api/checks/[id]/claim/route.ts'))).toBe(true);
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
    page: /^(\/\S*|410|none)$/,
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
    const deleted = items.filter((e) => e.ruling === 'delete');
    expect(deleted.filter((e) => !APP_KINDS.includes(e.kind)).map((e) => e.path)).toEqual([]);
    for (const e of deleted) {
      expect(existsSync(join(WEB, e.path)), e.path).toBe(false);
      expect(e.evidence, e.path).toMatch(/posthog/i);
    }
  });

  it('a file:line in evidence names a tracked file that has that line', () => {
    const tracked = new Set(
      execFileSync('git', ['ls-files'], { cwd: REPO_ROOT, encoding: 'utf8' }).split('\n'),
    );
    const ref =
      /(?<![\w/.])((?:apps|packages|inngest|infra|docs|scripts|app|lib|components)\/[\w./()[\]-]+):(\d+)\b/g;
    const texts = [
      ...items.flatMap((e) => [e.evidence, ...Object.values(e.checks ?? {})]),
      ...inventory.findings.map((f) => f.evidence),
    ];
    const bad: string[] = [];
    for (const text of texts) {
      for (const m of text.matchAll(ref)) {
        const file = /^(app|lib|components)\//.test(m[1]!) ? `apps/web/${m[1]}` : m[1]!;
        const lines = tracked.has(file)
          ? readFileSync(join(REPO_ROOT, file), 'utf8').split('\n').length
          : 0;
        if (Number(m[2]) > lines) bad.push(m[0]);
      }
    }
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

  it('a finding verdict is named by a finding (anti-vacuity: some verdicts are findings)', () => {
    const named = new Set(inventory.findings.flatMap((f) => f.items));
    const flagged = items.filter((e) =>
      Object.values(e.checks ?? {}).some((t) => verdictOf(t) === 'finding'),
    );
    expect(flagged.length).toBeGreaterThan(0);
    expect(flagged.map((e) => e.path).filter((p) => !named.has(p))).toEqual([]);
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
      (e) => e.ruling === 'retire' && inSitemap(e) && !e.redirect!.startsWith('/'),
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

  it.each(Object.keys(BLOCKS))('block %s equals what the generator renders', (name) => {
    let report = readFileSync(REPORT, 'utf8');
    if (process.env.V1_INVENTORY_WRITE === '1') {
      report = writeBlocks(report, inventory);
      writeFileSync(REPORT, report);
    }
    expect(readBlock(report, name)).toBe(BLOCKS[name]!(inventory));
  });
});
