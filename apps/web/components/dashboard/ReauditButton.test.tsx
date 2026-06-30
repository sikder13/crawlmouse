import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => {}, refresh: () => {} }) }));
vi.mock('@/lib/analytics', () => ({ trackRaw: () => {}, track: () => {} }));

import { ReauditButton } from './ReauditButton';

describe('ReauditButton', () => {
  it('renders a one-tap re-audit button', () => {
    const html = renderToStaticMarkup(<ReauditButton auditId="a1" />);
    expect(html).toContain('<button');
    expect(html).toContain('Re-audit');
  });
});
