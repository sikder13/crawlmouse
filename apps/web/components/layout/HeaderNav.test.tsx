import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { HeaderNav } from './HeaderNav';

// HeaderNav reads auth state client-side (so pages stay statically rendered); the SSR / first render is
// the signed-out default. We assert the RESPONSIVE STRUCTURE — a desktop inline nav (hidden < sm) and a
// mobile hamburger (hidden >= sm), each carrying the nav links — so nothing overflows on a ~390px phone.
describe('HeaderNav', () => {
  it('renders a desktop inline nav (hidden sm:flex) AND a mobile hamburger (sm:hidden)', () => {
    const html = renderToStaticMarkup(<HeaderNav />);
    expect(html).toContain('hidden sm:flex'); // desktop inline nav, hidden on mobile
    expect(html).toContain('sm:hidden'); // mobile hamburger, hidden on desktop
    expect(html).toContain('Pricing');
    expect(html).toContain('Dashboard');
    expect(html).toContain('<details'); // the mobile hamburger disclosure
  });

  it('SSR default is signed-out (the Login affordance), not a logged-in menu', () => {
    expect(renderToStaticMarkup(<HeaderNav />)).toContain('/login');
  });
});
