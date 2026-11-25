/**
 * F-292 (D-29): the owner's result, fix and report pages wear the signed-in seat's theme, as the
 * dashboard does. Each v2 page under `/audit/[id]` (every `page.tsx` but v1's own) and
 * `/reports/[id]` renders `sessionTheme()`, which reads the session's seat theme
 * (`sessionTheme`: one read of `seats.theme`) and hands it to `SeatTheme`. `SeatTheme` is replaced here by a marker
 * carrying the theme it was given, so the markup says what the page would apply; what it applies is
 * `components/v2/SeatTheme.dom.test.tsx`'s.
 */
import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fixesAsOf, fixture } from '../../../lib/v2/fixtures';

vi.mock('server-only', () => ({}));

/**
 * The session: a signed-in user or none, and the `seats` read the theme makes, which can hold
 * themes, or fail as an error, or throw.
 */
const state = vi.hoisted(() => ({
  user: null as { id: string } | null,
  seats: [] as { account_id: string; theme: string }[],
  fail: null as null | 'error' | 'throw',
}));
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock('@/lib/supabase/server', () => ({
  supabaseServer: async () => ({
    auth: { getUser: async () => ({ data: { user: state.user } }) },
    from: (table: string) => {
      if (table !== 'seats') throw new Error(`the theme read ${table}`);
      if (state.fail === 'throw') throw new Error('network down');
      const result =
        state.fail === 'error'
          ? { data: null, error: { code: '08006' } }
          : { data: state.seats, error: null };
      const chain = {
        select: () => chain,
        eq: () => chain,
        then: (f: (r: unknown) => unknown) => Promise.resolve(result).then(f),
      };
      return chain;
    },
  }),
}));
const signedIn = (...themes: string[]) => {
  state.user = { id: 'u1' };
  state.seats = themes.map((theme, i) => ({ account_id: `a${i}`, theme }));
  state.fail = null;
};
vi.mock('@/components/v2/SeatTheme', () => ({
  SeatTheme: ({ theme }: { theme: string }) => <i data-seat-theme={theme} />,
}));

const d = fixture('bad-site');
const check = d.checks.find((c) => fixesAsOf(d, c).some((f) => f.packet !== null))!;
const fix = fixesAsOf(d, check).find((f) => f.packet !== null)!;
const ID = check.id;
const FIX = fix.id;

vi.mock('./_lib/access', () => ({
  readAudit: async () => ({
    state: 'ready',
    checkId: check.id,
    host: 'example-outfitter.com',
    kept: true,
    plan: 'pro',
    competitors: 0,
    dataset: d,
    map: null,
  }),
  isReadableAudit: async () => true,
}));

vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({}) }));
vi.mock('@/lib/v2/reports/share-proof', () => ({
  memberProof: async () => ({ accountId: 'a1', doc: {} }),
  pageCapture: async () => async () => undefined,
}));
vi.mock('@/lib/v2/reports/share-store', () => ({ supabaseShareFiles: () => ({}) }));
vi.mock('@/lib/v2/view/proof', () => ({ proofView: () => ({}) }));
vi.mock('@/components/v2/screens/proof/ProofScreen', () => ({
  ProofScreen: () => <p>proof body</p>,
}));

const HERE = __dirname;
function pages(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return pages(path);
    return name === 'page.tsx' ? [relative(HERE, path)] : [];
  });
}
/** Every v2 page of an audit: each `page.tsx` here but v1's own at the root. */
const V2_PAGES = pages(HERE)
  .filter((p) => p !== 'page.tsx')
  .sort();

const REPORT = '../../reports/[id]/page.tsx';
const SURFACES = [...V2_PAGES, REPORT];

async function render(file: string): Promise<string> {
  const route = (await import(`./${file}`)) as { default(p: object): Promise<unknown> };
  const params = Promise.resolve(
    file.startsWith('fix/')
      ? { id: ID, fixId: FIX }
      : { id: file === REPORT ? '7d6f5a4e-0000-4000-8000-000000000001' : ID },
  );
  let node = (await route.default({ params, searchParams: Promise.resolve({}) })) as ReactElement;
  // A route whose element is an async page component (`SegmentPage`, `FixPage`, `MapPage`): a
  // static render cannot await it, so it is called, as the fix route's own test does.
  if (typeof node.type === 'function' && node.type.constructor.name === 'AsyncFunction')
    node = await (node.type as (p: unknown) => Promise<ReactElement>)(node.props);
  return renderToStaticMarkup(node);
}

/** The themes the markup asks to apply. */
const themes = (markup: string) =>
  [...markup.matchAll(/data-seat-theme="([^"]*)"/g)].map((m) => m[1]);

beforeEach(() => vi.stubEnv('V2_CHECKS_PUBLIC', '1'));
afterEach(() => {
  vi.unstubAllEnvs();
  state.user = null;
  state.seats = [];
  state.fail = null;
});

describe('the seat theme on the signed-in result, fix and report pages', () => {
  it('covers the overview, the fix page, the six segments, the map and the report page', () => {
    expect(SURFACES).toEqual([
      'access/page.tsx',
      'changes/page.tsx',
      'content/page.tsx',
      'fix/[fixId]/page.tsx',
      'map/page.tsx',
      'nojs/page.tsx',
      'overview/page.tsx',
      'signals/page.tsx',
      'structure/page.tsx',
      '../../reports/[id]/page.tsx',
    ]);
  });

  describe.each(SURFACES)('%s', (file) => {
    it.each(['dark', 'light', 'system'] as const)(
      'with the seat theme %s, applies exactly that theme once',
      async (theme) => {
        signedIn(theme);
        expect(themes(await render(file))).toEqual([theme]);
      },
    );

    it('signed in with no seat, applies none', async () => {
      signedIn();
      expect(themes(await render(file))).toEqual([]);
    });
  });

  // The report page sends a visitor to sign in; the audit pages render for anyone.
  it.each(V2_PAGES)('%s, signed out, applies none, so the device decides', async (file) => {
    state.user = null;
    expect(themes(await render(file))).toEqual([]);
  });

  // The theme is cosmetic: a failed seats read leaves the page as it would be with no theme.
  it.each(SURFACES.flatMap((f) => [[f, 'error'] as const, [f, 'throw'] as const]))(
    '%s, when the seats read gives %s, still renders, with no theme',
    async (file, fail) => {
      signedIn('dark');
      state.fail = fail;
      const markup = await render(file);
      expect(markup.length).toBeGreaterThan(0);
      expect(themes(markup)).toEqual([]);
    },
  );

  it('two seats with different themes and no account chosen apply none; the same theme, that one', async () => {
    signedIn('dark', 'light');
    expect(themes(await render('overview/page.tsx'))).toEqual([]);
    signedIn('dark', 'dark');
    expect(themes(await render('overview/page.tsx'))).toEqual(['dark']);
  });
});
