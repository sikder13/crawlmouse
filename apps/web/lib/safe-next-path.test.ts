import { describe, it, expect } from 'vitest';
import { safeNextPath } from './safe-next-path';

// SPEC 04.1 R1 — the `?next=` return target is an attacker-reachable URL param, so it must be validated
// to a SAME-ORIGIN RELATIVE path before it is ever rendered as a link (no open redirect). Anything that
// could navigate off-origin — protocol-relative `//host`, an absolute URL, a backslash/scheme trick — is
// rejected (null → no link rendered).
describe('safeNextPath', () => {
  it('accepts a same-origin relative path (with query + hash)', () => {
    expect(safeNextPath('/r/abc')).toBe('/r/abc');
    expect(safeNextPath('/r/abc?ref=x#top')).toBe('/r/abc?ref=x#top');
  });

  it('accepts a unicode (Bengali) relative path as same-origin', () => {
    const out = safeNextPath('/r/career-এক');
    expect(out).not.toBeNull();
    expect(out!.startsWith('/r/')).toBe(true);
  });

  it('rejects protocol-relative and absolute URLs (open redirect)', () => {
    expect(safeNextPath('//evil.com')).toBeNull();
    expect(safeNextPath('https://evil.com')).toBeNull();
    expect(safeNextPath('http://evil.com/x')).toBeNull();
  });

  it('rejects backslash / scheme / whitespace tricks', () => {
    expect(safeNextPath('/\\evil.com')).toBeNull();
    expect(safeNextPath('\\/evil.com')).toBeNull();
    expect(safeNextPath('javascript:alert(1)')).toBeNull();
    expect(safeNextPath('/r/\tx')).toBeNull();
  });

  it('rejects a path that is not a single-leading-slash relative ref', () => {
    expect(safeNextPath('r/abc')).toBeNull();
    expect(safeNextPath('')).toBeNull();
    expect(safeNextPath(null)).toBeNull();
    expect(safeNextPath(undefined)).toBeNull();
  });
});
