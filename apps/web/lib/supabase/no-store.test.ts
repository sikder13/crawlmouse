import { describe, it, expect } from 'vitest';
import { NextResponse } from 'next/server';
import { applyNoStore } from './no-store';

describe('applyNoStore', () => {
  it('marks a response private + no-store so a shared/CDN cache never retains an auth cookie', () => {
    const res = applyNoStore(NextResponse.next());
    const cc = res.headers.get('Cache-Control') ?? '';
    expect(cc).toContain('private');
    expect(cc).toContain('no-store');
    expect(res.headers.get('Pragma')).toBe('no-cache');
    expect(res.headers.get('Expires')).toBe('0');
  });

  it('returns the same response instance so it chains on a redirect', () => {
    const res = NextResponse.redirect(new URL('https://crawlmouse.com/dashboard'));
    expect(applyNoStore(res)).toBe(res);
  });
});
