import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => {}, refresh: () => {} }) }));
vi.mock('@/lib/analytics', () => ({ trackRaw: () => {}, track: () => {} }));

import { DashboardView } from './DashboardView';
import { dashboardSites } from './__fixtures__/dashboard';

describe('DashboardView', () => {
  it('renders a what-changed card per site', () => {
    const html = renderToStaticMarkup(<DashboardView sites={dashboardSites} />);
    expect(html).toContain('yourshop.com');
    expect(html).toContain('blog.example');
    expect(html).toContain('docs.example');
    expect(html).toContain('Re-audit');
  });

  it('empty state nudges a first audit', () => {
    const html = renderToStaticMarkup(<DashboardView sites={[]} />);
    expect(html).toContain('No audits yet');
    expect(html).toContain('Run an audit');
  });
});
