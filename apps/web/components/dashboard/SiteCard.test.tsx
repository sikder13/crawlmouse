import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => {}, refresh: () => {} }) }));
vi.mock('@/lib/analytics', () => ({ trackRaw: () => {}, track: () => {} }));

import { SiteCard } from './SiteCard';
import { firstRunSite, improvedSite, regressedSite } from './__fixtures__/dashboard';

describe('SiteCard', () => {
  it('improved site: delta + sparkline + open-loop checklist + re-audit', () => {
    const html = renderToStaticMarkup(<SiteCard site={improvedSite} />);
    expect(html).toContain('yourshop.com');
    expect(html).toContain('▲'); // delta direction
    expect(html).toContain('since last run');
    expect(html).toContain('<polyline'); // grade-over-time sparkline
    expect(html).toContain('4 of 7 fixes done');
    expect(html).toContain('3 to go');
    expect(html).toContain('Re-audit');
  });

  it('regressed site shows a downward delta', () => {
    expect(renderToStaticMarkup(<SiteCard site={regressedSite} />)).toContain('▼');
  });

  it('first audit: no delta, shows the first-audit hint', () => {
    const html = renderToStaticMarkup(<SiteCard site={firstRunSite} />);
    expect(html).toContain('blog.example');
    expect(html).toContain('First audit');
    expect(html).not.toContain('since last run');
  });
});
