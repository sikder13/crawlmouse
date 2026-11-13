import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  API_ALIAS_LAST_DAY,
  GONE_PAGE_TOKENS,
  V1_CUTOVER,
  apiGoneBody,
  cutoverOf,
  gonePageHtml,
} from './cutover';
import { V2_REWRITES } from './rewrites';

const WEB = join(__dirname, '../..');
const REPO = join(WEB, '../..');

interface InventoryItem {
  kind: string;
  path: string;
  url?: string;
  ruling: 'keep' | 'retire';
  redirect?: string;
}
const INVENTORY: InventoryItem[] = JSON.parse(
  readFileSync(join(REPO, 'docs/ops/v1-inventory.json'), 'utf8'),
).items;

/** An app file's address: `app/api/audits/[id]/cancel/route.ts` → `/api/audits/[id]/cancel`. */
const addressOf = (path: string): string =>
  path.replace(/^app/, '').replace(/\/(page|route)\.tsx?$/, '') || '/';

/** The same address in a row's pattern syntax: `[id]` → `:id`, a last `[trpc]` catch → `*`. */
const patternOf = (address: string): string =>
  address.replace(/\[([a-z]+)\]/gi, (_, name: string) => `:${name}`);

/**
 * The retired pages served by v2 at the same address rather than answered by a row: a rewrite in
 * `V2_REWRITES`, or (for /audit/[id]) the flag branch in v1's page, which sends a v2 check to its own
 * page and keeps serving a v1 audit's.
 */
const SERVED_AT_SAME_ADDRESS: Record<string, string> = {
  'app/page.tsx': '/',
  'app/dashboard/page.tsx': '/dashboard',
  'app/audit/[id]/page.tsx': '/audit/:id',
};

/**
 * The retired v1 routes the v1 audit page reads, so they answer as on main while that page is served
 * for a v1 audit (CC-36 D2): each file is named with the caller that needs it.
 */
const READ_BY_V1_AUDIT_PAGE: Record<string, [string, string]> = {
  'app/api/audits/[id]/stream/route.ts': ['app/audit/[id]/AuditView.tsx', '/stream`'],
  'app/api/audits/[id]/export/route.ts': ['app/audit/[id]/AuditSurfaceView.tsx', '/export`'],
  'app/api/audits/[id]/llms-txt/route.ts': ['components/ai/LlmsTxtGenerator.tsx', '/llms-txt`'],
};

const RETIRED = INVENTORY.filter(
  (i) => i.ruling === 'retire' && (i.kind === 'page' || i.kind === 'route'),
);

