import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

// The v1 /pricing page (served while V2_BILLING is off) offers payment only while v1 purchases are
// open (CC-45 hotfix): with V2_CHECKS_PUBLIC on and V2_BILLING off its Pro card offers Start free.
vi.mock('@/components/layout/Header', () => ({ Header: () => null }));
vi.mock('@/components/layout/Footer', () => ({ Footer: () => null }));

import PricingPage from './page';

afterEach(() => vi.unstubAllEnvs());

const render = (env: { checks?: string; billing?: string }) => {
  vi.stubEnv('V2_CHECKS_PUBLIC', env.checks ?? '');
  vi.stubEnv('V2_BILLING', env.billing ?? '');
  return renderToStaticMarkup(<PricingPage />);
};

describe('v1 /pricing page', () => {
  it('shows no Upgrade button while V2_CHECKS_PUBLIC is on and V2_BILLING is off', () => {
    const html = render({ checks: '1' });
    expect(html).not.toContain('Upgrade');
    expect(html).toContain('Paid plans open shortly');
  });

  it.each([
    ['both flags off (v1 as it was)', {}],
    ['V2_BILLING on', { checks: '1', billing: '1' }],
  ])('keeps the Upgrade button with %s', (_, env) => {
    const html = render(env);
    expect(html).toContain('Upgrade — Pro $190/yr');
    expect(html).not.toContain('Paid plans open shortly');
  });
});
