import { describe, expect, it } from 'vitest';
import { site, u } from '../../../fixtures/v2/detectors/builders.js';
import { detectRedirectChains } from './redirect-chains.js';
import type { Detection } from './types.js';
import type { PageFacts } from './types.js';

const of = (out: Detection[], path: string) => out.find((d) => d.key === `redirect:${u(path)}`);

/** The homepage and /b link to /t; /t's request is described by `f`. */
const linkedTo = (f?: Partial<Omit<PageFacts, 'url'>>) =>
  site([
    { path: '/', links: ['/t', '/b'] },
    { path: '/b', links: ['/t'] },
    { path: '/t', ...(f ? { facts: f } : {}) },
  ]);

describe('redirect_chain', () => {
  it('detects a link target reached through 2 hops, and names the linking pages', () => {
    const d = of(
      detectRedirectChains(linkedTo({ final_url: u('/t3'), redirect: { hops: 2, loop: false } })),
      '/t',
    );
    expect(d).toMatchObject({ state: 'detected', measured: 2, affected_urls: [u('/'), u('/b')] });
    expect(d!.evidence.edges).toEqual([
      { from_url: u('/'), to_url: u('/t') },
      { from_url: u('/b'), to_url: u('/t') },
    ]);
  });

  it('does not detect 1 hop', () => {
    expect(
      of(
        detectRedirectChains(linkedTo({ final_url: u('/t2'), redirect: { hops: 1, loop: false } })),
        '/t',
      ),
    ).toMatchObject({
      state: 'not_detected',
      measured: 1,
    });
  });

  it('detects a loop, whatever the hop count', () => {
    expect(
      of(
        detectRedirectChains(linkedTo({ final_url: null, redirect: { hops: 1, loop: true } })),
        '/t',
      ),
    ).toMatchObject({
      state: 'detected',
      conditions: ['redirect_loop'],
    });
  });

  it('a request that ended where it started is not proof of no redirect (a loop can come back)', () => {
    expect(of(detectRedirectChains(linkedTo({ final_url: u('/t') })), '/t')).toMatchObject({
      state: 'indeterminate',
      reason: 'hops_not_recorded',
    });
  });

  it('reports a target that answers 404 or 410 as gone, never as fixed', () => {
    const out = detectRedirectChains(
      site([
        { path: '/', links: ['/t'] },
        { path: '/t', status: 404, kind: 'status' },
      ]),
    );
    expect(of(out, '/t')).toMatchObject({
      state: 'indeterminate',
      reason: 'page_gone',
      page_gone: { status_code: 404 },
    });
  });

  it('a link to where another request ended answered there without a redirect', () => {
    // /old was requested and landed at /new with a 200; a link straight to /new reached it.
    const out = detectRedirectChains(
      site([
        { path: '/', links: ['/new'] },
        { path: '/old', facts: { final_url: u('/new') } },
      ]),
    );
    expect(of(out, '/new')).toMatchObject({
      state: 'not_detected',
      measured: 0,
      evidence: { pages: [u('/old')] },
    });
  });

  it('is indeterminate when the request moved and its hops were not recorded (the worker today)', () => {
    expect(of(detectRedirectChains(linkedTo({ final_url: u('/elsewhere') })), '/t')).toMatchObject({
      state: 'indeterminate',
      reason: 'hops_not_recorded',
    });
    expect(of(detectRedirectChains(linkedTo()), '/t')).toMatchObject({
      state: 'indeterminate',
      reason: 'hops_not_recorded',
    });
  });

  it('is indeterminate for a target that was not requested', () => {
    expect(
      of(detectRedirectChains(site([{ path: '/', links: ['/never'] }])), '/never'),
    ).toMatchObject({
      state: 'indeterminate',
      reason: 'not_crawled',
    });
  });

  it('only judges link targets of crawled 200 pages', () => {
    const out = detectRedirectChains(
      site([
        { path: '/', links: [] },
        { path: '/orphan', facts: { final_url: u('/orphan') } },
      ]),
    );
    expect(of(out, '/orphan')).toBeUndefined();
  });
});
