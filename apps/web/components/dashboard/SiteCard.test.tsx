import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => {}, refresh: () => {} }) }));
vi.mock('@/lib/analytics', () => ({ trackRaw: () => {}, track: () => {} }));

import { SiteCard } from './SiteCard';
import { firstRunSite, improvedSite, regressedSite } from './__fixtures__/dashboard';

describe('SiteCard', () => {
  it('improved: compact gauge + warm delta + sparkline/span + open loop + re-audit', () => {
    const html = renderToStaticMarkup(<SiteCard site={improvedSite} />);
    expect(html).toContain('yourshop.com');
    expect(html).toContain('aria-label="Grade B, 81 out of 100"'); // the compact gauge (cross-surface object)
    expect(html).toContain('▲');
    expect(html).toContain('Your fixes are working'); // warm, feels-known copy
    expect(html).toContain('up 12 points');
    expect(html).toContain('<polyline'); // grade-over-time sparkline
    expect(html).toContain('over 25 days'); // time anchor
    expect(html).toContain('4 of 7 fixes done');
    expect(html).toContain('3 to go');
    expect(html).toContain('Re-audit');
  });

  it('regressed: downward delta with a supportive nudge', () => {
    const html = renderToStaticMarkup(<SiteCard site={regressedSite} />);
    expect(html).toContain('▼');
    expect(html).toContain('worth a look');
  });

  it('first audit: no delta, first-audit hint', () => {
    const html = renderToStaticMarkup(<SiteCard site={firstRunSite} />);
    expect(html).toContain('First audit');
    expect(html).not.toContain('since your last visit');
  });
});
