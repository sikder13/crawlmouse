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

  it('only strips a leading www., not www inside the label', () => {
    expect(normalizeDomain('wwwexample.com')).toBe('wwwexample.com');
  });

  it('throws on an unparseable input', () => {
    expect(() => normalizeDomain('not a domain')).toThrow();
    expect(() => normalizeDomain('')).toThrow();
  });
});
