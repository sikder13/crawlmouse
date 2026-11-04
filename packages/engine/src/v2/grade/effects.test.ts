/**
 * Fix effects by counterfactual recompute: the exact values the formula table gives, the effects
 * adding up to the projected grades, and what a respected-intent robots.txt disallow does (nothing).
 */
import { EffectSchema } from '@crawlmouse/types/v2';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { every } from '../../../fixtures/v2/access/builders.js';
import { blogSite, type Cells } from '../../../fixtures/v2/grade/sites.js';
import type { PageSpec } from '../../../fixtures/v2/detectors/builders.js';
import { applyFix, effectsOf } from './effects.js';
import { technicalSeo } from './technical-seo.js';
import { gradeCheck } from './index.js';
import { detectorOutcomes } from './outcomes.js';

function blog(n: number, unanswered: number, cells: Cells = {}, extra: PageSpec[] = []) {
  const { input, access } = blogSite(n, unanswered, cells, extra);
  const grades = gradeCheck(input);
  return { grades, ...detectorOutcomes(grades, access, input.structure) };
}

const fixes = (o: ReturnType<typeof blog>['outcomes']) =>
  o.flatMap((x) => (x.state === 'detected' ? [x.fix] : []));
const blocked = every(2, 'blocked_by_ua_rule');

describe('the access fix', () => {
  it('fully unblocking one of four scored crawlers is exactly +10.00 AI readability, and no Technical SEO', () => {
    const { outcomes } = blog(6, 0, { PerplexityBot: blocked, 'Claude-SearchBot': blocked });
    const edge = fixes(outcomes).filter((f) => f.type === 'edge_rule_blocks_crawler');
    expect(edge.map((f) => f.crawler_uas[0]).sort()).toEqual(['Claude-SearchBot', 'PerplexityBot']);
    for (const f of edge) {
      expect(f.effect).toEqual({
        technical_seo: 0,
        ai_readability: 10,
        ai_readability_pending_on: [],
        estimate: true,
      });
    }
  });

  it('with Access withheld (one scored crawler measured), the AI effect waits on that reason', () => {
    const refused = every(2, 'refused_unverified');
    const { outcomes, grades } = blog(6, 0, {
      'OAI-SearchBot': refused,
      'ChatGPT-User': refused,
      'Claude-SearchBot': refused,
      PerplexityBot: blocked,
    });
    expect(grades.ai_readability.components.access.score).toBe(null);
    const edge = fixes(outcomes).filter((f) => f.type === 'edge_rule_blocks_crawler');
    expect(edge.length).toBeGreaterThan(0);
    // PerplexityBot is the one measured crawler: unblocking it moves the range, not a score
    for (const f of edge) {
      expect(f.effect).toMatchObject({
        ai_readability: null,
        ai_readability_pending_on: ['too_few_crawlers_measured'],
      });
    }
  });

  it('a crawler robots.txt disallows on every page opens no fix and has no effect: respected intent', () => {
    const { outcomes, grades } = blog(6, 0, { PerplexityBot: every(2, 'disallowed_by_robots') });
    const robots = outcomes.filter(
      (o) => o.state === 'detected' && o.fix.type === 'robots_txt_blocks_crawler',
    );
    expect(robots).toEqual([]);
    expect(fixes(outcomes).some((f) => f.crawler_uas.includes('PerplexityBot'))).toBe(false);
    expect(grades.ai_readability.components.access.score).toBe(40);
  });
});

