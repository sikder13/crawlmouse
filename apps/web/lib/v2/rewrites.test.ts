import { describe, expect, it } from 'vitest';
import { isRewriteTarget, rewriteOf, V2_REWRITES } from './rewrites';

describe('V2_REWRITES', () => {
  it('rewrites /dashboard, with or without its trailing slash, and nothing else', () => {
    expect(rewriteOf('/dashboard')).toEqual({ from: '/dashboard', to: '/dashboard/v2' });
    expect(rewriteOf('/dashboard/')).toEqual({ from: '/dashboard', to: '/dashboard/v2' });
    for (const p of ['/', '/dashboard/v2', '/dashboard/x', '/dashboards', '/Dashboard'])
      expect(rewriteOf(p)).toBeNull();
  });

  it('each row is a page path, no target is a source, and no source repeats', () => {
    const froms = V2_REWRITES.map((r) => r.from);
    expect(new Set(froms).size).toBe(froms.length);
    for (const r of V2_REWRITES) {
      expect(r.from).toMatch(/^\/[a-z0-9/-]*$/);
      expect(r.to).toMatch(/^\/[a-z0-9/-]+$/);
      expect(froms).not.toContain(r.to);
    }
  });

  it('reads a percent-encoded path as Next does: an encoded spelling of a target is a target', () => {
    for (const p of [
      '/dashboard/v2',
      '/dashboard/%76%32',
      '/dashboard/v%32',
      '/%64ashboard/v2',
      '/dashboard%2Fv2',
      '/dashboard/v2/x',
    ])
      expect(isRewriteTarget(p)).toBe(true);
    for (const p of ['/dashboard', '/dashboard/x', '/', '/dashboards/v2'])
      expect(isRewriteTarget(p)).toBe(false);
  });

  it('a path that does not decode counts as a target, so it is refused', () => {
    expect(isRewriteTarget('/dashboard/%E0%A4%A')).toBe(true);
  });

  it('an encoded spelling of a source is rewritten as the source is', () => {
    expect(rewriteOf('/%64ashboard')).toEqual({ from: '/dashboard', to: '/dashboard/v2' });
  });
});
