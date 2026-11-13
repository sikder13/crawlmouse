import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { FingerprintSchema } from '@crawlmouse/types/v2';
import { median } from '../grade/numbers.js';
import { EMPTY_SHELL_BELOW, type JsTextState } from '../render/state.js';
import { fingerprintOf, subjectOfKey } from './fingerprint.js';
import { detectRendered, type RenderedInputPage } from './rendered.js';

const page = (
  url: string,
  template_key: string,
  render: [raw: number, rendered: number, state: JsTextState] | null,
  over: Partial<RenderedInputPage> = {},
): RenderedInputPage => ({
  url,
  template_key,
  kind: 'content',
  status_code: 200,
  is_html: true,
  without_js:
    render === null
      ? null
      : {
          raw_words: render[0],
          rendered_words: render[1],
          text_share: Math.min(1, render[0] / render[1]),
          state: render[2],
        },
  ...over,
});

const T = '/guides/{slug}';
const only = (pages: RenderedInputPage[]) => {
  const records = detectRendered(pages);
  expect(records).toHaveLength(1);
  return records[0]!;
};

describe('the client-rendered template detector', () => {
  it('detects a template whose every rendered page is an empty shell', () => {
    const r = only([
      page('https://a.test/guides/c', T, null),
      page('https://a.test/guides/b', T, [30, 200, 'empty_shell']),
      page('https://a.test/guides/a', T, [20, 200, 'empty_shell']),
    ]);
    expect(r).toEqual({
      type: 'client_rendered_template',
      key: `shell:${T}`,
      fingerprint: fingerprintOf(`shell:${T}`),
      template_key: T,
      state: 'detected',
      reason: null,
      measured: 0.125,
      extent: { pages: 3, graded: 3, rendered: 2 },
      affected_urls: [
        'https://a.test/guides/a',
        'https://a.test/guides/b',
        'https://a.test/guides/c',
      ],
      evidence: {
        pages: [
          { url: 'https://a.test/guides/a', raw_words: 20, rendered_words: 200, text_share: 0.1 },
          { url: 'https://a.test/guides/b', raw_words: 30, rendered_words: 200, text_share: 0.15 },
        ],
      },
    });
    expect(FingerprintSchema.safeParse(r.fingerprint).success).toBe(true);
    expect(subjectOfKey(r.key)).toBe(T);
  });

  it('reads the render step’s state, not the share: a page held a shell by hysteresis is one', () => {
    // 0.4 is above EMPTY_SHELL_BELOW; the render step kept it a shell because it was one last check
    expect(0.4).toBeGreaterThan(EMPTY_SHELL_BELOW);
    expect(only([page('https://a.test/guides/a', T, [80, 200, 'empty_shell'])]).state).toBe(
      'detected',
    );
    // and a share under the line that the render step did not call a shell is not one
    expect(only([page('https://a.test/guides/a', T, [20, 200, 'partial'])]).state).toBe(
      'not_detected',
    );
  });

  it('does not detect a template with a rendered page and no shell among them', () => {
    const r = only([
      page('https://a.test/guides/a', T, [200, 200, 'readable']),
      page('https://a.test/guides/b', T, [120, 200, 'partial']),
      page('https://a.test/guides/c', T, null),
    ]);
    expect(r).toMatchObject({
      state: 'not_detected',
      reason: null,
      measured: 0.8,
      extent: { pages: 3, rendered: 2 },
      affected_urls: [],
    });
    expect(r.evidence.pages.map((p) => p.url)).toEqual([
      'https://a.test/guides/a',
      'https://a.test/guides/b',
    ]);
  });

  it('cannot decide when the rendered pages disagree', () => {
    expect(
      only([
        page('https://a.test/guides/a', T, [200, 200, 'readable']),
        page('https://a.test/guides/b', T, [10, 200, 'empty_shell']),
      ]),
    ).toMatchObject({ state: 'indeterminate', reason: 'pages_disagree', affected_urls: [] });
  });

  it('cannot decide when no page of the template was rendered', () => {
    expect(
      only([page('https://a.test/guides/a', T, null), page('https://a.test/guides/b', T, null)]),
    ).toEqual({
      type: 'client_rendered_template',
      key: `shell:${T}`,
      fingerprint: fingerprintOf(`shell:${T}`),
      template_key: T,
      state: 'indeterminate',
      reason: 'not_rendered',
      measured: null,
      extent: { pages: 2, graded: 2, rendered: 0 },
      affected_urls: [],
      evidence: { pages: [] },
    });
  });

  it('judges graded pages only: a thin shell, an error or a non-HTML page gives no record', () => {
    const shell: [number, number, JsTextState] = [0, 200, 'empty_shell'];
    expect(
      detectRendered([
        page('https://a.test/guides/a', T, shell, { kind: 'thin' }),
        page('https://a.test/guides/b', T, shell, { status_code: 404 }),
        page('https://a.test/guides/c', T, shell, { is_html: false }),
      ]),
    ).toEqual([]);
  });

  it('gives one record per template, in key order', () => {
    const records = detectRendered([
      page('https://a.test/products/a', '/products/{slug}', [200, 200, 'readable']),
      page('https://a.test/guides/a', T, [10, 200, 'empty_shell']),
      page('https://a.test', '/', null),
    ]);
    expect(records.map((r) => [r.template_key, r.state])).toEqual([
      ['/', 'indeterminate'],
      [T, 'detected'],
      ['/products/{slug}', 'not_detected'],
    ]);
  });
});