describe('effects that cannot be stated', () => {
  it('a refused Technical SEO grade gives every fix a Technical SEO effect of 0: there is no score to move', () => {
    // the homepage, two posts and an orphan are 4 graded pages, under the floor of 5
    const { grades, outcomes } = blog(2, 0, {}, [{ path: '/old-1' }]);
    expect(grades.technical_seo.score).toBe(null);
    const fs = fixes(outcomes);
    expect(fs.map((f) => f.type)).toContain('orphan_pages');
    for (const f of fs) expect(f.effect.technical_seo).toBe(0);
  });

  it('a fix that would lift a refused grade out of refusal still has a Technical SEO effect of 0', () => {
    // no internal link observed: refused (no_observed_links); the orphan fix adds the first link
    const { grades } = blog(6, 0);
    const inputs = { ...grades.inputs, seo: { ...grades.inputs.seo, edges: [] } };
    const page = inputs.seo.pages.find((p) => p.url.endsWith('/blog/post-0'))!;
    const record = {
      type: 'orphan_pages',
      state: 'detected',
      fingerprint: 'o',
      key: `orphan:${page.url}`,
    } as never;
    const after = applyFix(inputs, { family: 'structure', record });
    expect(technicalSeo(inputs.seo).score).toBe(null);
    expect(technicalSeo(after.seo).score).not.toBe(null);
    expect(effectsOf(inputs, [{ family: 'structure', record }]).overview.technical_seo).toBe(0);
  });

  it('an edge fix for a crawler with one page that decides its share waits on crawler_too_few_pages', () => {
    // one sampled page blocked, the other rate-limited (out of the denominator)
    const { grades, outcomes } = blog(6, 0, {
      PerplexityBot: ['blocked_by_ua_rule', 'rate_limited'],
    });
    expect(grades.ai_readability.components.access.score).not.toBe(null);
    const edge = fixes(outcomes).filter((f) => f.type === 'edge_rule_blocks_crawler');
    expect(edge.map((f) => f.crawler_uas[0])).toEqual(['PerplexityBot']);
    expect(edge[0]!.effect).toMatchObject({
      ai_readability: null,
      ai_readability_pending_on: ['crawler_too_few_pages'],
    });
  });
});

describe('the content fix', () => {
  it('an answer-first fix opens per template, scores nothing in Technical SEO, and waits on check_not_scored for AI readability', () => {
    const { outcomes } = blog(13, 8);
    const [answer] = fixes(outcomes).filter((f) => f.type === 'quotable_opening');
    expect(answer).toMatchObject({
      template_key: '/blog/{slug}',
      affected_pages: 8,
      section: 'content',
      recommendation_class: 'experimental',
    });
    // answer-first is reported but not counted in Quotable until the label set validates it, so
    // fixing it adds no points that can be stated
    expect(answer!.effect).toEqual({
      technical_seo: 0,
      ai_readability: null,
      ai_readability_pending_on: ['check_not_scored'],
      estimate: true,
    });
  });
});

describe('the counterfactuals', () => {
  it('an orphan fix links the page from its suggested parent, or from the homepage when it has none', () => {
    const { grades } = blog(4, 0, {}, [{ path: '/old-1' }]);
    const orphan = grades.inputs.seo.pages.find((p) => p.url.endsWith('/old-1'))!;
    const record = {
      family: 'structure' as const,
      record: { type: 'orphan_pages' as const, key: `orphan:${orphan.url}` } as never,
    };
    const parent = grades.inputs.seo.pages.find((p) => p.url.endsWith('/blog/post-0'))!.url;
    const withParent = {
      ...grades.inputs,
      seo: {
        ...grades.inputs.seo,
        pages: grades.inputs.seo.pages.map((p) =>
          p === orphan ? { ...p, suggested_parent_url: parent } : p,
        ),
      },
    };
    const linked = (i: typeof grades.inputs) =>
      applyFix(i, record)
        .seo.edges.filter((e) => e.to_url === orphan.url)
        .map((e) => e.from_url);
    expect(linked(withParent)).toEqual([parent]);
    expect(linked(grades.inputs)).toEqual([grades.inputs.seo.homepage_url]);
  });
});

describe('the content fix while Quotable has no score', () => {
  it('an uncounted check waits on check_not_scored alone, whatever Quotable holds', () => {
    const shellPage: PageSpec = { path: '/app/x', template: '/app/{slug}', links: ['/'] };
    const r = blog(13, 8, {}, [shellPage]);
    expect(r.grades.ai_readability.components.quotable.score).toBe(null);
    const answer = fixes(r.outcomes).find((f) => f.type === 'quotable_opening');
    expect(answer?.effect).toMatchObject({
      ai_readability: null,
      ai_readability_pending_on: ['check_not_scored'],
    });
  });
});

