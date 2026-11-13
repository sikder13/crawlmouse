/**
 * The client-rendered template fix: its counterfactual (the template's pages read in full), its
 * effect by the Readable formula worked by hand, and its outcome.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { PageResult } from '@crawlmouse/types/v2';
import { every } from '../../../fixtures/v2/access/builders.js';
import { blogSite, type Cells } from '../../../fixtures/v2/grade/sites.js';
import { detectRendered } from '../detectors/rendered.js';
import type { JsTextState } from '../render/state.js';
import { applyFix, effectsOf, type FixRecord } from './effects.js';
import { aiFrom, gradeCheck, type Grades } from './index.js';
import { round } from './numbers.js';
import {
  detectorOutcomes,
  NOTHING_WRITTEN,
  RENDERED_CLASS,
  renderedConfidence,
} from './outcomes.js';
import { PAGES_PER_FIX_TEMPLATE } from '../render/sample.js';
import { readableScore } from './readable.js';

type Render = [share: number, state: JsTextState] | null;

/** Quotable as it will read once a check counts, so AI readability is given and effects are stated. */
const QUOTABLE_SCORED = { checks: { author_and_date: { passing: 1, decided: 1, unread: 0 } } };

/**
 * A homepage rendered in full and `posts.length` posts of `/blog/{slug}`, each rendered as given
 * (null: not rendered), with Quotable scored.
 */
function site(posts: readonly Render[], cells: Cells = {}) {
  const { input, access } = blogSite(posts.length, 0, cells);
  const pages: PageResult[] = input.pages.map((p) => {
    const i = Number(p.url.match(/\/blog\/post-(\d+)$/)?.[1] ?? -1);
    const r = i === -1 ? null : posts[i]!;
    if (i === -1) return p;
    return {
      ...p,
      without_js:
        r === null
          ? null
          : {
              raw_words: Math.round(r[0] * 1000),
              rendered_words: 1000,
              text_share: r[0],
              state: r[1],
            },
    };
  });
  const g = gradeCheck({ ...input, pages });
  const inputs = { ...g.inputs, ai: { ...g.inputs.ai, quotable: QUOTABLE_SCORED } };
  const grades: Grades = { ...g, inputs, ai_readability: aiFrom(inputs.ai) };
  const rendered = detectRendered(pages);
  return {
    input: { ...input, pages },
    access,
    grades,
    rendered,
    ...detectorOutcomes(grades, access, input.structure, rendered, NOTHING_WRITTEN),
  };
}

const SHELL: JsTextState = 'empty_shell';
const fixesOf = (o: ReturnType<typeof site>['outcomes']) =>
  o.flatMap((x) => (x.state === 'detected' ? [{ fingerprint: x.fingerprint, ...x.fix }] : []));

