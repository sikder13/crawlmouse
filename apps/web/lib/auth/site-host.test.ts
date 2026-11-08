import { describe, expect, it, vi } from 'vitest';
import { admitSiteHost } from './admit-site';
import { hostFromSiteInput } from './site-host';

describe('hostFromSiteInput: shape only, no network', () => {
  it.each([
    ['example.com', 'example.com'],
    ['  Example.COM  ', 'example.com'],
    ['https://www.example.com/pricing?x=1', 'www.example.com'],
    ['http://shop.example.co.uk', 'shop.example.co.uk'],
    ['example.com.', 'example.com'],
    ['bücher.example', 'xn--bcher-kva.example'],
  ])('%s → %s', (input, host) => {
    expect(hostFromSiteInput(input)).toBe(host);
  });

  it.each([
    [''],
    ['   '],
    ['localhost'],
    ['192.168.0.1'],
    ['[::1]'],
    ['ftp://example.com'],
    ['https://user:pw@example.com'],
    ['javascript:alert(1)'],
    ['exa mple.com'],
    ['a'.repeat(254) + '.com'],
  ])('refuses %j', (input) => {
    expect(hostFromSiteInput(input)).toBeNull();
  });
});

describe('admitSiteHost: the SSRF guard, at attach time', () => {
  it('admits a host the guard accepts and passes it as an https URL', async () => {
    const validate = vi.fn(async (u: string) => new URL(u));
    await expect(admitSiteHost('example.com', validate)).resolves.toBe(true);
    expect(validate).toHaveBeenCalledWith('https://example.com/');
  });

  it('refuses a host the guard rejects (private address, no DNS)', async () => {
    const validate = vi.fn(async () => {
      throw new Error('URL resolves to private or reserved IP');
    });
    await expect(admitSiteHost('internal.example', validate)).resolves.toBe(false);
  });
});