describe('a fix on a counted check', () => {
  // No counted check has a fix type yet, so the record is built by hand: it is the path a counted
  // check takes once one does.
  const { grades } = blog(13, 0);
  const record = (failing: number) => ({
    family: 'content' as const,
    record: {
      check: 'question_headings',
      fingerprint: 'f',
      extent: { failing, of: 14, unread: 0 },
    } as never,
  });
  const withChecks = (checks: object) => ({
    ...grades.inputs,
    ai: { ...grades.inputs.ai, quotable: { checks } as never },
  });

  it('moves Quotable by the hand value: 12 of 14 pages fixed is 20 × (12/14)/3 = +5.71', () => {
    const inputs = withChecks({
      question_headings: { passing: 2, decided: 14, unread: 0 },
      schema_with_description: { passing: 14, decided: 14, unread: 0 },
      author_and_date: { passing: 14, decided: 14, unread: 0 },
    });
    const { overview } = effectsOf(inputs, [record(12)]);
    expect(overview).toEqual({
      technical_seo: 0,
      ai_readability: 5.71,
      ai_readability_pending_on: [],
      estimate: true,
    });
  });

  it('waits on quotable_unmeasured while an unread page leaves Quotable a range', () => {
    const inputs = withChecks({
      question_headings: { passing: 2, decided: 14, unread: 1 },
      schema_with_description: { passing: 14, decided: 14, unread: 0 },
      author_and_date: { passing: 14, decided: 14, unread: 0 },
    });
    const { overview } = effectsOf(inputs, [record(12)]);
    expect(overview).toMatchObject({
      ai_readability: null,
      ai_readability_pending_on: ['quotable_unmeasured'],
    });
  });
});

describe('the structure counterfactuals, by hand', () => {
  it('clearing one of two redirect records: crawlability (1 + 0/2)/2 → (1 + 1/2)/2, so 40 × 0.25 = +10.00', () => {
    const { grades } = blog(6, 0);
    const redirect = (i: number) =>
      ({
        type: 'redirect_chain',
        state: 'detected',
        fingerprint: `r${i}`,
        key: `redirect:/r${i}`,
      }) as never;
    const inputs = {
      ...grades.inputs,
      seo: { ...grades.inputs.seo, detections: [redirect(0), redirect(1)] },
    };
    const { overview } = effectsOf(inputs, [{ family: 'structure', record: redirect(0) }]);
    expect(overview.technical_seo).toBe(10);
    expect(overview.ai_readability).toBe(0);
  });

  it("descriptive anchors on the homepage take the generic share under v1's alert: 0.6 × 20 × 0.2 = +2.40", () => {
    // three extra hubs link to every post with anchors of their own, so anchor diversity is not 0;
    // the homepage's and /x1's links are generic, above v1's 0.2 alert, and the homepage's alone are not
    const posts = Array.from({ length: 6 }, (_, i) => `/blog/post-${i}`);
    const extra: PageSpec[] = ['/x1', '/x2', '/x3'].map((path) => ({
      path,
      links: posts.map((to) => ({ to, anchor: `${path} ${to}` })),
    }));
    const { grades } = blog(6, 0, {}, extra);
    const home = grades.inputs.seo.homepage_url;
    const generic = new Set([home, 'https://a.test/x1']);
    const seo = {
      ...grades.inputs.seo,
      edges: grades.inputs.seo.edges.map((e) =>
        generic.has(e.from_url) ? { ...e, is_generic_anchor: true } : e,
      ),
    };
    const inputs = { ...grades.inputs, seo };
    const record = {
      type: 'generic_anchor_text',
      state: 'detected',
      fingerprint: 'g',
      key: `anchors:${home}`,
    } as never;
    const after = applyFix(inputs, { family: 'structure', record });
    expect(after.seo.edges.filter((e) => e.from_url === home && e.is_generic_anchor)).toEqual([]);
    const [b, a] = [technicalSeo(seo).breakdown, technicalSeo(after.seo).breakdown];
    expect(a.anchorDiversityScore - b.anchorDiversityScore).toBeCloseTo(0.2, 9);
    expect([a.orphanRatioScore, a.depthScore, a.structureScore]).toEqual([
      b.orphanRatioScore,
      b.depthScore,
      b.structureScore,
    ]);
    const { overview } = effectsOf(inputs, [{ family: 'structure', record }]);
    expect(overview.technical_seo).toBe(2.4);
  });
});