describe('presence: a template with an empty-root page and no graded page (CC-32 D2)', () => {
  const shell: [number, number, JsTextState] = [0, 200, 'empty_shell'];
  const thin = { kind: 'thin' as const };
  const A = 'https://a.test/app/a';
  const B = 'https://a.test/app/b';
  const C = 'https://a.test/app/c';
  const app = '/app/{slug}';

  it('is present when the caller names its pages, and its rendered empty-root pages decide it', () => {
    const records = detectRendered(
      [page(A, app, shell, thin), page(B, app, null, thin), page(C, app, shell, thin)],
      { emptyRoots: new Set([A, B, C]) },
    );
    expect(records).toEqual([
      {
        type: 'client_rendered_template',
        key: `shell:${app}`,
        fingerprint: fingerprintOf(`shell:${app}`),
        template_key: app,
        state: 'detected',
        reason: null,
        measured: 0,
        extent: { pages: 3, graded: 0, rendered: 2 },
        affected_urls: [A, B, C],
        evidence: {
          pages: [
            { url: A, raw_words: 0, rendered_words: 200, text_share: 0 },
            { url: C, raw_words: 0, rendered_words: 200, text_share: 0 },
          ],
        },
      },
    ]);
  });

  it('is present and not_rendered when none of its pages was rendered', () => {
    const [r] = detectRendered([page(A, app, null, thin)], { emptyRoots: new Set([A]) });
    expect(r).toMatchObject({
      state: 'indeterminate',
      reason: 'not_rendered',
      extent: { pages: 1, rendered: 0 },
      affected_urls: [],
    });
  });

  it('counts only the pages named: a thin page not named is neither present nor read', () => {
    const [r] = detectRendered(
      [page(A, app, shell, thin), page(B, app, [200, 200, 'readable'], thin)],
      {
        emptyRoots: new Set([A]),
      },
    );
    expect(r).toMatchObject({
      state: 'detected',
      extent: { pages: 1, rendered: 1 },
      affected_urls: [A],
    });
  });

  it('a mixed template, graded pages with text and empty-root pages as shells, is pages_disagree', () => {
    const [r] = detectRendered(
      [page('https://a.test/app/text', app, [200, 200, 'readable']), page(A, app, shell, thin)],
      { emptyRoots: new Set([A]) },
    );
    expect(r).toMatchObject({
      state: 'indeterminate',
      reason: 'pages_disagree',
      extent: { pages: 2, graded: 1, rendered: 2 },
    });
  });
});

