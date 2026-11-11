import { describe, expect, it } from 'vitest';
import { hostFromSiteInput } from '../../../../lib/auth/site-host';
import { publicHost } from './host';

describe('publicHost', () => {
  it.each([
    ['https://example.com', 'example.com'],
    ['http://example.com/pricing?x=1#top', 'example.com'],
    ['example.com', 'example.com'],
    ['  Shop.Example.COM.  ', 'shop.example.com'],
    ['https://www.example.com/', 'www.example.com'],
    ['https://bücher.example/', 'xn--bcher-kva.example'],
    ['https://example.com:443/', 'example.com'],
    ['http://example.com:80/', 'example.com'],
  ])('%s is the host %s', (input, host) => {
    expect(publicHost(input)).toBe(host);
  });

  it.each([
    ['a port that is not the scheme default', 'https://example.com:8443/'],
    ['the other scheme’s default port', 'https://example.com:80/'],
    ['a port on a bare host', 'example.com:8080'],
    ['userinfo', 'https://user:pw@example.com/'],
    ['another scheme', 'ftp://example.com/'],
    ['an IPv4 literal', 'http://127.0.0.1/'],
    ['an IPv6 literal', 'http://[::1]/'],
    ['a single label', 'http://localhost/'],
    ['nothing', '   '],
  ])('refuses %s', (_, input) => {
    expect(publicHost(input)).toBeNull();
  });

  it('spells a host as a named site’s host is spelled (sign-up’s rule)', () => {
    for (const input of ['https://WWW.Example.com./a', 'example.co.uk', 'http://a.b.example.org']) {
      expect(publicHost(input)).toBe(hostFromSiteInput(input));
    }
  });
});
