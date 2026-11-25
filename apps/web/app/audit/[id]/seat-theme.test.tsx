/**
 * F-292 (D-29): the owner's result, fix and report pages wear the signed-in seat's theme, as the
 * dashboard does. Each v2 page under `/audit/[id]` (every `page.tsx` but v1's own) and
 * `/reports/[id]` renders `sessionTheme()`, which reads the session's seat theme
 * (`readSessionHeader`) and hands it to `SeatTheme`. `SeatTheme` is replaced here by a marker
 * carrying the theme it was given, so the markup says what the page would apply; what it applies is
 * `components/v2/SeatTheme.dom.test.tsx`'s.
 */
import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fixesAsOf, fixture } from '../../../lib/v2/fixtures';
import type { SessionHeader } from '../../../lib/v2/session-header';

vi.mock('server-only', () => ({}));

const state = vi.hoisted(() => ({
  header: { kind: 'signed_out' } as SessionHeader,
}));
vi.mock('@/lib/v2/account/session-header-read', () => ({
  readSessionHeader: async () => state.header,
}));
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

// /reports/[id]: a signed-in member whose session reads the proof page.
vi.mock('@/lib/supabase/server', () => ({
  supabaseServer: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) },
  }),
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
  state.header = { kind: 'signed_out' };
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
        state.header = { kind: 'signed_in', theme };
        expect(themes(await render(file))).toEqual([theme]);
      },
    );

    it('signed in with no seat theme known, applies none', async () => {
      state.header = { kind: 'signed_in', theme: null };
      expect(themes(await render(file))).toEqual([]);
    });
  });

  // The report page sends a visitor to sign in; the audit pages render for anyone.
  it.each(V2_PAGES)('%s, signed out, applies none, so the device decides', async (file) => {
    state.header = { kind: 'signed_out' };
    expect(themes(await render(file))).toEqual([]);
  });
});
