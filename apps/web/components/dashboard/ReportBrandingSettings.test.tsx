import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { SiteReportSettings } from '@/lib/dashboard-report-settings';

vi.mock('@/lib/analytics', () => ({ track: () => {}, trackRaw: () => {} }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => {}, refresh: () => {} }) }));

import { ReportBrandingSettings } from './ReportBrandingSettings';

// SPEC 04.2 FIX 2 — the dashboard branding panel let you SET a brand but gave no way to SEE the report you
// just branded. It now links straight to the exact /r/<slug> being edited.
const settings: SiteReportSettings = {
  slug: 'abc123XYZ',
  claimed: true,
  listed: true,
  indexable: true,
  whiteLabel: null,
  canWhiteLabel: true,
};

describe('ReportBrandingSettings (SPEC 04.2 FIX 2)', () => {
  it('offers a "View your report" link to the exact /r/<slug> being branded', () => {
    const html = renderToStaticMarkup(<ReportBrandingSettings slug="abc123XYZ" settings={settings} />);
    expect(html).toMatch(/view your report/i);
    expect(html).toContain('href="/r/abc123XYZ"');
  });
});
