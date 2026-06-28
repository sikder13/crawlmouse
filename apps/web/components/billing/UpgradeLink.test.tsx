import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('@/lib/analytics', () => ({ trackRaw: () => {}, track: () => {} }));

import { UpgradeLink } from './UpgradeLink';

describe('UpgradeLink', () => {
  it('renders the upgrade CTA linking to /pricing', () => {
    const html = renderToStaticMarkup(<UpgradeLink returnTo="/audit/abc" />);
    expect(html).toContain('Unlock Pro');
    expect(html).toContain('/pricing');
  });
});
