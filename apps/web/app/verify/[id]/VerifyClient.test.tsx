import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

// VerifyClient calls useRouter(); provide a stub so it renders outside the App Router context.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, refresh: () => {} }),
}));

import { VerifyClient } from './VerifyClient';

const render = (method: 'dns_txt' | 'meta_tag') =>
  renderToStaticMarkup(
    <VerifyClient id="v1" domain="alynthe.com" method={method} token="tok123" alreadyVerified={false} />,
  );

describe('VerifyClient DNS host hint', () => {
  it('warns DNS-TXT users that providers auto-append the domain, so they enter just _crawlmouse', () => {
    const html = render('dns_txt');
    expect(html).toContain('add your domain automatically');
    expect(html).toContain('_crawlmouse');
    expect(html).toContain('resolves correctly');
  });

  it('does not show the DNS host hint for the meta-tag method (it is DNS-specific)', () => {
    const html = render('meta_tag');
    expect(html).not.toContain('add your domain automatically');
    expect(html).not.toContain('resolves correctly');
  });
});

// R1 — a user bounced into domain verification mid-claim needs a way back to the report they were
// claiming. The verified card renders a "Return to your report" link to the (already-validated,
// same-origin) returnTo; when there is no safe returnTo, no link is rendered (no open redirect).
describe('VerifyClient return-to-report link (R1)', () => {
  const renderVerified = (returnTo: string | null) =>
    renderToStaticMarkup(
      <VerifyClient id="v1" domain="alynthe.com" method="dns_txt" token="t" alreadyVerified returnTo={returnTo} />,
    );

  it('links back to the validated returnTo on the verified card', () => {
    const html = renderVerified('/r/abc');
    expect(html).toContain('Return to your report');
    expect(html).toContain('href="/r/abc"');
  });

  it('renders no return link when returnTo is null (off-origin ?next was rejected upstream)', () => {
    const html = renderVerified(null);
    expect(html).not.toContain('Return to your report');
  });
});