describe('the effects', () => {
  const orphans: PageSpec[] = ['/old-1', '/old-2'].map((path) => ({ path }));

  it('add up to the projected grades less the current ones, within rounding', () => {
    const { outcomes, overview } = blog(13, 8, { PerplexityBot: blocked }, orphans);
    const fs = fixes(outcomes);
    expect(fs.map((f) => f.type).sort()).toEqual(
      expect.arrayContaining(['edge_rule_blocks_crawler', 'orphan_pages', 'quotable_opening']),
    );
    const seo = fs.reduce((n, f) => n + f.effect.technical_seo, 0);
    const ai = fs.reduce((n, f) => n + (f.effect.ai_readability ?? 0), 0);
    expect(Math.abs(seo - overview.technical_seo)).toBeLessThanOrEqual(0.005 * fs.length + 1e-9);
    expect(Math.abs(ai - overview.ai_readability!)).toBeLessThanOrEqual(0.005 * fs.length + 1e-9);
    expect(overview.technical_seo).toBeGreaterThan(0);
  });

  it('are ranked 1..n, the largest applied alone first', () => {
    const { outcomes } = blog(13, 8, { PerplexityBot: blocked }, orphans);
    const fs = fixes(outcomes).sort((a, b) => a.rank - b.rank);
    expect(fs.map((f) => f.rank)).toEqual(fs.map((_, i) => i + 1));
    expect(fs[0]!.type).toBe('edge_rule_blocks_crawler');
  });

  it('an orphan no path reaches is also a deep page: two fixes, one link apart, adding up to both applied', () => {
    const { outcomes, overview } = blog(6, 0, {}, [{ path: '/old-1' }]);
    const fs = fixes(outcomes).sort((a, b) => a.rank - b.rank);
    // the orphan fix links it from the homepage, the deep-page fix from a page two clicks away
    expect(fs.map((f) => f.type).sort()).toEqual(['deep_pages', 'orphan_pages']);
    expect(fs[0]!.effect.technical_seo).toBeGreaterThan(0);
    expect(fs[0]!.effect.technical_seo).toBeGreaterThanOrEqual(fs[1]!.effect.technical_seo);
    expect(fs[0]!.effect.technical_seo + fs[1]!.effect.technical_seo).toBeCloseTo(
      overview.technical_seo,
      6,
    );
    expect(fs.every((f) => f.effect.ai_readability === 0)).toBe(true);
  });

  it('a link a fix adds moves no anchor score: the fix prescribes the link, not its text', () => {
    // /deep/5 has two inbound links already, so a third anchor would reach v1's per-target sample
    // and change anchor diversity on its own
    const chain: PageSpec[] = Array.from({ length: 6 }, (_, i) => ({
      path: `/deep/${i}`,
      links: i < 5 ? [{ to: `/deep/${i + 1}`, anchor: 'next' }] : [],
    }));
    const extra: PageSpec[] = [
      { path: '/hub', links: [{ to: '/deep/0', anchor: 'next' }] },
      ...chain,
      { path: '/side', links: [{ to: '/deep/5', anchor: 'last step' }] },
    ];
    const { grades, outcomes } = blog(4, 0, {}, extra);
    const deep = outcomes.find(
      (o) =>
        o.state === 'detected' && o.fix.type === 'deep_pages' && o.fix.title.includes('/deep/5'),
    );
    expect(deep).toBeDefined();
    const record = grades.inputs.seo.detections.find(
      (d) => d.fingerprint === deep!.fingerprint,
    ) as never;
    const after = applyFix(grades.inputs, { family: 'structure', record });
    const anchors = (seo: typeof after.seo) => technicalSeo(seo).breakdown.anchorDiversityScore;
    expect(after.seo.edges.length).toBe(grades.inputs.seo.edges.length + 1);
    // no page is two clicks from the homepage here, so the link comes from the lowest-URL page one click away
    expect(after.seo.edges.at(-1)!.from_url).toBe('https://a.test/blog/post-0');
    expect(anchors(after.seo)).toBe(anchors(grades.inputs.seo));
  });

  it('a deep page is linked from the deepest graded page within two clicks, the lowest URL there', () => {
    const chain: PageSpec[] = Array.from({ length: 5 }, (_, i) => ({
      path: `/deep/${i}`,
      links: i < 4 ? [`/deep/${i + 1}`] : [],
    }));
    const { grades } = blog(4, 0, {}, [
      { path: '/sec-b' },
      { path: '/sec-a', links: ['/deep/0'] },
      ...chain,
    ]);
    const url = (p: string) => grades.inputs.seo.pages.find((x) => x.url.endsWith(p))!.url;
    // two pages two clicks away: /sec-a and /sec-b, both linked from post-0
    const edge = (from: string, to: string) => ({
      ...grades.inputs.seo.edges[0]!,
      from_url: url(from),
      to_url: url(to),
    });
    const seo = {
      ...grades.inputs.seo,
      edges: [
        ...grades.inputs.seo.edges,
        edge('/blog/post-0', '/sec-b'),
        edge('/blog/post-0', '/sec-a'),
      ],
    };
    const record = {
      type: 'deep_pages',
      state: 'detected',
      fingerprint: 'd',
      key: `deep:${url('/deep/4')}`,
    } as never;
    const after = applyFix({ ...grades.inputs, seo }, { family: 'structure', record });
    expect(after.seo.edges.at(-1)).toMatchObject({
      from_url: url('/sec-a'),
      to_url: url('/deep/4'),
    });
  });

  it('add up on random sites too: any number of orphans and deep pages, any blocked crawlers', () => {
    fc.assert(
      fc.property(
        fc.nat({ max: 4 }),
        fc.nat({ max: 3 }),
        fc.subarray(['PerplexityBot', 'Claude-SearchBot', 'OAI-SearchBot']),
        fc.nat({ max: 6 }),
        (nOrphans, depth, blockedBots, unanswered) => {
          const chain: PageSpec[] = Array.from({ length: depth + 4 }, (_, i) => ({
            path: `/deep/${i}`,
            links: i + 1 < depth + 4 ? [`/deep/${i + 1}`] : [],
          }));
          const extra: PageSpec[] = [
            ...Array.from({ length: nOrphans }, (_, i) => ({ path: `/orphan/${i}` })),
            { path: '/hub', links: ['/deep/0'] },
            ...chain,
          ];
          const cells = Object.fromEntries(blockedBots.map((b) => [b, blocked]));
          const r = blog(8, unanswered, cells, extra);
          const fs = fixes(r.outcomes);
          for (const f of fs) expect(EffectSchema.safeParse(f.effect).success).toBe(true);
          const seo = fs.reduce((n, f) => n + f.effect.technical_seo, 0);
          expect(Math.abs(seo - r.overview.technical_seo)).toBeLessThanOrEqual(
            0.005 * fs.length + 1e-9,
          );
          if (r.overview.ai_readability !== null) {
            const ai = fs.reduce((n, f) => n + (f.effect.ai_readability ?? 0), 0);
            expect(Math.abs(ai - r.overview.ai_readability)).toBeLessThanOrEqual(
              0.005 * fs.length + 1e-9,
            );
          }
        },
      ),
      { numRuns: 25, seed: 1717 },
    );
  });
});