describe('the cutover table covers the inventory', () => {
  it('reads a non-empty retired list (anti-vacuity)', () => {
    expect(RETIRED.length).toBeGreaterThanOrEqual(15);
  });

  it.each(RETIRED.map((i) => [i.path, i] as const))(
    '%s is answered by a row, or served by v2 at its address',
    (path) => {
      const rows = V1_CUTOVER.filter((r) => r.inventory === path);
      if (path in READ_BY_V1_AUDIT_PAGE) {
        const [caller, needle] = READ_BY_V1_AUDIT_PAGE[path]!;
        expect(readFileSync(join(WEB, caller), 'utf8')).toContain('/api/audits/${');
        expect(readFileSync(join(WEB, caller), 'utf8')).toContain(needle);
        expect(rows).toEqual([]);
        return;
      }
      if (path in SERVED_AT_SAME_ADDRESS) {
        expect(rows).toEqual([]);
        return;
      }
      expect(rows).toHaveLength(1);
    },
  );

  it('every row names a retired inventory item, once', () => {
    const retired = new Set(RETIRED.map((i) => i.path));
    for (const row of V1_CUTOVER) expect(retired.has(row.inventory), row.inventory).toBe(true);
    const names = V1_CUTOVER.map((r) => r.inventory);
    expect(new Set(names).size).toBe(names.length);
  });

  it.each(V1_CUTOVER.map((r) => [r.from, r] as const))(
    '%s is the address of the file it rules',
    (from, row) => {
      const pattern = patternOf(addressOf(row.inventory));
      // tRPC's one dynamic segment carries batched procedure names ("a.b,c.d"), which `:name`
      // does not match; the row's `*` takes any characters.
      expect(from).toBe(pattern === '/api/trpc/:trpc' ? '/api/trpc/*' : pattern);
    },
  );

  it.each(V1_CUTOVER.filter((r) => r.answer.kind === 'redirect').map((r) => [r.from, r] as const))(
    "%s redirects where the inventory's ruling says",
    (_, row) => {
      const item = INVENTORY.find((i) => i.path === row.inventory)!;
      expect(row.answer).toMatchObject({ kind: 'redirect', to: patternOf(item.redirect!) });
    },
  );

  /**
   * Where each redirect lands, and why it is served while the row's flags are on: a rewrite row whose
   * flag the row names, or a page file that answers without a flag or gates itself on one the row names.
   */
  const TARGETS: Record<string, { rewrite: string } | { page: string; gate: string | null }> = {
    '/': { rewrite: '/' },
    '/audit/:a': { page: 'app/audit/[id]/page.tsx', gate: null },
    '/settings/plan': { page: 'app/(account)/settings/plan/page.tsx', gate: 'checksPublicEnabled' },
  };
  const FLAG_READER: Record<string, string> = {
    checksPublicEnabled: 'checksPublic',
    billingV2Enabled: 'billing',
  };

  it.each(V1_CUTOVER.filter((r) => r.answer.kind === 'redirect').map((r) => [r.from, r] as const))(
    "%s lands on an address served under the row's flags",
    (_, row) => {
      const to = (row.answer as { to: string }).to;
      expect(TARGETS[to], to).toBeDefined();
      const target = TARGETS[to]!;
      if ('rewrite' in target) {
        const rewrite = V2_REWRITES.find((r) => r.from === target.rewrite);
        expect(rewrite && row.flags.includes(rewrite.flag)).toBe(true);
        return;
      }
      const source = readFileSync(join(WEB, target.page), 'utf8');
      if (target.gate === null) {
        expect(source).not.toMatch(/if \(!\w+Enabled\(\)\) return notFound\(\)/);
      } else {
        expect(source).toContain(`if (!${target.gate}()) return notFound();`);
        expect(row.flags).toContain(FLAG_READER[target.gate]);
      }
    },
  );

  it.each(Object.entries(SERVED_AT_SAME_ADDRESS))(
    '%s, served at its own address, is a rewrite row or the page that branches',
    (path, address) => {
      const rewritten = V2_REWRITES.some((r) => r.from === address);
      const branches = readFileSync(join(WEB, path), 'utf8').includes('checksPublicEnabled()');
      expect(rewritten || branches).toBe(true);
    },
  );
});

describe('cutoverOf', () => {
  it.each([
    ['/compare', '/'],
    ['/compare/', '/'],
    ['/compare/abc-1/def-2', '/audit/abc-1'],
    ['/compare/abc-1/def-2/', '/audit/abc-1'],
    ['/%63ompare', '/'],
    ['/billing', '/settings/plan'],
    ['/compare.rsc', '/'],
    ['/billing.rsc', '/settings/plan'],
  ])('%s redirects to %s', (path, to) => {
    expect(cutoverOf(path)?.answer).toMatchObject({ kind: 'redirect', to });
  });

  it('/billing is a 307, the others 308', () => {
    expect(cutoverOf('/billing')?.answer).toMatchObject({ status: 307 });
    expect(cutoverOf('/compare')?.answer).toMatchObject({ status: 308 });
    expect(cutoverOf('/compare/a/b')?.answer).toMatchObject({ status: 308 });
  });

  it.each([
    ['/top/shopify', 'gone-page'],
    ['/top/shopify/', 'gone-page'],
    ['/top/shopify.rsc', 'gone-page'],
    ['/api/trpc/audit.get', 'not-found'],
    ['/api/trpc/a.b,c.d', 'not-found'],
    ['/api/trpc/a/b', 'not-found'],
    ['/api/audits/start', 'gone-api'],
    ['/api/audits/start/', 'gone-api'],
    ['/api/audits/0d6f/cancel', 'gone-api'],
    ['/api/audits/%30d6f/notify', 'gone-api'],
    ['/api/audits/x.y/notify', 'gone-api'],
    ['/api/audits/%7E/notify', 'gone-api'],
    ['/api/audits/a%2Fb/notify', 'gone-api'],
    ["/api/audits/x'y/reaudit", 'gone-api'],
    ['/api/audits/%E0%A4%A/notify', 'gone-api'],
    ['/api/audits/%ZZ/cancel', 'gone-api'],
  ])('%s is answered %s', (path, kind) => {
    expect(cutoverOf(path)?.answer.kind).toBe(kind);
  });

  it.each([
    '/',
    '/compares',
    '/compare/a',
    '/compare/a/b/c',
    '/compare/a b/c',
    '/top',
    '/top/a/b',
    '/api/trpc',
    '/api/trpc/',
    '/api/audits/x/claim',
    '/api/audits/x/stream',
    '/api/audits/x/export',
    '/api/audits/x/llms-txt',
    '/api/audits//notify',
    '/compare/x.y/b',
    '/api/audits/start/x',
    '/api/checks',
    '/billingx',
    '/%E0%A4%A',
    '/top/%ZZ/x',
  ])('%s matches no row', (path) => {
    expect(cutoverOf(path)).toBeNull();
  });
});

