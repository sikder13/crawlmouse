import { describe, expect, it } from 'vitest';
import { site, u, type PageSpec } from '../../../fixtures/v2/detectors/builders.js';
import { detectCanonicalMismatch } from './canonical-mismatch.js';
import type { Detection } from './types.js';

const of = (out: Detection[], path: string) => out.find((d) => d.key === `canonical:${u(path)}`);
const self = (path: string) => ({ canonical: { href: u(path) } });

/** /p declares `href` as its canonical; nothing links to /p. */
function declaring(href: string | null, target: PageSpec | null = null, opts = {}) {
  return site(
    [
      { path: '/', links: target ? [target.path] : [], facts: self('/') },
      { path: '/p', facts: { canonical: { href } } },
      ...(target ? [target] : []),
    ],
    opts,
  );
}

describe('canonical_mismatch', () => {
  it('is clear for a self-canonical page and for a page that declares none', () => {
    expect(of(detectCanonicalMismatch(declaring(u('/p'))), '/p')).toMatchObject({
      state: 'not_detected',
    });
    expect(of(detectCanonicalMismatch(declaring(null)), '/p')).toMatchObject({
      state: 'not_detected',
    });
  });

  it('is clear for an unlinked page consolidated onto a sound canonical', () => {
    expect(
      of(detectCanonicalMismatch(declaring(u('/c'), { path: '/c', facts: self('/c') })), '/p'),
    ).toMatchObject({
      state: 'not_detected',
    });
  });

  it('detects a canonical to a page that does not answer 200', () => {
    const d = of(
      detectCanonicalMismatch(declaring(u('/c'), { path: '/c', status: 301, kind: 'status' })),
      '/p',
    );
    expect(d).toMatchObject({ state: 'detected', conditions: ['canonical_target_not_200'] });
    expect(d!.evidence.pages).toEqual([u('/c'), u('/p')]);
  });

  it('a canonical to a page answering 429 or 5xx is unknown, not broken', () => {
    expect(
      of(
        detectCanonicalMismatch(declaring(u('/c'), { path: '/c', status: 503, kind: 'status' })),
        '/p',
      ),
    ).toMatchObject({ state: 'indeterminate', reason: 'canonical_target_errored' });
  });

  it('detects a canonical to a URL robots.txt disallows', () => {
    expect(
      of(detectCanonicalMismatch(declaring(u('/c'), null, { robots: [u('/c')] })), '/p'),
    ).toMatchObject({
      state: 'detected',
      conditions: ['canonical_target_disallowed'],
    });
  });

  it('detects a canonical to another host, but not to the www sibling of this one', () => {
    expect(of(detectCanonicalMismatch(declaring('https://other.test/p')), '/p')).toMatchObject({
      state: 'detected',
      conditions: ['canonical_cross_host'],
    });
    expect(of(detectCanonicalMismatch(declaring('https://www.a.test/p')), '/p')).toMatchObject({
      state: 'indeterminate',
      reason: 'canonical_target_not_fetched',
    });
  });

  it('detects a canonical to a URL that is not itself canonical (a chain)', () => {
    expect(
      of(
        detectCanonicalMismatch(
          declaring(u('/c'), { path: '/c', facts: { canonical: { href: u('/d') } } }),
        ),
        '/p',
      ),
    ).toMatchObject({ state: 'detected', conditions: ['canonical_target_not_canonical'] });
  });

  it('detects a page linked internally under a URL that is not its canonical (truth vector)', () => {
    // Hand-computed: the canonical /c is sound, so a rule that only inspects the canonical's target
    // says not_detected; but the homepage links to /p, the non-canonical URL.
    const s = site([
      { path: '/', links: ['/p', '/c'], facts: self('/') },
      { path: '/p', facts: { canonical: { href: u('/c') } } },
      { path: '/c', facts: self('/c') },
    ]);
    const d = of(detectCanonicalMismatch(s), '/p');
    expect(d).toMatchObject({ state: 'detected', conditions: ['linked_under_non_canonical'] });
    expect(d!.evidence.edges).toEqual([{ from_url: u('/'), to_url: u('/p') }]);
  });

  it('a proven condition decides even when another is unknown', () => {
    const s = site([
      { path: '/', links: ['/p'], facts: self('/') },
      { path: '/p', facts: { canonical: { href: u('/never') } } },
    ]);
    expect(of(detectCanonicalMismatch(s), '/p')).toMatchObject({
      state: 'detected',
      conditions: ['linked_under_non_canonical'],
    });
  });

  it('is indeterminate when the canonical target was not fetched', () => {
    expect(of(detectCanonicalMismatch(declaring(u('/never'))), '/p')).toMatchObject({
      state: 'indeterminate',
      reason: 'canonical_target_not_fetched',
    });
  });

  it('is indeterminate when the canonical, or the target’s own canonical, was not read', () => {
    expect(of(detectCanonicalMismatch(site([{ path: '/' }, { path: '/p' }])), '/p')).toMatchObject({
      state: 'indeterminate',
      reason: 'canonical_not_read',
    });
    expect(of(detectCanonicalMismatch(declaring(u('/c'), { path: '/c' })), '/p')).toMatchObject({
      state: 'indeterminate',
      reason: 'canonical_not_read',
    });
  });

  it('on a truncated crawl, an unlinked non-canonical page is not proven unlinked', () => {
    expect(
      of(
        detectCanonicalMismatch(declaring(u('/c'), { path: '/c', facts: self('/c') }, { cap: 3 })),
        '/p',
      ),
    ).toMatchObject({ state: 'indeterminate', reason: 'crawl_truncated' });
  });

  it('reports a gone page as gone and a linked uncrawled URL as not crawled', () => {
    const s = site([
      { path: '/', links: ['/x', '/never'], facts: self('/') },
      { path: '/x', status: 404, kind: 'status' },
    ]);
    expect(of(detectCanonicalMismatch(s), '/x')).toMatchObject({
      reason: 'page_gone',
      page_gone: { status_code: 404 },
    });
    expect(of(detectCanonicalMismatch(s), '/never')).toMatchObject({
      state: 'indeterminate',
      reason: 'not_crawled',
    });
  });
});
