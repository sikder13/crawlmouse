import { describe, it, expect } from 'vitest';
import { normalizeDomain } from './domain';

describe('normalizeDomain', () => {
  it('lowercases and strips a leading www.', () => {
    expect(normalizeDomain('https://www.Example.com/path?x=1')).toBe('example.com');
  });

  it('accepts a bare host without a scheme', () => {
    expect(normalizeDomain('www.example.com')).toBe('example.com');
    expect(normalizeDomain('Example.COM')).toBe('example.com');
  });

  it('treats www.example.com and example.com as the same key (no rate-limit bypass)', () => {
    expect(normalizeDomain('https://www.example.com')).toBe(normalizeDomain('https://example.com'));
  });

  it('drops the port and a trailing dot', () => {
    expect(normalizeDomain('http://example.com:8080')).toBe('example.com');
    expect(normalizeDomain('example.com.')).toBe('example.com');
  });

  // The SSRF guard strips one dot and resolves the rest, so `host..` reaches the same server as
  // `host`. As a key it has to be the same key, or a takedown of `host` does not match it.
  it('drops a run of trailing dots, with or without www.', () => {
    for (const written of [
      'example.com..',
      'example.com...',
      'www.example.com..',
      'https://Example.COM../x',
    ]) {
      expect(normalizeDomain(written), written).toBe('example.com');
    }
  });

  it('keys an IDN host by its punycode, however it is written', () => {
    for (const written of [
      'bücher.de',
      'BÜCHER.de',
      'bu\u0308cher.de',
      'xn--bcher-kva.de',
      'XN--BCHER-KVA.de',
      'bücher.de.',
    ]) {
      expect(normalizeDomain(written), written).toBe('xn--bcher-kva.de');
    }
  });

  it('only strips a leading www., not www inside the label', () => {
    expect(normalizeDomain('wwwexample.com')).toBe('wwwexample.com');
  });

  it('throws on an unparseable input', () => {
    expect(() => normalizeDomain('not a domain')).toThrow();
    expect(() => normalizeDomain('')).toThrow();
  });

  it('throws on a host of nothing but dots, rather than answering an empty key', () => {
    for (const written of ['.', '..', '...', 'https://../', '。。']) {
      expect(() => normalizeDomain(written), written).toThrow();
    }
  });
});
