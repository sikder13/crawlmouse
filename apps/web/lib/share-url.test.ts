import { describe, it, expect } from 'vitest';
import { vi } from 'vitest';
import { reportShareUrl, readRef, withRef, captureReferral } from './share-url';

// SPEC 04 §6/§13 — the share moment must produce a PUBLIC /r/ link (never the private capability URL)
// with a ?ref= attribution param, and the landing must read that ref back safely.

describe('reportShareUrl', () => {
  it('builds the public /r/<slug> URL with ?ref — NEVER the capability URL', () => {
    const url = reportShareUrl('https://crawlmouse.com', 'abc123', 'x');
    expect(url).toBe('https://crawlmouse.com/r/abc123?ref=x');
    expect(url).not.toContain('/audit/'); // the capability URL must never be shared
  });

  it('omits ?ref when no ref is given', () => {
    expect(reportShareUrl('https://crawlmouse.com', 'abc123')).toBe('https://crawlmouse.com/r/abc123');
    expect(reportShareUrl('https://crawlmouse.com', 'abc123', null)).toBe('https://crawlmouse.com/r/abc123');
  });

  it('strips a trailing slash on the origin and encodes the slug + ref', () => {
    expect(reportShareUrl('https://crawlmouse.com/', 'a b/c', 'copy')).toBe('https://crawlmouse.com/r/a%20b%2Fc?ref=copy');
  });
});

describe('withRef', () => {
  it('appends ?ref to a bare URL', () => {
    expect(withRef('https://crawlmouse.com/r/abc', 'x')).toBe('https://crawlmouse.com/r/abc?ref=x');
  });
  it('appends &ref when the URL already has a query', () => {
    expect(withRef('https://crawlmouse.com/r/abc?foo=1', 'linkedin')).toBe('https://crawlmouse.com/r/abc?foo=1&ref=linkedin');
  });
  it('returns the URL unchanged when ref is null/empty', () => {
    expect(withRef('https://crawlmouse.com/r/abc', null)).toBe('https://crawlmouse.com/r/abc');
    expect(withRef('https://crawlmouse.com/r/abc')).toBe('https://crawlmouse.com/r/abc');
  });
});

describe('readRef', () => {
  it('reads ?ref from a query string or URLSearchParams', () => {
    expect(readRef('?ref=linkedin')).toBe('linkedin');
    expect(readRef('ref=telegram')).toBe('telegram');
    expect(readRef(new URLSearchParams({ ref: 'facebook' }))).toBe('facebook');
  });

  it('sanitizes to a bounded [a-z0-9_-] token (no unbounded / hostile ref reaches analytics or the DOM)', () => {
    expect(readRef('?ref=<script>alert(1)</script>')).toBe('scriptalert1script'); // tags/parens stripped
    expect(readRef('?ref=' + encodeURIComponent('X Y!'))).toBe('xy'); // lowercased, space/! stripped
    expect(readRef('?ref=' + 'a'.repeat(50))).toBe('a'.repeat(32)); // length-capped
  });

  it('returns null for a missing / empty / all-stripped ref', () => {
    expect(readRef('?foo=bar')).toBeNull();
    expect(readRef('')).toBeNull();
    expect(readRef(null)).toBeNull();
    expect(readRef('?ref=***')).toBeNull(); // nothing survives sanitization
  });
});

describe('captureReferral (§13 K measurement)', () => {
  it('fires referral_landing with the sanitized source when ?ref is present, and returns it', () => {
    const track = vi.fn();
    const ref = captureReferral('?ref=X', track);
    expect(ref).toBe('x');
    expect(track).toHaveBeenCalledWith('referral_landing', { source: 'x' });
  });

  it('does NOT fire and returns null when there is no ref', () => {
    const track = vi.fn();
    expect(captureReferral('?utm=foo', track)).toBeNull();
    expect(track).not.toHaveBeenCalled();
  });
});
