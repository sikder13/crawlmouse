import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ReportLegacyFallback } from './ReportLegacyFallback';

// SPEC 04.2 FIX 1 — a report minted before SPEC 04 has no `report_snapshot`, so the /r/ page renders the
// LEGACY fallback (denormalized columns) instead of ReportBody. 04.1 wired the white-label brand only into
// ReportBody, so a claimed/branded legacy report (snapshot=null, white_label set — e.g. prod
// GgvVWAk5ZDuccxzgy4YQE3 / alynthe.com "Nahl Technologies") still showed the Crawlmouse wordmark. This is
// the render test the source-string guard couldn't reach: it pins the null-snapshot + white_label combo.
describe('ReportLegacyFallback (SPEC 04.2 FIX 1)', () => {
  const OLD = process.env.NEXT_PUBLIC_SUPABASE_URL;
  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://proj.supabase.co';
  });
  afterEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = OLD;
  });

  const base = {
    grade: 'C',
    score: 62,
    orphan_count: 4,
    avg_depth: 3.1,
    created_at: '2026-01-01T00:00:00.000Z',
    cms_detected: 'custom' as string | null,
  };

  it('renders the owner brand + logo on a legacy (null-snapshot) report when white_label is set', () => {
    const html = renderToStaticMarkup(
      <ReportLegacyFallback
        report={{ ...base, white_label: { brandName: 'Nahl Technologies', logoPath: 'GgvVWAk5ZDuccxzgy4YQE3/logo.png' } }}
      />,
    );
    expect(html).toContain('Nahl Technologies'); // the owner's brand name…
    expect(html).toContain('<img'); // …and their logo
    expect(html).toContain('report-brand'); // the print-safe letterhead (carries onto the PDF)
    expect(html).not.toContain('Crawlmouse'); // the Crawlmouse wordmark is dropped for a branded report
  });

  it('falls back to the Crawlmouse wordmark when white_label is null (free / unclaimed default)', () => {
    const html = renderToStaticMarkup(<ReportLegacyFallback report={{ ...base, white_label: null }} />);
    expect(html).toContain('Crawlmouse'); // the viral default
    expect(html).toContain('report-brand');
    // the legacy content itself is preserved by the extraction
    expect(html).toContain('Re-audit for the full report');
  });
});