describe('the client-rendered template fix', () => {
  it('five posts, two rendered as shells at 0.1 and 0.2: Readable 8.75 → 30, so +21.25 AI readability and no Technical SEO', () => {
    const s = site([[0.1, SHELL], [0.2, SHELL], null, null, null]);
    // before: 30 × (1 × 1 + 5 × median(0.1, 0.2)) / 6 = 8.75; after: 30
    expect(s.grades.ai_readability.components.readable.score).toBe(8.75);
    const [fix] = fixesOf(s.outcomes).filter((f) => f.type === 'client_rendered_template');
    expect(fix!.effect).toEqual({
      technical_seo: 0,
      technical_seo_pending_on: [],
      ai_readability: 21.25,
      ai_readability_pending_on: [],
      absorbed_by: null,
      estimate: true,
    });
  });

  it('gives every graded page of the template a share of 1, rendered or not, and no other page', () => {
    const s = site([[0.1, SHELL], null, null]);
    const record = s.rendered.find((r) => r.state === 'detected')!;
    // the homepage, of another template, read at half: a counterfactual that touched it would show
    const inputs = {
      ...s.grades.inputs,
      ai: {
        ...s.grades.inputs.ai,
        readable: s.grades.inputs.ai.readable.map((p) =>
          p.template_key === '/' ? { ...p, text_share: 0.5 } : p,
        ),
      },
    };
    const after = applyFix(inputs, { family: 'rendered', record });
    expect(after.ai.readable.filter((p) => p.template_key === '/')).toEqual([
      { template_key: '/', text_share: 0.5 },
    ]);
    expect(after.seo).toBe(s.grades.inputs.seo);
    expect(after.ai.readable).toEqual(
      inputs.ai.readable.map((p) =>
        p.template_key === '/blog/{slug}' ? { ...p, text_share: 1 } : p,
      ),
    );
    expect(after.ai.readable.filter((p) => p.template_key === '/blog/{slug}')).toHaveLength(3);
    expect({ ...after.ai, readable: null }).toEqual({ ...s.grades.inputs.ai, readable: null });
  });

  it('has no counterfactual for js_only_navigation: the fix type is not opened', () => {
    const s = site([[0.1, SHELL]]);
    const record = {
      ...s.rendered.find((r) => r.state === 'detected')!,
      type: 'js_only_navigation' as const,
    };
    expect(() => applyFix(s.grades.inputs, { family: 'rendered', record })).toThrow(
      /no counterfactual for js_only_navigation/,
    );
  });

  it('opens with its template, its section and no crawler; confirmed once two pages were rendered', () => {
    const two = fixesOf(site([[0.1, SHELL], [0.2, SHELL], null]).outcomes).find(
      (f) => f.type === 'client_rendered_template',
    )!;
    expect(two).toMatchObject({
      section: 'without_js',
      title: 'Serve the text of blog posts without JavaScript',
      template_key: '/blog/{slug}',
      crawler_uas: [],
      affected_pages: 3,
      recommendation_class: RENDERED_CLASS,
      confidence: 'confirmed',
    });
    const one = fixesOf(site([[0.1, SHELL], null, null]).outcomes).find(
      (f) => f.type === 'client_rendered_template',
    )!;
    expect(one.confidence).toBe('likely');
  });

  it('is a best practice: no operator of a tested crawler documents the rule', () => {
    expect(RENDERED_CLASS).toBe('best_practice');
  });

  it('is confirmed when every graded page of the template was rendered, however few', () => {
    const extent = (pages: number, rendered: number) => ({
      extent: { pages, graded: pages, rendered },
    });
    expect(PAGES_PER_FIX_TEMPLATE).toBe(2);
    expect(renderedConfidence(extent(1, 1))).toBe('confirmed');
    expect(renderedConfidence(extent(2, 1))).toBe('likely');
    expect(renderedConfidence(extent(2, 2))).toBe('confirmed');
    expect(renderedConfidence(extent(40, 1))).toBe('likely');
    expect(renderedConfidence(extent(40, 2))).toBe('confirmed');
    // through the outcomes: a template of one graded page, rendered
    const only = fixesOf(site([[0.1, SHELL]]).outcomes).find(
      (f) => f.type === 'client_rendered_template',
    )!;
    expect(only.affected_pages).toBe(1);
    expect(only.confidence).toBe('confirmed');
  });

  it('gives an outcome for every record: not detected, and indeterminate with no gone page', () => {
    const readable = site([[1, 'readable'], null]);
    const template = (s: ReturnType<typeof site>) =>
      s.outcomes.find(
        (o) =>
          o.fingerprint === s.rendered.find((r) => r.template_key === '/blog/{slug}')!.fingerprint,
      );
    expect(template(readable)).toEqual({
      fingerprint: expect.any(String) as string,
      state: 'not_detected',
    });
    for (const s of [
      site([null, null]),
      site([
        [0.1, SHELL],
        [1, 'readable'],
      ]),
    ]) {
      expect(template(s)).toEqual({
        fingerprint: expect.any(String) as string,
        state: 'indeterminate',
        gone: null,
      });
    }
    expect(fixesOf(readable.outcomes).map((f) => f.type)).not.toContain('client_rendered_template');
  });
});

