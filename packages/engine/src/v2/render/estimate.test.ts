import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { siteEstimate, type GradedPageShare } from './estimate.js';

const pages = (template_key: string, shares: (number | null)[]): GradedPageShare[] =>
  shares.map((text_share) => ({ template_key, text_share }));

describe('the site estimate', () => {
  // A: six graded pages, three rendered (0.2, 0.4, 0.9 → median 0.4).
  // B: four graded pages, one rendered (1.0). C: ten graded pages, none rendered.
  const input = [
    ...pages('/a/{slug}', [0.2, 0.9, 0.4, null, null, null]),
    ...pages('/b/{slug}', [1, null, null, null]),
    ...pages('/c/{slug}', Array(10).fill(null)),
  ];

  it('weights each rendered template’s median by its graded pages, over rendered templates only', () => {
    // By hand: (6 × 0.4 + 4 × 1.0) / (6 + 4) = 6.4 / 10.
    expect(siteEstimate(input).site_text_share).toBeCloseTo(0.64, 12);
  });

  it('counts what it was estimated from, and says so', () => {
    expect(siteEstimate(input)).toMatchObject({
      rendered_pages: 4,
      templates_rendered: 2,
      templates_total: 3,
      single_render_weight: 0.4,
      label:
        'estimated from 4 rendered pages across 2 of 3 templates; 50 % of graded pages are in templates not rendered; 40 % of the estimate rests on one rendered page per template',
    });
  });

  it('exposes the unrendered share, from which Readable’s range follows', () => {
    const e = siteEstimate(input);
    // By hand: ten of twenty graded pages sit in a template with no rendered page.
    expect(e.unrendered_share).toBe(0.5);
    // Readable over these pages, computed by hand from its formula (30 × Σ pages(t) × ratio(t) / Σ pages),
    // with the unrendered template at 0 and at 1: 30 × 6.4 / 20 = 9.6 and 30 × 16.4 / 20 = 24.6.
    const low = 30 * e.site_text_share! * (1 - e.unrendered_share);
    const high = low + 30 * e.unrendered_share;
    expect(low).toBeCloseTo(9.6, 12);
    expect(high).toBeCloseTo(24.6, 12);
  });

  it('takes the mean of the middle two shares of an even count', () => {
    expect(siteEstimate(pages('/t', [0.2, 0.4])).site_text_share).toBeCloseTo(0.3, 12);
  });

  it('says one page and one template in the singular', () => {
    expect(siteEstimate(pages('/t', [0.5])).label).toBe(
      'estimated from 1 rendered page across 1 of 1 template; 100 % of the estimate rests on one rendered page per template',
    );
  });

  it('has no share and no label when nothing was rendered, and counts every page unrendered', () => {
    expect(siteEstimate(pages('/t', [null, null]))).toEqual({
      site_text_share: null,
      rendered_pages: 0,
      templates_rendered: 0,
      templates_total: 1,
      unrendered_share: 1,
      single_render_weight: 0,
      label: null,
    });
  });

  it('counts nothing graded as entirely unrendered, so Readable’s range is the whole scale', () => {
    expect(siteEstimate([])).toEqual({
      site_text_share: null,
      rendered_pages: 0,
      templates_rendered: 0,
      templates_total: 0,
      unrendered_share: 1,
      single_render_weight: 0,
      label: null,
    });
  });
});

describe('a site whose estimate rests on little', () => {
  it('says so when one rendered page stands for a site whose graded pages are almost all unrendered', () => {
    const e = siteEstimate([...pages('/', [1]), ...pages('/p/{slug}', Array(1000).fill(null))]);
    expect(e.site_text_share).toBe(1);
    expect(e.label).toBe(
      'estimated from 1 rendered page across 1 of 2 templates; >99 % of graded pages are in templates not rendered; 100 % of the estimate rests on one rendered page per template',
    );
  });

  it('says how much of the estimate one page per template carries', () => {
    // 400 graded pages with one rendered, and a 10-page template with ten rendered: 400 / 410.
    const e = siteEstimate([
      ...pages('/big', [1, ...Array(399).fill(null)]),
      ...pages('/small', Array(10).fill(0)),
    ]);
    expect(e.single_render_weight).toBeCloseTo(400 / 410, 12);
    expect(e.label).toContain('98 % of the estimate rests on one rendered page per template');
    expect(e.label).not.toContain('templates not rendered');
  });

  it('never rounds a part that is there down to 0 %', () => {
    const e = siteEstimate([
      ...pages('/a', [0.5, 0.5]),
      ...pages('/a', Array(998).fill(null)),
      ...pages('/b', [null]),
    ]);
    expect(e.label).toContain('<1 % of graded pages are in templates not rendered');
  });
});

describe('the site estimate, over any graded pages', () => {
  const share = fc.option(fc.double({ min: 0, max: 1, noNaN: true }), { nil: null });
  const graded = fc.array(
    fc.record({ template_key: fc.constantFrom('/', '/a', '/b', '/c'), text_share: share }),
    { maxLength: 50 },
  );

  it('lies between the lowest and highest rendered share', () => {
    fc.assert(
      fc.property(graded, (ps) => {
        const shares = ps.flatMap((p) => (p.text_share === null ? [] : [p.text_share]));
        const s = siteEstimate(ps).site_text_share;
        if (shares.length === 0) {
          expect(s).toBeNull();
        } else {
          expect(s!).toBeGreaterThanOrEqual(Math.min(...shares) - 1e-12);
          expect(s!).toBeLessThanOrEqual(Math.max(...shares) + 1e-12);
        }
      }),
    );
  });

  it('names exactly the rendered pages and templates the input holds', () => {
    fc.assert(
      fc.property(graded, (ps) => {
        const e = siteEstimate(ps);
        const rendered = ps.filter((p) => p.text_share !== null);
        expect(e.rendered_pages).toBe(rendered.length);
        expect(e.templates_rendered).toBe(new Set(rendered.map((p) => p.template_key)).size);
        expect(e.templates_total).toBe(new Set(ps.map((p) => p.template_key)).size);
        if (e.label !== null) {
          expect(e.label).toContain(`${e.rendered_pages} rendered page`);
          expect(e.label).toContain(`${e.templates_rendered} of ${e.templates_total} template`);
        }
      }),
    );
  });
});
