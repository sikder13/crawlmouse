import { describe, it, expect } from 'vitest';
import { isPrivateOrReservedIp, validateUrlOrThrow } from './ssrf-guard.js';

describe('isPrivateOrReservedIp', () => {
  it.each([
    ['127.0.0.1', true, 'loopback'],
    ['10.0.0.1', true, 'rfc1918 10/8'],
    ['172.16.0.1', true, 'rfc1918 172.16/12'],
    ['172.31.255.255', true, 'rfc1918 172.16/12 upper'],
    ['192.168.0.1', true, 'rfc1918 192.168/16'],
    ['169.254.169.254', true, 'cloud metadata / link-local'],
    ['0.0.0.0', true, 'unspecified'],
    ['::1', true, 'ipv6 loopback'],
    ['fc00::1', true, 'ipv6 ULA'],
    ['fe80::1', true, 'ipv6 link-local'],
    ['8.8.8.8', false, 'public dns'],
    ['1.1.1.1', false, 'public cf'],
    ['2606:4700:4700::1111', false, 'public ipv6'],
  ])('IP %s is private/reserved=%s (%s)', (ip, expected) => {
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
    // Provide a resolver that always returns a private IP.
    await expect(
      validateUrlOrThrow('https://internal.example', {
        resolver: async () => ['10.0.0.1'],
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
