import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { AuthNavView } from './AuthNavView';

describe('AuthNavView', () => {
  it('signed out → shows the Login link and no Log out', () => {
    const html = renderToStaticMarkup(<AuthNavView email={null} />);
    expect(html).toContain('Login');
    expect(html).toContain('/login');
    expect(html).not.toContain('Log out');
  });

  it('signed in → shows the email + a Log out that POSTs to the server logout route, and hides Login', () => {
    const html = renderToStaticMarkup(<AuthNavView email="jane@acme.com" />);
    expect(html).toContain('jane@acme.com');
    expect(html).toContain('Log out');
    expect(html).toContain('action="/api/auth/logout"');
    expect(html).toContain('method="post"');
    // No standalone Login link/route when already signed in.
    expect(html).not.toContain('Login');
    expect(html).not.toContain('/login');
  });

  it('renders a glanceable avatar initial from the email', () => {
    expect(renderToStaticMarkup(<AuthNavView email="zoe@x.com" />)).toContain('Z');
  });

  it('escapes a hostile email rather than emitting raw markup', () => {
    const html = renderToStaticMarkup(<AuthNavView email={'<img src=x onerror=alert(1)>@x.com'} />);
    expect(html).not.toContain('<img src=x');
  });
});
