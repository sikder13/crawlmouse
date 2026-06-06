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

describe('canonicalizeUrl with forceScheme (A1b: scheme normalization)', () => {
  it.each([
    // A site that scheme-downgrades deep paths (https -> http) must map both versions
    // to ONE canonical identity, or the same page double-counts and the in-degree graph
    // splits (corrupting orphan/PageRank/depth).
    ['http://example.com/author/x', 'https:', 'https://example.com/author/x'],
    ['https://example.com/author/x', 'http:', 'http://example.com/author/x'],
    // Already on the target scheme -> unchanged (idempotent).
    ['https://example.com/p', 'https:', 'https://example.com/p'],
    // Accepts the scheme with or without a trailing colon.
    ['http://example.com/p', 'https', 'https://example.com/p'],
  ])('forces %s to %s -> %s', (input, scheme, expected) => {
    expect(canonicalizeUrl(input, { forceScheme: scheme })).toBe(expected);
  });

  it('drops a port that becomes the default of the forced scheme and preserves non-default ports', () => {
    // The WHATWG parser already strips the original scheme's default port; forcing must not
    // resurrect it (these two map an original-default port across schemes).
    expect(canonicalizeUrl('http://example.com:80/p', { forceScheme: 'https:' })).toBe(
      'https://example.com/p',
    );
    expect(canonicalizeUrl('https://example.com:443/p', { forceScheme: 'http:' })).toBe(
      'http://example.com/p',
    );
    // These exercise the post-force port drop: a port that is NON-default for the original
    // scheme but DEFAULT for the forced scheme must be dropped.
    expect(canonicalizeUrl('http://example.com:443/p', { forceScheme: 'https:' })).toBe(
      'https://example.com/p',
    );
    expect(canonicalizeUrl('https://example.com:80/p', { forceScheme: 'http:' })).toBe(
      'http://example.com/p',
    );
    // A genuinely non-default port is preserved.
    expect(canonicalizeUrl('http://example.com:8080/p', { forceScheme: 'https:' })).toBe(
      'https://example.com:8080/p',
    );
  });

  it('makes http and https versions of one page share a hash', () => {
    expect(hashUrl(canonicalizeUrl('http://example.com/p', { forceScheme: 'https:' }))).toBe(
      hashUrl('https://example.com/p'),
    );
  });

  it('rejects a non-http(s) forced scheme', () => {
    expect(() => canonicalizeUrl('https://example.com/p', { forceScheme: 'ftp:' })).toThrow();
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
