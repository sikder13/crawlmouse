import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => {}, refresh: () => {} }) }));
vi.mock('@/lib/analytics', () => ({ trackRaw: () => {}, track: () => {} }));

import { SiteCard } from './SiteCard';
import { firstRunSite, freeOwnerSite, proOwnerSite, proRegressedSite } from './__fixtures__/dashboard';
import type { SiteReportSettings } from '@/lib/dashboard-report-settings';

const PRO_SETTINGS: SiteReportSettings = { slug: 'slug-abc', claimed: true, listed: true, indexable: true, whiteLabel: null, canWhiteLabel: true };

describe('SiteCard', () => {
  it('pro owner, improved: compact gauge + warm delta + sparkline/span + open loop + re-audit', () => {
    const html = renderToStaticMarkup(<SiteCard site={proOwnerSite} />);
    expect(html).toContain('yourshop.com');
    expect(html).toContain('aria-label="Grade B, 81 out of 100"'); // compact gauge (cross-surface object)
    expect(html).toContain('▲');
    expect(html).toContain('Your fixes are working'); // warm, feels-known copy
    expect(html).toContain('up 12 points');
    expect(html).toContain('<polyline'); // grade-over-time sparkline
    expect(html).toContain('over 25 days'); // time anchor
    expect(html).toContain('4 of 7 fixes done'); // Pro-owner fix checklist
    expect(html).toContain('3 to go');
    expect(html).toContain('Re-audit');
  });

  it('pro owner, regressed: downward delta with a supportive nudge', () => {
    const html = renderToStaticMarkup(<SiteCard site={proRegressedSite} />);
    expect(html).toContain('▼');
    expect(html).toContain('worth a look');
    expect(html).toContain('1 of 6 fixes done');
  });

  it('free signed-in owner: grade + delta shown, but the fix checklist is Pro-gated (upgrade path)', () => {
    const html = renderToStaticMarkup(<SiteCard site={freeOwnerSite} />);
    expect(html).toContain('blog.example');
    expect(html).toContain('Your fixes are working'); // delta is FREE — still shown to the owner
    expect(html).not.toContain('fixes done'); // the checklist itself is gated
    expect(html).toContain('Track which fixes are done with'); // the upsell copy
    expect(html).toContain('Pro');
  });

  it('first audit: no delta, first-audit hint', () => {
    const html = renderToStaticMarkup(<SiteCard site={firstRunSite} />);
    expect(html).toContain('First audit');
    expect(html).not.toContain('since your last visit');
  });

  it('shows when the site was last audited (personalization payoff) with an absolute UTC hover title', () => {
    const html = renderToStaticMarkup(<SiteCard site={proOwnerSite} />);
    // The label is always present for a valid timestamp; the exact relative value is time-dependent and
    // unit-tested in dashboard-logic. The hover title is the deterministic absolute (UTC) timestamp.
    expect(html).toContain('Audited ');
    expect(html).toContain('title="Jun 26, 2026'); // latest history point ranAt 2026-06-26T09:00Z
  });

  it('first-audit card still shows a last-audited time (history present even with no delta)', () => {
    const html = renderToStaticMarkup(<SiteCard site={firstRunSite} />);
    expect(html).toContain('Audited ');
  });
});

// U6 — the dashboard is the durable home for report branding + visibility. A claimed, owned site exposes
// the SAME controls as the /r/ island (via OwnerControls); an unclaimed/unowned site does not.
describe('SiteCard — report settings (U6)', () => {
  it('a claimed report owned by a Pro user exposes report-branding + visibility settings', () => {
    const html = renderToStaticMarkup(<SiteCard site={proOwnerSite} reportSettings={PRO_SETTINGS} />);
    expect(html).toContain('Report settings');
    expect(html).toContain('Your branding'); // white-label control (editable for Pro)
    expect(html).toContain('name="brandName"');
    expect(html).toMatch(/listed on leaderboards/i); // visibility controls
  });

  it('without report settings (unclaimed / not owned) → no branding area', () => {
    const html = renderToStaticMarkup(<SiteCard site={proOwnerSite} />);
    expect(html).not.toContain('Report settings');
    expect(html).not.toContain('Your branding');
  });

  it('a claimed report owned by a FREE user shows the LOCKED white-label upsell + visibility', () => {
    const html = renderToStaticMarkup(<SiteCard site={proOwnerSite} reportSettings={{ ...PRO_SETTINGS, canWhiteLabel: false }} />);
    expect(html).toContain('Report settings');
    expect(html).toMatch(/upgrade to pro/i);
    expect(html).not.toContain('name="brandName"'); // locked — no editable input for a free owner
    expect(html).toMatch(/listed on leaderboards/i); // visibility is not Pro-gated
  });
});