describe('the client-rendered template fix (properties)', () => {
  const render: fc.Arbitrary<Render> = fc.option(
    fc.tuple(
      fc.integer({ min: 0, max: 100 }).map((n) => n / 100),
      fc.constantFrom<JsTextState>('empty_shell', 'empty_shell', 'partial', 'readable'),
    ),
  );
  const sites = fc.tuple(
    fc.array(render, { minLength: 1, maxLength: 8 }),
    fc.constantFrom<Cells>({}, { PerplexityBot: every(2, 'blocked_by_ua_rule') }),
  );

  it('its effect applied alone is the Readable recompute, and never lowers AI readability', () => {
    fc.assert(
      fc.property(sites, ([posts, cells]) => {
        const s = site(posts, cells);
        for (const record of s.rendered.filter((r) => r.state === 'detected')) {
          const fix: FixRecord = { family: 'rendered', record };
          const { byFix } = effectsOf(s.grades.inputs, [fix]);
          const before = readableScore(s.grades.inputs.ai.readable);
          const after = readableScore(applyFix(s.grades.inputs, fix).ai.readable);
          const e = byFix.get(record.fingerprint)!.effect;
          // null on a site too small to grade (the grade is refused); it never moves otherwise
          expect(e.technical_seo ?? 0).toBe(0);
          if (before.score !== null && after.score !== null && e.ai_readability !== null) {
            expect(e.ai_readability).toBe(round(after.score - before.score));
            expect(e.ai_readability).toBeGreaterThanOrEqual(0);
          } else {
            // Readable is a range before or after (a template not rendered), so the effect waits
            expect(e.ai_readability).toBe(null);
            expect(e.ai_readability_pending_on).toContain('readable_unmeasured');
          }
        }
      }),
    );
  });

  it('the effects still add up to the overview, with the other fixes of the site', () => {
    fc.assert(
      fc.property(sites, ([posts, cells]) => {
        const s = site(posts, cells);
        const fixes = fixesOf(s.outcomes);
        const sum = (k: 'technical_seo' | 'ai_readability') =>
          round(fixes.reduce((n, f) => n + (f.effect[k] ?? 0), 0));
        if (s.overview.technical_seo !== null)
          expect(sum('technical_seo')).toBe(s.overview.technical_seo);
        if (s.overview.ai_readability !== null) {
          expect(sum('ai_readability')).toBe(s.overview.ai_readability);
        }
        expect(fixes.map((f) => f.rank).sort((a, b) => a - b)).toEqual(fixes.map((_, i) => i + 1));
      }),
    );
  });
});

describe('a shell-only template fix (owner ruling on CC-32 Q8)', () => {
  /** A template of three empty-root pages, two rendered as shells: no graded page. */
  const shell = () => {
    const urls = ['https://a.test/app/a', 'https://a.test/app/b', 'https://a.test/app/c'];
    const [record] = detectRendered(
      urls.map((url, i) => ({
        url,
        template_key: '/app/{slug}',
        kind: 'thin' as const,
        status_code: 200,
        is_html: true,
        without_js:
          i < 2 ? { raw_words: 0, rendered_words: 400, text_share: 0, state: SHELL } : null,
      })),
      { emptyRoots: new Set(urls) },
    );
    expect(record).toMatchObject({ state: 'detected', extent: { pages: 3, graded: 0 } });
    return record!;
  };

  it('ranks first, beside a fix with a large grade effect, and moves no effect, rank order or overview of the others', () => {
    const s = site([[0.1, SHELL], [0.2, SHELL], null, null, null]);
    const shellRecord = shell();
    const { access } = s;
    const structure = s.input.structure;
    const without = detectorOutcomes(s.grades, access, structure, s.rendered, NOTHING_WRITTEN);
    const withShell = detectorOutcomes(
      s.grades,
      access,
      structure,
      [...s.rendered, shellRecord],
      NOTHING_WRITTEN,
    );
    const before = fixesOf(without.outcomes);
    const after = fixesOf(withShell.outcomes);
    const blog = after.find((f) => f.template_key === '/blog/{slug}')!;
    expect(blog.effect.ai_readability).toBe(21.25);
    const shellFix = after.find((f) => f.fingerprint === shellRecord.fingerprint)!;
    expect(shellFix.rank).toBe(1);
    expect(shellFix.effect).toMatchObject({ technical_seo: 0, ai_readability: 0 });
    for (const f of before) {
      const same = after.find((g) => g.fingerprint === f.fingerprint)!;
      expect(same.effect, f.type).toEqual(f.effect);
      expect(same.rank, f.type).toBe(f.rank + 1);
      expect(same.absorbed_by_fingerprint, f.type).toBe(f.absorbed_by_fingerprint);
    }
    expect(withShell.overview).toEqual(without.overview);
  });

  it('is first only when its template has no graded page: a template with one ranks by its effect', () => {
    const s = site([[0.1, SHELL], [0.2, SHELL], null, null, null]);
    const graded = { ...shell(), extent: { pages: 3, graded: 1, rendered: 2 } };
    const fixes = effectsOf(s.grades.inputs, [
      { family: 'rendered', record: s.rendered.find((r) => r.state === 'detected')! },
      { family: 'rendered', record: graded },
    ]);
    expect(fixes.byFix.get(graded.fingerprint)!.rank).toBe(2);
  });
});
