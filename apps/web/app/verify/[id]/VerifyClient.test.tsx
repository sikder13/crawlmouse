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
