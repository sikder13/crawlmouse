/**
 * The shared report's OG card (CC-29 D6). With V2_CHECKS_PUBLIC on, a live v2 report draws the v2
 * card from its snapshot: host, both grades, the headline. Every other row draws what it drew
 * before: v1's grade card, or the placeholder for a report that is gone.
 */
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PublicReportRow } from '@/lib/reports';
import { fixture } from '@/lib/v2/fixtures';
import { buildPublicSnapshot } from '@/lib/v2/reports/build-snapshot';
import { FIRST_AUDIT } from '@/lib/v2/view/segment/test-helpers';

const store = vi.hoisted(() => ({ row: null as unknown }));
vi.mock('@/lib/reports', () => ({ getPublicReport: async () => store.row }));
vi.mock('next/og', () => ({
  ImageResponse: class {
    constructor(public element: ReactElement) {}
  },
}));

const { default: Image } = await import('./opengraph-image');

const MINTED = '2026-11-12T18:00:00.000Z';
const v2 = buildPublicSnapshot(fixture('bad-site'), FIRST_AUDIT['bad-site'], MINTED);

const row = (extra: Partial<PublicReportRow>): PublicReportRow => ({
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
  ...extra,
});

async function drawn(): Promise<string> {
  const res = (await Image({ params: Promise.resolve({ slug: 'abc123' }) })) as unknown as {
    element: ReactElement;
  };
  return renderToStaticMarkup(res.element);
}

beforeEach(() => vi.stubEnv('V2_CHECKS_PUBLIC', '1'));
afterEach(() => vi.unstubAllEnvs());

describe('/r/<slug>/opengraph-image', () => {
  it('draws a live v2 report from its snapshot: host, both grades, the headline', async () => {
    store.row = row({ report_snapshot: v2 as unknown as PublicReportRow['report_snapshot'] });
    const card = await drawn();
    expect(card).toContain('example-outfitter.com');
    expect(card).toContain('Technical SEO');
    expect(card).toContain('AI readability');
    expect(card).toContain('>B<');
    expect(card).toContain('41 / 100');
    expect(card).toContain(v2.headline);
    expect(card).toContain('#9B2613');
  });

  it('with the flag off, a v2 report is the placeholder', async () => {
    vi.stubEnv('V2_CHECKS_PUBLIC', '');
    store.row = row({ report_snapshot: v2 as unknown as PublicReportRow['report_snapshot'] });
    expect(await drawn()).toBe('<div style="font-size:48px">Crawlmouse</div>');
  });

  it('a hidden v2 report is the placeholder', async () => {
    store.row = row({
      report_snapshot: v2 as unknown as PublicReportRow['report_snapshot'],
      hidden_at: MINTED,
    });
    expect(await drawn()).toBe('<div style="font-size:48px">Crawlmouse</div>');
  });

  it('a v1 report draws v1’s grade card, flag on or off', async () => {
    store.row = row({ grade: 'B', score: 79, claimed_at: MINTED });
    const on = await drawn();
    expect(on).toContain('79 / 100');
    expect(on).not.toContain('AI readability');
    vi.stubEnv('V2_CHECKS_PUBLIC', '');
    expect(await drawn()).toBe(on);
  });
});
