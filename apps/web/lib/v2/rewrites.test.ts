import { describe, expect, it } from 'vitest';
import { isRewriteTarget, rewriteOf, V2_REWRITES } from './rewrites';

const SLUG = 'aB3dE5fG7hJ9kL1mN3pQ5r';

describe('V2_REWRITES', () => {
  it('rewrites each source (with or without its trailing slash) under its flag, and nothing else', () => {
    expect(rewriteOf('/')).toEqual({ from: '/', to: '/v2-home', flag: 'checksPublic' });
    for (const p of ['/dashboard', '/dashboard/'])
      expect(rewriteOf(p)).toEqual({
        from: '/dashboard',
        to: '/dashboard/v2',
        flag: 'checksPublic',
      });
    for (const p of ['/pricing', '/pricing/'])
      expect(rewriteOf(p)).toEqual({ from: '/pricing', to: '/v2-pricing', flag: 'billing' });
    for (const p of ['/developers', '/developers/'])
      expect(rewriteOf(p)).toEqual({ from: '/developers', to: '/v2-developers', flag: 'billing' });
    for (const p of [
      '//',
      '/index',
      '/dashboard/v2',
      '/dashboard/x',
      '/dashboards',
      '/Dashboard',
      '/Pricing',
      '/pricing/x',
      '/developer',
    ])
      expect(rewriteOf(p)).toBeNull();
  });

  it('a report path is rewritten to the report target with its slug, and only a report path', () => {
    for (const p of [`/r/${SLUG}`, `/r/${SLUG}/`, `/%72/${SLUG}`])
      expect(rewriteOf(p)).toEqual({
        from: '/r/:slug',
        to: `/v2-report/${SLUG}`,
        flag: 'checksPublic',
      });
    for (const p of [
      '/r',
      '/r/',
      `/r/${SLUG}/opengraph-image`,
      `/r/${SLUG}/x`,
      '/r/a.b',
      '/r/a%2Fb',
      '/r/%2E%2E',
      `/r/${SLUG}.rsc`,
      `/R/${SLUG}`,
    ])
      expect(rewriteOf(p), p).toBeNull();
  });

  it('each row is a page path, no target is a source, and no source repeats', () => {
    const froms = V2_REWRITES.map((r) => r.from);
    expect(new Set(froms).size).toBe(froms.length);
    for (const r of V2_REWRITES) {
      expect(r.from).toMatch(/^\/[a-z0-9/:-]*$/);
      expect(r.to).toMatch(/^\/[a-z0-9/:-]+$/);
      expect(froms).not.toContain(r.to);
      expect(['checksPublic', 'billing']).toContain(r.flag);
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
      '/dashboard/v2.rsc',
      '/dashboard/%76%32.rsc',
      '/v2-home',
      '/v2-home/',
      '/v%32-home',
      '/v2-home.rsc',
      '/v2-pricing',
      '/v2-pricing/x',
      '/v2-developers',
      '/v2-report',
      `/v2-report/${SLUG}`,
      `/v%32-report/${SLUG}`,
      `/v2-report/${SLUG}.rsc`,
    ])
      expect(isRewriteTarget(p), p).toBe(true);
    for (const p of [
      '/dashboard',
      '/dashboard/x',
      '/',
      '//',
      '/dashboards/v2',
      '/v2-home-extra',
      '/v2-reports',
      `/r/${SLUG}`,
    ])
      expect(isRewriteTarget(p), p).toBe(false);
  });

  it('a path that does not decode counts as a target, so it is refused', () => {
    expect(isRewriteTarget('/dashboard/%E0%A4%A')).toBe(true);
  });

  it('a source is not rewritten by its .rsc spelling', () => {
    expect(rewriteOf('/dashboard.rsc')).toBeNull();
    expect(rewriteOf('/%64ashboard.rsc')).toBeNull();
    expect(rewriteOf('/pricing.rsc')).toBeNull();
  });

  it('an encoded spelling of a source is rewritten as the source is', () => {
    expect(rewriteOf('/%64ashboard')).toEqual({
      from: '/dashboard',
      to: '/dashboard/v2',
      flag: 'checksPublic',
    });
  });
});
