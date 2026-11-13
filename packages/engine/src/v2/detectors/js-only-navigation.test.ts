/**
 * The JS-only navigation detector over hand-written pages and render links. Every expected record is
 * written out by hand from the pages above it.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { RenderLinks } from '../render/links.js';
import { fingerprintOf } from './fingerprint.js';
import {
  detectJsOnlyNavigation,
  MAX_JS_ONLY_TARGETS,
  type JsOnlyDetection,
} from './js-only-navigation.js';
import type { RenderedInputPage } from './rendered.js';

const T = '/products/{slug}';
const at = (path: string) => `https://shop.test${path}`;

const page = (
  path: string,
  rendered = true,
  over: Partial<RenderedInputPage> = {},
): RenderedInputPage => ({
  url: at(path),
  template_key: T,
  kind: 'content',
  status_code: 200,
  is_html: true,
  without_js: rendered
    ? { raw_words: 100, rendered_words: 100, text_share: 1, state: 'readable' }
    : null,
  ...over,
});

const links = (statics: string[], rendered: string[], truncated = false): RenderLinks => ({
  static: statics.map(at).sort(),
  rendered: rendered.map(at).sort(),
  truncated,
});

const only = (
  pages: RenderedInputPage[],
  byUrl: Record<string, RenderLinks>,
  context: Parameters<typeof detectJsOnlyNavigation>[2] = {},
): JsOnlyDetection => {
  const records = detectJsOnlyNavigation(pages, new Map(Object.entries(byUrl)), context);
  expect(records).toHaveLength(1);
  return records[0]!;
};

const KEY = `jsnav:${T}`;

describe('the JS-only navigation detector', () => {
  it('detects a template whose every evidence page links somewhere only once rendered', () => {
    const r = only([page('/products/b'), page('/products/a'), page('/products/c', false)], {
      [at('/products/a')]: links(['/', '/shop'], ['/', '/shop', '/guides/x', '/guides/y']),
      [at('/products/b')]: links(['/'], ['/guides/x', '/']),
    });
    expect(r).toEqual({
      type: 'js_only_navigation',
      fingerprint: fingerprintOf(KEY),
      key: KEY,
      template_key: T,
      state: 'detected',
      reason: null,
      extent: { pages: 3, graded: 3, rendered: 2 },
      affected_urls: [at('/products/a'), at('/products/b'), at('/products/c')],
      evidence: {
        pages: [
          {
            url: at('/products/a'),
            js_only_count: 2,
            js_only_targets: [at('/guides/x'), at('/guides/y')],
          },
          { url: at('/products/b'), js_only_count: 1, js_only_targets: [at('/guides/x')] },
        ],
      },
    });
  });

  it('does not detect a template whose rendered links are all in the static HTML', () => {
    const r = only([page('/products/a')], {
      // A link only the static side has is not a JS-only one.
      [at('/products/a')]: links(['/', '/shop', '/noscript-only'], ['/shop', '/']),
    });
    expect(r).toMatchObject({ state: 'not_detected', reason: null, affected_urls: [] });
    expect(r.evidence.pages).toEqual([
      { url: at('/products/a'), js_only_count: 0, js_only_targets: [] },
    ]);
  });

  it('cannot decide when the evidence pages disagree', () => {
    const r = only([page('/products/a'), page('/products/b')], {
      [at('/products/a')]: links(['/'], ['/', '/guides/x']),
      [at('/products/b')]: links(['/'], ['/']),
    });
    expect(r).toMatchObject({ state: 'indeterminate', reason: 'pages_disagree' });
    expect(r.affected_urls).toEqual([]);
  });

  it('takes no evidence from a page with a truncated side, or with no links, and is then not_rendered', () => {
    const pages = [page('/products/a'), page('/products/b')];
    const r = only(pages, {
      [at('/products/a')]: links(['/'], ['/', '/guides/x'], true),
      // /products/b was rendered on an outcome stored before links were kept: none in the map.
    });
    expect(r).toMatchObject({
      state: 'indeterminate',
      reason: 'not_rendered',
      extent: { pages: 2, graded: 2, rendered: 0 },
      evidence: { pages: [] },
    });
    // The page with whole lists decides alone.
    const decided = only(pages, {
      [at('/products/a')]: links(['/'], ['/', '/guides/x'], true),
      [at('/products/b')]: links(['/'], ['/', '/guides/z']),
    });
    expect(decided).toMatchObject({ state: 'detected', extent: { rendered: 1 } });
    expect(decided.evidence.pages.map((p) => p.url)).toEqual([at('/products/b')]);
  });

  it('reads no links for a page the render did not measure', () => {
    const r = only([page('/products/a', false)], {
      [at('/products/a')]: links([], ['/guides/x']),
    });
    expect(r).toMatchObject({ state: 'indeterminate', reason: 'not_rendered' });
  });

  it(`keeps at most ${MAX_JS_ONLY_TARGETS} targets a page, the first sorted, and counts them all`, () => {
    const targets = Array.from(
      { length: MAX_JS_ONLY_TARGETS + 3 },
      (_, i) => `/g/${String(i).padStart(2, '0')}`,
    );
    const r = only([page('/products/a')], { [at('/products/a')]: links([], targets) });
    expect(r.evidence.pages[0]!.js_only_count).toBe(MAX_JS_ONLY_TARGETS + 3);
    expect(r.evidence.pages[0]!.js_only_targets).toEqual(
      targets.slice(0, MAX_JS_ONLY_TARGETS).map(at),
    );
  });

  it('decides a template with graded pages from them alone, and a template of empty-root pages from those', () => {
    const shell = (path: string) => page(path, true, { kind: 'thin', template_key: '/app/{slug}' });
    const records = detectJsOnlyNavigation(
      [page('/products/a'), page('/products/b', true, { kind: 'thin' }), shell('/app/x')],
      new Map([
        [at('/products/a'), links(['/'], ['/'])],
        [at('/products/b'), links(['/'], ['/', '/guides/x'])],
        [at('/app/x'), links([], ['/app/y'])],
      ]),
      { emptyRoots: new Set([at('/products/b'), at('/app/x')]) },
    );
    expect(records.map((r) => [r.template_key, r.state, r.extent])).toEqual([
      ['/app/{slug}', 'detected', { pages: 1, graded: 0, rendered: 1 }],
      [T, 'not_detected', { pages: 2, graded: 1, rendered: 1 }],
    ]);
  });

  it('gives a template an awaiting fix names, with no present page, an indeterminate record', () => {
    const records = detectJsOnlyNavigation([], new Map(), { openTemplates: ['/gone/{slug}'] });
    expect(records).toEqual([
      {
        type: 'js_only_navigation',
        fingerprint: fingerprintOf('jsnav:/gone/{slug}'),
        key: 'jsnav:/gone/{slug}',
        template_key: '/gone/{slug}',
        state: 'indeterminate',
        reason: 'template_absent',
        extent: { pages: 0, graded: 0, rendered: 0 },
        affected_urls: [],
        evidence: { pages: [] },
      },
    ]);
  });

  it('never calls a target JS-only when the static side links to it too (property)', () => {
    const path = fc.constantFrom('/', '/a', '/b', '/c', '/d', '/e');
    fc.assert(
      fc.property(fc.array(path), fc.array(path), (statics, rendered) => {
        const s = [...new Set(statics)];
        const r = [...new Set(rendered)];
        const record = only([page('/products/a')], { [at('/products/a')]: links(s, r) });
        const found = record.evidence.pages[0]!.js_only_targets;
        for (const t of found) expect(s.map(at)).not.toContain(t);
        // and every rendered target the static side lacks is found
        expect(found).toEqual(
          r
            .filter((x) => !s.includes(x))
            .map(at)
            .sort(),
        );
      }),
    );
  });
});
