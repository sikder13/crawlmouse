import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MobileMenuView } from './MobileMenuView';

describe('MobileMenuView', () => {
  it('is a mobile-only (sm:hidden) hamburger disclosure carrying the nav links', () => {
    const html = renderToStaticMarkup(<MobileMenuView email={null} />);
    expect(html).toContain('sm:hidden'); // collapses away at >= sm, where the inline nav takes over
    expect(html).toContain('<details');
    expect(html).toContain('Pricing');
    expect(html).toContain('/pricing');
    expect(html).toContain('Dashboard');
  });

  it('signed out → a Login link, no Log out', () => {
    const html = renderToStaticMarkup(<MobileMenuView email={null} />);
    expect(html).toContain('Login');
    expect(html).toContain('/login');
    expect(html).not.toContain('Log out');
  });

  it('signed in → the email + a Log out form posting to the server route, and no Login', () => {
    const html = renderToStaticMarkup(<MobileMenuView email="jane@acme.com" />);
    expect(html).toContain('jane@acme.com');
    expect(html).toContain('Log out');
    expect(html).toContain('action="/api/auth/logout"');
    expect(html).toContain('method="post"');
    expect(html).not.toContain('/login');
  });

  it('escapes a hostile email rather than emitting raw markup', () => {
    const html = renderToStaticMarkup(<MobileMenuView email={'<img src=x onerror=alert(1)>@x.com'} />);
    expect(html).not.toContain('<img src=x');
  });
});
