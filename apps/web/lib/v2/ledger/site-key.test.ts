import { describe, expect, it } from 'vitest';
import { registrableDomain, siteKeyFor, siteKeySecretOk } from './site-key';

/** A test-only key: the bytes 00, 11, … ff, twice (32 bytes), as hex. */
const SECRET = Array.from({ length: 16 }, (_, i) => (i * 0x11).toString(16).padStart(2, '0'))
  .join('')
  .repeat(2);

describe('registrableDomain', () => {
  it.each([
    ['www.example.co.uk', 'example.co.uk'],
    ['Shop.Example.COM.', 'example.com'],
    ['foo.github.io', 'foo.github.io'],
    ['localhost', 'localhost'],
    ['[2001:db8::1]', '2001:db8::1'],
  ])('%s → %s', (host, expected) => {
    expect(registrableDomain(host)).toBe(expected);
  });
});

describe('siteKeyFor', () => {
  // Computed with Python's hmac module (hmac.new(bytes.fromhex(SECRET), domain, sha256)), not with
  // this code, so the test pins the value and not only agreement with itself.
  it.each([
    ['www.example.co.uk', '6b90f4e8b38e812a40f6fbdd18da412193076c23f68688780f93d793055fedd2'],
    ['blog.example.com', '549e1ceaa8c1ba059954806666c782ad97eaed57176cc0e55639964ae8967a5d'],
    ['foo.github.io', '70944a1e40ef091d81381d28766373ac88fabe3cfb93eadbdc4b487569cdbb16'],
  ])('%s', (host, expected) => {
    expect(siteKeyFor(host, SECRET)).toBe(expected);
  });

  it('two hosts of one registrable domain share a key', () => {
    expect(siteKeyFor('a.example.com', SECRET)).toBe(siteKeyFor('example.com', SECRET));
  });
});

describe('siteKeySecretOk', () => {
  it.each([
    [undefined, false],
    ['', false],
    ['abc', false],
    [SECRET.slice(0, 62), false],
    [`${SECRET}0`, false],
    [`${SECRET.slice(0, 63)}g`, false],
    [SECRET, true],
    [` ${SECRET.toUpperCase()}\n`, true],
    [SECRET + SECRET, true],
  ])('%j → %s', (raw, ok) => {
    expect(siteKeySecretOk(raw)).toBe(ok);
  });
});
