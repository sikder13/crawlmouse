/**
 * docs/ops/v1-inventory.json lists every v1 page, metadata file, route handler, Inngest function,
 * cron and table once, with a ruling (CC-V1AUDIT, docs/specs/v2/v1-audit.md). This file holds it to
 * disk in both directions: an item on disk with no entry fails, and an entry naming nothing fails.
 * What is v2, and so not listed, is the rule in v1-inventory-source.ts.
 *
 *   pnpm --filter @crawlmouse/web exec vitest run __tests__/v1-inventory.test.ts
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  REPO_ROOT,
  pageUrl,
  urlMatches,
  v1InngestFunctions,
  v1MetadataFiles,
  v1Pages,
  v1Routes,
  v1Tables,
} from './v1-inventory-source';
import { BLOCKS, readBlock, renderCounts, renderCutover, writeBlocks } from './v1-inventory-report';

vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({}) }));
vi.mock('@/lib/sitemap-reports', () => ({ fetchIndexableReportSlugs: () => Promise.resolve([]) }));

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
};

const INVENTORY = join(REPO_ROOT, 'docs/ops/v1-inventory.json');
const inventory = JSON.parse(readFileSync(INVENTORY, 'utf8')) as { items: Entry[] };
const items = inventory.items;
const live = items.filter((e) => e.ruling !== 'delete');
const pathsOf = (kind: Kind, list = live) =>
  list
    .filter((e) => e.kind === kind)
    .map((e) => e.path)
    .sort();

function writeFixture(root: string, files: string[]) {
  for (const f of files) {
    mkdirSync(dirname(join(root, f)), { recursive: true });
    writeFileSync(join(root, f), '');
  }
}

describe('the finders see what they claim to see', () => {
  it('pages, metadata files and routes, with the v2 groups left out', () => {
    const dir = mkdtempSync(join(tmpdir(), 'v1inv-'));
    try {
      writeFixture(dir, [
        'page.tsx',
        'probe/page.tsx',
        'probe/[id]/route.ts',
        'probe/opengraph-image.tsx',
        'probe/Helper.tsx',
        '(v2-preview)/v2-preview/x/page.tsx',
        '(account)/signup/page.tsx',
        'api/checks/[id]/claim/route.ts',
        '(marketing)/about/page.tsx',
      ]);
      expect(v1Pages(dir)).toEqual([
        'app/(marketing)/about/page.tsx',
        'app/page.tsx',
        'app/probe/page.tsx',
      ]);
      expect(v1Routes(dir)).toEqual(['app/probe/[id]/route.ts']);
      expect(v1MetadataFiles(dir)).toEqual(['app/probe/opengraph-image.tsx']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('top-level exported Inngest functions with their cron, and not a factory-built one', () => {
    const dir = mkdtempSync(join(tmpdir(), 'v1inv-'));
    try {
      writeFileSync(
        join(dir, 'probe.ts'),
        [
          "export const a = inngest.createFunction({ id: 'p.a' }, { cron: '1 2 * * *' }, h);",
          "export const b = inngest.createFunction({ id: 'p.b' }, { event: 'x' }, h);",
          "export function c() { return inngest.createFunction({ id: 'p.c' }, { cron: '* * * * *' }, h); }",
        ].join('\n'),
      );
      writeFileSync(
        join(dir, 'probe.test.ts'),
        "export const t = inngest.createFunction({ id: 't' }, {}, h);",
      );
      expect(v1InngestFunctions(dir)).toEqual([
        { path: 'inngest/probe.ts#a', id: 'p.a', cron: '1 2 * * *' },
        { path: 'inngest/probe.ts#b', id: 'p.b', cron: null },
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('tables from non-v2 migrations, ignoring commented-out statements', () => {
    const dir = mkdtempSync(join(tmpdir(), 'v1inv-'));
    try {
      writeFileSync(
        join(dir, '1_a.sql'),
        'create table foo (id int);\n-- create table ghost (x int);\n/* create table ghost2 */',
      );
      writeFileSync(join(dir, '2_b.sql'), 'CREATE TABLE IF NOT EXISTS public.Bar (id int);');
      writeFileSync(join(dir, '3_v2_c.sql'), 'create table v2thing (id int);');
      expect(v1Tables(dir)).toEqual(['public.bar', 'public.foo']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('reads the real tree (anti-vacuity)', () => {
    expect(v1Pages()).toContain('app/r/[slug]/page.tsx');
    expect(v1Routes()).toContain('app/api/webhooks/stripe/route.ts');
    expect(v1Routes()).not.toContain('app/api/checks/[id]/claim/route.ts');
    expect(v1InngestFunctions().map((f) => f.id)).toContain('crawlmouse.audit');
    expect(v1Tables()).toContain('public.public_reports');
  });
});