describe('a template an awaiting fix names, with no present page (CC-32 D3)', () => {
  const gone = '/gone/{slug}';

  it('gets an indeterminate record, template_absent, with no page', () => {
    expect(detectRendered([], { openTemplates: [gone] })).toEqual([
      {
        type: 'client_rendered_template',
        key: `shell:${gone}`,
        fingerprint: fingerprintOf(`shell:${gone}`),
        template_key: gone,
        state: 'indeterminate',
        reason: 'template_absent',
        measured: null,
        extent: { pages: 0, graded: 0, rendered: 0 },
        affected_urls: [],
        evidence: { pages: [] },
      },
    ]);
  });

  it('is absent when its only pages are neither graded nor empty-root pages', () => {
    const [r] = detectRendered(
      [page('https://a.test/gone/a', gone, [0, 200, 'empty_shell'], { kind: 'thin' })],
      { openTemplates: [gone] },
    );
    expect(r).toMatchObject({ state: 'indeterminate', reason: 'template_absent' });
  });

  it('takes the usual verdict when the template is present, once', () => {
    const records = detectRendered([page('https://a.test/gone/a', gone, [0, 200, 'empty_shell'])], {
      openTemplates: [gone, gone],
    });
    expect(records.map((r) => [r.template_key, r.state, r.reason])).toEqual([
      [gone, 'detected', null],
    ]);
  });

  it('sits in template-key order among the present templates', () => {
    const records = detectRendered([page('https://a.test/a/1', '/a/{slug}', null)], {
      openTemplates: ['/z/{slug}', '/0/{slug}'],
    });
    expect(records.map((r) => [r.template_key, r.reason])).toEqual([
      ['/0/{slug}', 'template_absent'],
      ['/a/{slug}', 'not_rendered'],
      ['/z/{slug}', 'template_absent'],
    ]);
  });
});

describe('the client-rendered template detector (properties)', () => {
  const state = fc.constantFrom<JsTextState>('empty_shell', 'partial', 'readable');
  const pages = fc.uniqueArray(
    fc.record({
      path: fc.integer({ min: 0, max: 400 }),
      template: fc.constantFrom('/a/{slug}', '/b/{slug}', '/c/{slug}'),
      graded: fc.boolean(),
      render: fc.option(fc.tuple(fc.integer({ min: 0, max: 300 }), fc.constant(300), state)),
    }),
    { selector: (p) => p.path, maxLength: 30 },
  );
  const built = pages.map((ps) =>
    ps.map((p) =>
      page(`https://a.test/${p.path}`, p.template, p.render, {
        kind: p.graded ? 'content' : 'thin',
      }),
    ),
  );

  it('states each template of the graded pages once, by the rule, whatever the order', () => {
    fc.assert(
      fc.property(built, (ps) => {
        const records = detectRendered(ps);
        expect(JSON.stringify(detectRendered([...ps].reverse()))).toBe(JSON.stringify(records));
        const graded = ps.filter((p) => p.kind === 'content');
        expect(records.map((r) => r.template_key)).toEqual(
          [...new Set(graded.map((p) => p.template_key))].sort(),
        );
        for (const r of records) {
          const mine = graded.filter((p) => p.template_key === r.template_key);
          const rendered = mine.flatMap((p) => (p.without_js ? [p.without_js] : []));
          const shells = rendered.filter((w) => w.state === 'empty_shell').length;
          const expected =
            rendered.length === 0
              ? ['indeterminate', 'not_rendered']
              : shells === rendered.length
                ? ['detected', null]
                : shells === 0
                  ? ['not_detected', null]
                  : ['indeterminate', 'pages_disagree'];
          expect([r.state, r.reason]).toEqual(expected);
          expect(r.extent).toEqual({
            pages: mine.length,
            graded: mine.length,
            rendered: rendered.length,
          });
          expect(r.measured).toBe(
            rendered.length === 0 ? null : median(rendered.map((w) => w.text_share)),
          );
          expect(r.affected_urls).toEqual(
            r.state === 'detected' ? mine.map((p) => p.url).sort() : [],
          );
          expect(r.evidence.pages).toHaveLength(rendered.length);
        }
      }),
    );
  });
});
