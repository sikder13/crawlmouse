import { describe, it, expect } from 'vitest';
import { canonicalizeUrl, hashUrl } from './url-canonical.js';

describe('canonicalizeUrl', () => {
  it.each([
    ['HTTPS://Example.COM/Path/', 'https://example.com/Path'],
    ['https://example.com:443/path', 'https://example.com/path'],
    ['http://example.com:80/path', 'http://example.com/path'],
    ['https://example.com/path?b=2&a=1', 'https://example.com/path?a=1&b=2'],
    ['https://example.com/path#fragment', 'https://example.com/path'],
    ['https://example.com//path//to///page', 'https://example.com/path/to/page'],
    ['https://example.com/', 'https://example.com'],
    ['https://example.com', 'https://example.com'],
  ])('canonicalizes %s -> %s', (input, expected) => {
    expect(canonicalizeUrl(input)).toBe(expected);
  });
});

describe('hashUrl', () => {
  it('is stable across canonical equivalents', () => {
    expect(hashUrl('HTTPS://Example.COM/path/')).toBe(hashUrl('https://example.com/path'));
  });

  it('differs for different URLs', () => {
    expect(hashUrl('https://example.com/a')).not.toBe(hashUrl('https://example.com/b'));
  });

  it('orders query params deterministically regardless of input order', () => {
    // Identity must not depend on param input order or on locale-sensitive sorting.
    const a = canonicalizeUrl('https://example.com/p?z=1&a=2&m=3');
    const b = canonicalizeUrl('https://example.com/p?a=2&m=3&z=1');
    expect(a).toBe(b);
    expect(hashUrl('https://example.com/p?z=1&a=2&m=3')).toBe(
      hashUrl('https://example.com/p?a=2&m=3&z=1'),
    );
  });

  it('sorts duplicate keys by value deterministically', () => {
    expect(canonicalizeUrl('https://example.com/p?k=2&k=1')).toBe(
      'https://example.com/p?k=1&k=2',
    );
  });
});