describe('the outcomes', () => {
  it('are one per record, by fingerprint: every structure, content and access record but a respected-intent block', () => {
    const { input, access } = blogSite(
      13,
      8,
      { PerplexityBot: blocked, 'Claude-SearchBot': every(2, 'disallowed_by_robots') },
      [{ path: '/old-1' }, { path: '/gone', status: 404 }],
    );
    const grades = gradeCheck(input);
    const { outcomes } = detectorOutcomes(grades, access, input.structure);
    const respected = access.filter((r) => r.state === 'detected' && !r.opens_fix);
    expect(respected.length).toBeGreaterThan(0);
    const expected = [
      ...input.structure,
      ...grades.content_detections,
      ...access.filter((r) => !respected.includes(r)),
    ].map((r) => r.fingerprint);
    const got = outcomes.map((o) => o.fingerprint);
    expect(new Set(got).size).toBe(got.length);
    expect([...got].sort()).toEqual([...expected].sort());
    for (const o of outcomes) {
      const r = [...input.structure, ...grades.content_detections, ...access].find(
        (x) => x.fingerprint === o.fingerprint,
      )!;
      expect(o.state).toBe(r.state);
    }
  });

  it('carry every record: detected with a draft, not detected, and indeterminate with the gone page', () => {
    const { outcomes } = blog(6, 0, {}, [{ path: '/gone', status: 404 }]);
    const states = new Set(outcomes.map((o) => o.state));
    expect(states).toEqual(new Set(['not_detected', 'indeterminate']));
    const gone = outcomes.find((o) => o.state === 'indeterminate' && o.gone !== null);
    expect(gone).toBeDefined();
  });
});
