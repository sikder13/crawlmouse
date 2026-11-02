import { describe, expect, it } from 'vitest';
import { searchVerdicts, site, u, type PageSpec } from '../../../fixtures/v2/detectors/builders.js';
import { SEARCH_ENGINES } from './scope.js';
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

  it('detects a canonical to a redirect the crawl stopped at', () => {
    const d = of(
      detectCanonicalMismatch(declaring(u('/c'), { path: '/c', status: 301, kind: 'status' })),
      '/p',
    );
    expect(d).toMatchObject({ state: 'detected', conditions: ['canonical_target_redirects'] });
    expect(d!.evidence.pages).toEqual([u('/c'), u('/p')]);
  });

  it('detects a canonical to a URL whose request landed elsewhere (the worker’s redirect shape)', () => {
    // /old answered 200 after redirecting to /new: PageResult carries the final status.
    const s = declaring(u('/old'), {
      path: '/old',
      facts: { final_url: u('/new'), canonical: { href: u('/new') } },
    });
    expect(of(detectCanonicalMismatch(s), '/p')).toMatchObject({
      state: 'detected',
      conditions: ['canonical_target_redirects'],
    });
  });

  it('reads a final URL as the server wrote it in the engine’s spelling (a trailing slash is not a redirect)', () => {
    // A WordPress site: /p declares /c/ and /c answered at /c/. Both canonicalise to /c.
    const s = site([
      { path: '/', facts: self('/') },
      { path: '/p', facts: { final_url: `${u('/p')}/`, canonical: { href: `${u('/c')}/` } } },
      { path: '/c', facts: { final_url: `${u('/c')}/`, canonical: { href: `${u('/c')}/` } } },
    ]);
    expect(of(detectCanonicalMismatch(s), '/p')).toMatchObject({
      state: 'not_detected',
      conditions: [],
    });
    expect(of(detectCanonicalMismatch(s), '/c')).toMatchObject({ state: 'not_detected' });
  });

  it('a final URL that does not parse cannot reach the detectors: the contract refuses it', () => {
    expect(() =>
      declaring(u('/c'), {
        path: '/c',
        facts: { final_url: 'http://[bad', canonical: { href: u('/c') } },
      }),
    ).toThrow(/final_url/);
  });

  it('detects a canonical to a gone page', () => {
    expect(
      of(
        detectCanonicalMismatch(declaring(u('/c'), { path: '/c', status: 410, kind: 'status' })),
        '/p',
      ),
    ).toMatchObject({ state: 'detected', conditions: ['canonical_target_gone'] });
  });

  it('reads a canonical target at the URL another request landed on', () => {
    // /p's canonical is /new, which was read when /old's request landed there; /new is self-canonical.
    const s = declaring(u('/new'), {
      path: '/old',
      facts: { final_url: u('/new'), canonical: { href: u('/new') } },
    });
    // Nothing links to /p, and the homepage links to /old: only the absence of a link is left.
    expect(of(detectCanonicalMismatch(s), '/p')).toMatchObject({
      state: 'not_detected',
      evidence: { pages: [u('/old'), u('/p')] },
    });
  });

  it('a canonical to a page that kept its content from us is unknown, not broken', () => {
    for (const status of [401, 403, 429, 503]) {
      expect(
        of(
          detectCanonicalMismatch(declaring(u('/c'), { path: '/c', status, kind: 'status' })),
          '/p',
        ),
        String(status),
      ).toMatchObject({ state: 'indeterminate', reason: 'canonical_target_not_read' });
    }
  });

  it('does not judge a page whose request landed elsewhere: that is a redirect, not a canonical', () => {
    // /old redirects to /new and carries /new's canonical; the homepage links to /old.
    const s = site([
      { path: '/', links: ['/old'], facts: self('/') },
      { path: '/old', facts: { final_url: u('/new'), canonical: { href: u('/new') } } },
    ]);
    expect(of(detectCanonicalMismatch(s), '/old')).toBeUndefined();
  });

  it('is indeterminate when where the request ended was not recorded', () => {
    const s = site([
      { path: '/', facts: self('/') },
      { path: '/p', facts: { final_url: null, canonical: { href: u('/p') } } },
    ]);
    expect(of(detectCanonicalMismatch(s), '/p')).toMatchObject({
      state: 'indeterminate',
      reason: 'canonical_not_read',
    });
  });

  it('is indeterminate, not an error, for a canonical href that is not a URL', () => {
    expect(of(detectCanonicalMismatch(declaring('not a url')), '/p')).toMatchObject({
      state: 'indeterminate',
      reason: 'canonical_not_read',
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

  it('reads no robots.txt verdict for a target that is only where another request landed', () => {
    // /old redirected to /new; robots.txt disallows /old for every search engine, not /new. /p
    // declares /new. The verdicts on /old's row are /old's, not /new's.
    const input = site([
      { path: '/' },
      { path: '/p', facts: { canonical: { href: u('/new') } } },
      {
        path: '/old',
        facts: { final_url: u('/new'), canonical: { href: u('/new') } },
        robots_search: searchVerdicts(SEARCH_ENGINES),
      },
    ]);
    expect(of(detectCanonicalMismatch(input), '/p')?.conditions ?? []).not.toContain(
      'canonical_target_disallowed',
    );
  });
});