/** Whether `now` is after `API_ALIAS_LAST_DAY` (UTC). */
const apiAliasesEnded = (now: Date): boolean =>
  now.getTime() >= Date.parse(`${API_ALIAS_LAST_DAY}T00:00:00Z`) + 86_400_000;

describe('the API aliases end on a stated day', () => {
  it('the last day is 90 days after the earliest planned switch-on, 2026-11-17', () => {
    const days = (Date.parse(API_ALIAS_LAST_DAY) - Date.parse('2026-11-17')) / 86_400_000;
    expect(days).toBe(90);
  });

  it.each([
    ['2026-11-17T00:00:00Z', false],
    ['2027-02-15T23:59:59Z', false],
    ['2027-02-16T00:00:00Z', true],
  ])('at %s they have ended: %s', (now, ended) => {
    expect(apiAliasesEnded(new Date(now))).toBe(ended);
  });

  // The one test here that reads the real clock, on purpose: once the day has passed it fails, and
  // the fix is to remove the `gone-api` rows together with the v1 handlers they shadow and their
  // inventory items, not to move the date. Removing the rows alone fails "is answered by a row"
  // above, since the inventory still lists the handler as retired.
  it('have not ended yet (fails after API_ALIAS_LAST_DAY: remove the alias rows and v1 handlers)', () => {
    expect(apiAliasesEnded(new Date())).toBe(false);
  });

  it('a 410 body names the replacement and the last day', () => {
    expect(apiGoneBody('/api/checks')).toEqual({
      code: 'gone',
      error: 'This v1 endpoint was retired. Use /api/checks instead.',
      replacement: '/api/checks',
      until: API_ALIAS_LAST_DAY,
    });
    expect(apiGoneBody(null).replacement).toBeNull();
  });
});

describe('the gone page', () => {
  const tokens = readFileSync(join(WEB, 'styles/v2/tokens.css'), 'utf8');
  const darkAt = tokens.indexOf('@media (prefers-color-scheme: dark)');

  it.each(Object.entries(GONE_PAGE_TOKENS))(
    '--%s has styles/v2/tokens.css values, light and dark',
    (name, [light, dark]) => {
      const value = (from: number) =>
        new RegExp(`--${name}:\\s*([^;]+);`).exec(tokens.slice(from))?.[1]?.trim();
      expect(value(0)).toBe(light);
      expect(value(darkAt)).toBe(dark);
    },
  );

  it('is a whole document with no script, noindex, linking home', () => {
    const html = gonePageHtml();
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).not.toMatch(/<script|<link/i);
    expect(html).toContain('<meta name="robots" content="noindex">');
    expect(html).toContain('<a href="/">Check a site</a>');
    expect(html).toContain('<h1>Leaderboards were retired</h1>');
  });
});
