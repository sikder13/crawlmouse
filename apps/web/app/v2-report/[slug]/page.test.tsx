/**
 * The v2 report route (CC-29 D1, D6). It reads one thing, the report's row through
 * `getPublicReport` (stubbed here), and renders from that row's snapshot and visibility columns:
 * both Supabase clients are stand-ins that throw on any `.from()` or `.rpc()`, so a read of any
 * other row fails the render. No packet text reaches the markup, for a snapshot of each fixture.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PublicReportRow } from '@/lib/reports';
import { fixture, FIXTURE_NAMES, type FixtureName } from '@/lib/v2/fixtures';
import { buildPublicSnapshot } from '@/lib/v2/reports/build-snapshot';
import type { PublicSnapshotV2 } from '@/lib/v2/reports/snapshot';
import { packetText } from '@/lib/v2/reports/test-helpers';
import { V2_REWRITES } from '@/lib/v2/rewrites';
import { FIRST_AUDIT } from '@/lib/v2/view/segment/test-helpers';

const store = vi.hoisted(() => ({
  row: null as unknown,
  v1Params: [] as unknown[],
}));

vi.mock('@/lib/reports', () => ({ getPublicReport: async () => store.row }));
const refuse = () => {
  throw new Error('the report page read a row other than its own');
};
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({ from: refuse, rpc: refuse }) }));
vi.mock('@/lib/supabase/server', () => ({
  supabaseServer: async () => ({ from: refuse, rpc: refuse }),
}));
vi.mock('@/components/analytics/ReferralCapture', () => ({ ReferralCapture: () => null }));
vi.mock('../../r/[slug]/page', () => ({
  default: async ({ params }: { params: unknown }) => {
    store.v1Params.push(params);
    return <p>v1 report page</p>;
  },
  generateMetadata: async () => ({ title: 'Crawlmouse Report' }),
}));

const route = await import('./page');

const MINTED = '2026-11-12T18:00:00.000Z';
const snapshotOf = (name: FixtureName): PublicSnapshotV2 =>
  buildPublicSnapshot(fixture(name), FIRST_AUDIT[name], MINTED);

const rowWith = (snapshot: unknown, extra: Partial<PublicReportRow> = {}): PublicReportRow => ({
  domain: 'example-outfitter.com',
  grade: null,
  score: null,
  cms_detected: null,
  orphan_count: null,
  avg_depth: null,
  takedown_requested_at: null,
  created_at: MINTED,
  claimed_at: null,
  listed: false,
  indexable: false,
  hidden_at: null,
  white_label: null,
  report_snapshot: snapshot as PublicReportRow['report_snapshot'],
  ...extra,
});

const props = (slug = 'abc123') => ({ params: Promise.resolve({ slug }) });

async function render(slug = 'abc123'): Promise<string> {
  return renderToStaticMarkup((await route.default(props(slug))) as ReactElement);
}

/** The text a reader can see or a crawler can read: text nodes and every attribute value. */
function readable(markup: string): string[] {
  const { document } = new JSDOM(`<body>${markup}</body>`).window;
  const attributes = [...document.querySelectorAll('*')].flatMap((el) =>
    [...el.attributes].map((a) => a.value),
  );
  return [document.body.textContent ?? '', ...attributes];
}

beforeEach(() => {
  vi.stubEnv('V2_CHECKS_PUBLIC', '1');
  store.row = null;
  store.v1Params = [];
});
afterEach(() => vi.unstubAllEnvs());

