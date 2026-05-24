import { describe, it, expect } from 'vitest';
import { isPrivateOrReservedIp, validateUrlOrThrow } from './ssrf-guard.js';

describe('isPrivateOrReservedIp - IPv4 ranges', () => {
  it.each([
    ['127.0.0.1', true, 'loopback'],
    ['127.0.0.42', true, 'loopback range (127/8)'],
    ['10.0.0.1', true, 'rfc1918 10/8'],
    ['172.16.0.1', true, 'rfc1918 172.16/12'],
    ['172.31.255.255', true, 'rfc1918 172.16/12 upper'],
    ['192.168.0.1', true, 'rfc1918 192.168/16'],
    ['169.254.169.254', true, 'cloud metadata / link-local (AWS, GCP, Azure)'],
    ['100.100.100.200', true, 'CGNAT / Alibaba Cloud metadata'],
    ['100.64.0.1', true, 'CGNAT lower bound'],
    ['100.127.255.255', true, 'CGNAT upper bound'],
    ['0.0.0.0', true, 'unspecified'],
    ['8.8.8.8', false, 'public DNS'],
    ['1.1.1.1', false, 'public Cloudflare'],
    ['100.63.255.255', false, 'just below CGNAT'],
    ['100.128.0.0', false, 'just above CGNAT'],
  ])('IPv4 %s is private/reserved=%s (%s)', (ip, expected) => {
    expect(isPrivateOrReservedIp(ip)).toBe(expected);
  });
});

describe('isPrivateOrReservedIp - IPv6 canonical forms', () => {
  it.each([
    ['::1', true, 'loopback canonical'],
    ['::', true, 'unspecified canonical'],
    ['fc00::1', true, 'ULA fc00::/7 lower'],
    ['fd00::1', true, 'ULA fc00::/7 upper'],
    ['fe80::1', true, 'link-local fe80::/16'],
    ['2606:4700:4700::1111', false, 'public Cloudflare DNS IPv6'],
    ['2001:4860:4860::8888', false, 'public Google DNS IPv6'],
  ])('IPv6 %s is private/reserved=%s (%s)', (ip, expected) => {
    expect(isPrivateOrReservedIp(ip)).toBe(expected);
  });
});

describe('isPrivateOrReservedIp - IPv6 non-canonical loopback/unspecified (must normalize)', () => {
  it.each([
    ['0:0:0:0:0:0:0:1', true, 'loopback expanded form'],
    ['0:0:0:0:0:0:0:0', true, 'unspecified expanded form'],
    ['0::', true, 'unspecified short form'],
    ['::0', true, 'unspecified another short form'],
  ])('IPv6 %s normalizes and blocks=%s (%s)', (ip, expected) => {
    expect(isPrivateOrReservedIp(ip)).toBe(expected);
  });
});

describe('isPrivateOrReservedIp - IPv6 link-local fe80::/10 full range', () => {
  it.each([
    ['fe80::1', true, 'fe80::/16'],
    ['fe90::1', true, 'fe90::'],
    ['fea0::1', true, 'fea0::'],
    ['febf::1', true, 'febf:: (upper end of fe80::/10)'],
    ['fec0::1', false, 'fec0:: (just above fe80::/10)'],
  ])('IPv6 %s is link-local=%s (%s)', (ip, expected) => {
    expect(isPrivateOrReservedIp(ip)).toBe(expected);
  });
});

describe('isPrivateOrReservedIp - IPv4-mapped IPv6 (the critical SSRF vector)', () => {
  it.each([
    ['::ffff:127.0.0.1', true, 'mapped loopback (dotted)'],
    ['::ffff:169.254.169.254', true, 'mapped AWS metadata (dotted)'],
    ['::ffff:10.0.0.1', true, 'mapped RFC1918 (dotted)'],
    ['::ffff:192.168.1.1', true, 'mapped RFC1918 192.168 (dotted)'],
    ['::ffff:172.16.0.1', true, 'mapped RFC1918 172.16 (dotted)'],
    ['::ffff:100.100.100.200', true, 'mapped Alibaba metadata (dotted)'],
    ['::ffff:8.8.8.8', false, 'mapped public DNS (dotted)'],
  ])('IPv6 %s blocks embedded v4=%s (%s)', (ip, expected) => {
    expect(isPrivateOrReservedIp(ip)).toBe(expected);
  });
});

describe('isPrivateOrReservedIp - invalid input', () => {
  it.each([
    ['not-an-ip', true, 'gibberish treated as reserved'],
    ['', true, 'empty treated as reserved'],
    ['999.999.999.999', true, 'out-of-range octets treated as reserved'],
  ])('invalid %s treated as reserved=%s (%s)', (ip, expected) => {
    expect(isPrivateOrReservedIp(ip)).toBe(expected);
  });
});

describe('validateUrlOrThrow', () => {
  it('accepts public https URLs', async () => {
    await expect(validateUrlOrThrow('https://example.com')).resolves.toBeInstanceOf(URL);
  });

  it('rejects non-http schemes', async () => {
    await expect(validateUrlOrThrow('file:///etc/passwd')).rejects.toThrow(/scheme/i);
    await expect(validateUrlOrThrow('gopher://example.com')).rejects.toThrow(/scheme/i);
    await expect(validateUrlOrThrow('javascript:alert(1)')).rejects.toThrow(/scheme/i);
  });

  it('rejects URLs that resolve to private IPs', async () => {
    await expect(
      validateUrlOrThrow('https://internal.example', {
        resolver: async () => ['10.0.0.1'],
      }),
    ).rejects.toThrow(/private/i);
  });

  it('rejects URLs that resolve to IPv4-mapped IPv6 metadata', async () => {
    await expect(
      validateUrlOrThrow('https://evil.example', {
        resolver: async () => ['::ffff:169.254.169.254'],
      }),
    ).rejects.toThrow(/private/i);
  });

  it('rejects URLs that resolve to CGNAT (Alibaba metadata)', async () => {
    await expect(
      validateUrlOrThrow('https://evil.example', {
        resolver: async () => ['100.100.100.200'],
      }),
    ).rejects.toThrow(/private/i);
  });

  it('accepts URLs that resolve to public IPs', async () => {
    const result = await validateUrlOrThrow('https://example.com', {
      resolver: async () => ['8.8.8.8'],
    });
    expect(result).toBeInstanceOf(URL);
  });

  it('rejects malformed URLs', async () => {
    await expect(validateUrlOrThrow('not a url')).rejects.toThrow();
  });
});