describe('the inventory matches the tree', () => {
  const cases: Array<[Kind, () => string[]]> = [
    ['page', () => v1Pages()],
    ['metadata', () => v1MetadataFiles()],
    ['route', () => v1Routes()],
    ['inngest', () => v1InngestFunctions().map((f) => f.path)],
    [
      'cron',
      () =>
        v1InngestFunctions()
          .filter((f) => f.cron !== null)
          .map((f) => f.path),
    ],
    ['table', () => v1Tables()],
  ];

  it.each(cases)('every %s on disk has one entry, and every live entry exists', (kind, onDisk) => {
    expect(pathsOf(kind)).toEqual(onDisk().sort());
  });

  it('no item has two entries', () => {
    const keys = items.map((e) => `${e.kind} ${e.path}`);
    expect(keys.length).toBe(new Set(keys).size);
  });

  it('a page entry carries the URL its file serves', () => {
    for (const e of items.filter((i) => i.kind === 'page'))
      expect(e.url, e.path).toBe(pageUrl(e.path));
  });

  it('an Inngest entry carries the function id, and a cron entry its schedule', () => {
    const found = new Map(v1InngestFunctions().map((f) => [f.path, f]));
    for (const e of live.filter((i) => i.kind === 'inngest'))
      expect(e.id, e.path).toBe(found.get(e.path)?.id);
    for (const e of live.filter((i) => i.kind === 'cron'))
      expect(e.schedule, e.path).toBe(found.get(e.path)?.cron);
  });

  it('a delete entry names a file that is gone (D3 removes it in this step)', () => {
    const fileOf = (e: Entry) => join(REPO_ROOT, 'apps/web', e.path);
    const deleted = items.filter((e) => e.ruling === 'delete' && e.kind !== 'table');
    for (const e of deleted) expect(existsSync(fileOf(e)), e.path).toBe(false);
  });
});

describe('every ruling is one of three and carries its consequence (D2)', () => {
  it.each(items.map((e) => [`${e.kind} ${e.path}`, e] as const))('%s', (_key, e) => {
    expect(['retire', 'keep', 'delete']).toContain(e.ruling);
    expect(e.reason.trim()).not.toBe('');
    expect(e.evidence.trim()).not.toBe('');
    if (e.ruling === 'retire') {
      expect(e.replacedBy?.trim(), 'retire names its replacement').toBeTruthy();
      expect(e.redirect?.trim(), 'retire states its redirect').toBeTruthy();
    } else {
      expect(e.replacedBy).toBeUndefined();
      expect(e.redirect).toBeUndefined();
    }
  });

  it('a file:line in evidence names a tracked file that has that line', () => {
    const ref = /\b((?:apps|packages|inngest|infra|docs|scripts)\/[\w./()[\]-]+):(\d+)\b/g;
    const bad: string[] = [];
    for (const e of items) {
      for (const m of e.evidence.matchAll(ref)) {
        const file = join(REPO_ROOT, m[1]!);
        const lines = existsSync(file) ? readFileSync(file, 'utf8').split('\n').length : 0;
        if (Number(m[2]) > lines) bad.push(`${e.path}: ${m[0]}`);
      }
    }
    expect(bad).toEqual([]);
  });
});

describe('the sitemap (§13): nothing in it is deleted, and a retired URL in it names its target', () => {
  it('checks against the sitemap the app serves', async () => {
    const { default: sitemap } = await import('../app/sitemap');
    const urls = (await sitemap()).map((s) => new URL(s.url).pathname.replace(/\/$/, '') || '/');
    expect(urls.length).toBeGreaterThan(20);
    const pages = items.filter((e) => e.kind === 'page');
    const inSitemap = (e: Entry) => urls.some((u) => urlMatches(e.url!, u));
    expect(pages.filter((e) => e.ruling === 'delete' && inSitemap(e)).map((e) => e.path)).toEqual(
      [],
    );
    const noTarget = pages.filter(
      (e) => e.ruling === 'retire' && inSitemap(e) && !e.redirect!.startsWith('/'),
    );
    expect(noTarget.map((e) => e.path)).toEqual([]);
  });
});

describe('the report renders its inventory sections from the JSON (D12, §10)', () => {
  const REPORT = join(REPO_ROOT, 'docs/specs/v2/v1-audit.md');

  it('renders counts that add up to the entries (anti-vacuity)', () => {
    const counts = renderCounts(items);
    expect(counts).toContain(`| **all** |`);
    expect(counts.trim().endsWith(`| ${items.length} |`)).toBe(true);
    expect(renderCutover(items).split('\n').length - 2).toBe(
      items.filter((e) => e.ruling === 'retire').length,
    );
  });

  it.each(Object.keys(BLOCKS))('block %s equals what the generator renders', (name) => {
    let report = readFileSync(REPORT, 'utf8');
    if (process.env.V1_INVENTORY_WRITE === '1') {
      report = writeBlocks(report, items);
      writeFileSync(REPORT, report);
    }
    expect(readBlock(report, name)).toBe(BLOCKS[name]!(items));
  });
});