describe('app/v2-report/[slug]', () => {
  it('is the target of the /r/:slug rewrite, cached for 300 s as v1’s page is', () => {
    expect(V2_REWRITES.find((r) => r.from === '/r/:slug')?.to).toBe('/v2-report/:slug');
    expect(route.revalidate).toBe(300);
    expect(Object.keys(route).sort()).toEqual(['default', 'generateMetadata', 'revalidate']);
  });

  it('reads no request header, so the cached render is the same for every visitor', () => {
    const src = readFileSync(resolve(__dirname, 'page.tsx'), 'utf8');
    expect(src).not.toMatch(/next\/headers|\bcookies\(|\bheaders\(/);
  });

  it.each(FIXTURE_NAMES)(
    'renders the %s snapshot with no packet text in the markup',
    async (name) => {
      store.row = rowWith(snapshotOf(name));
      const markup = await render();
      expect(markup).toContain(snapshotOf(name).headline.slice(0, 20));
      const packets = packetText(fixture(name));
      if (fixture(name).fixes.some((f) => f.packet !== null))
        expect(packets.length).toBeGreaterThan(0);
      const shown = readable(markup);
      for (const text of packets)
        for (const s of shown) expect(s.includes(text), `"${text}" is in the page`).toBe(false);
    },
  );

  it('the packet check finds a packet command that reaches the page', async () => {
    const d = fixture('bad-site');
    const command = packetText(d).find((s) => s.startsWith('curl'))!;
    expect(command).toContain('"');
    const s = snapshotOf('bad-site');
    store.row = rowWith({ ...s, headline: `${s.headline} ${command}` });
    expect(readable(await render()).some((t) => t.includes(command))).toBe(true);
  });

  it('shows the artboard’s parts, from the snapshot, with one orange element', async () => {
    store.row = rowWith(snapshotOf('bad-site'));
    const markup = await render();
    const text = readable(markup)[0]!;
    expect(text).toContain('Shared audit');
    expect(text).toContain('AI readability');
    expect(text).toContain('The three fixes with the largest estimated effect');
    expect(text).toContain('· 10 more in the full audit');
    expect(text).toContain('allowed by robots.txt');
    expect(text).toContain('verified bot, not fetched');
    expect(text).toContain(
      'Tested with tagged user agents from published IPs — crawlmouse.com/bot.',
    );
    expect(text).not.toContain('this link works until');
    expect(markup.match(/data-v2-primary=""/g)).toHaveLength(1);
    expect(markup.match(/<h1/g)).toHaveLength(1);
  });

  it('hands a v1 row, and a missing one, to v1’s page with the same params', async () => {
    store.row = rowWith({ version: 1, domain: 'ex.com' }, { grade: 'B' });
    expect(await render('v1slug')).toBe('<p>v1 report page</p>');
    store.row = null;
    expect(await render('nope')).toBe('<p>v1 report page</p>');
    expect(await Promise.all(store.v1Params.map((p) => p))).toEqual([
      { slug: 'v1slug' },
      { slug: 'nope' },
    ]);
  });

  it('with the flag off is a 404, a v1 row included', async () => {
    vi.stubEnv('V2_CHECKS_PUBLIC', '');
    store.row = rowWith({ version: 1, domain: 'ex.com' }, { grade: 'B' });
    await expect(render()).rejects.toMatchObject({ digest: expect.stringContaining('404') });
    expect(store.v1Params).toEqual([]);
  });

  it('a hidden or taken-down v2 report is a 404', async () => {
    for (const extra of [{ hidden_at: MINTED }, { takedown_requested_at: MINTED }]) {
      store.row = rowWith(snapshotOf('bad-site'), extra);
      await expect(render()).rejects.toMatchObject({ digest: expect.stringContaining('404') });
    }
  });
});

describe('generateMetadata', () => {
  const meta = (slug = 'abc123') => route.generateMetadata(props(slug));

  it('titles a v2 report as the artboard does, canonical /r/<slug>, with its own OG image', async () => {
    store.row = rowWith(snapshotOf('bad-site'));
    expect(await meta()).toEqual({
      title: { absolute: 'example-outfitter.com audit — shared by Crawlmouse' },
      robots: { index: false, follow: true },
      alternates: { canonical: '/r/abc123' },
      openGraph: { images: [{ url: '/r/abc123/opengraph-image' }] },
    });
  });

  it('indexes a v2 report only as its row says', async () => {
    store.row = rowWith(snapshotOf('bad-site'), { claimed_at: MINTED, indexable: true });
    expect((await meta()).robots).toEqual({ index: true, follow: true });
  });

  it('gives every other row v1’s metadata', async () => {
    store.row = rowWith({ version: 1 }, { grade: 'B' });
    expect(await meta()).toEqual({ title: 'Crawlmouse Report' });
    store.row = rowWith(snapshotOf('bad-site'), { hidden_at: MINTED });
    expect(await meta()).toEqual({ title: 'Crawlmouse Report' });
  });
});
