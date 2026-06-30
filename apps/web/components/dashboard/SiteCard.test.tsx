import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => {}, refresh: () => {} }) }));
vi.mock('@/lib/analytics', () => ({ trackRaw: () => {}, track: () => {} }));

import { SiteCard } from './SiteCard';
import { firstRunSite, freeOwnerSite, proOwnerSite, proRegressedSite } from './__fixtures__/dashboard';

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
