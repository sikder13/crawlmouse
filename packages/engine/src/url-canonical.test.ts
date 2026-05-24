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
});
