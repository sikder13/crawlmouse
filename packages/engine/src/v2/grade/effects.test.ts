/**
 * Fix effects by counterfactual recompute: the exact values the formula table gives, the effects
 * adding up to the projected grades, and what a respected-intent robots.txt disallow does (nothing).
 */
import type { PageResult } from '@crawlmouse/types/v2';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { every, grid } from '../../../fixtures/v2/access/builders.js';
import { site, type PageSpec } from '../../../fixtures/v2/detectors/builders.js';
import { detectAccess } from '../access/index.js';
import type { ContentFeatures } from '../content/read.js';
import { detectStructure } from '../detectors/index.js';
import { applyFix } from './effects.js';
import { gradeCheck, type GradeInput } from './index.js';
import { detectorOutcomes } from './outcomes.js';

const NO_BYLINE = {
  meta_author: true,
  published_time: true,
  rel_author: false,
  itemprop_author: false,
  itemprop_date: false,
  time_datetime: false,
};
/** A blog post: passes every check but the opening, which answers or not. */
const post = (answers: boolean): ContentFeatures => ({
  client_rendered: false,
  has_h1: true,
  words_after_h1: 300,
  opening: [{ tag: 'p', words: 160, answer_sentences: answers ? 1 : 0, question: false }],
  headings: { count: 4, questions: 1 },
  json_ld: [
    {
      types: ['BlogPosting'],
      has_description: true,
      has_author: true,
      has_dated_publication: true,
    },
  ],
  byline: NO_BYLINE,
  specs: { structured: 0, label_value_lines: 0, spec_images: 0 },
});

type Cells = Parameters<typeof grid>[0]['cells'];

/** A homepage and `n` posts, all linked both ways; `unanswered` of the posts lack an answer-first opening. */
function blog(n: number, unanswered: number, cells: Cells = {}, extra: PageSpec[] = []) {
  const posts = Array.from({ length: n }, (_, i) => `/blog/post-${i}`);
  const s = site([
    { path: '/', links: posts },
    ...posts.map((path) => ({ path, template: '/blog/{slug}', links: ['/'] })),
    ...extra,
  ]);
  const content = new Map<string, ContentFeatures>(
    s.pages.map((p, i) => [
      p.url,
      p.template_key === '/app/{slug}'
        ? { ...post(false), client_rendered: true }
        : post(!(p.template_key === '/blog/{slug}' && i <= unanswered)),
    ]),
  );
  const access = detectAccess(grid({ pages: ['/', '/p/1'], cells }));
  const pages: PageResult[] = s.pages.map((p) => ({
    ...p,
    without_js: { raw_words: 300, rendered_words: 300, text_share: 1, state: 'readable' },
  }));
  const input: GradeInput = {
    pages,
    edges: s.edges,
    homepage_url: s.homepage_url,
    content,
    crawlers: access.crawlers,
    structure: detectStructure(s),
    robots_txt: '',
    title_and_meta: null,
    refusal: { excludedPageCount: 0, estimateSource: 'frontier', crawlTruncated: false },
  };
  const grades = gradeCheck(input);
  return { grades, ...detectorOutcomes(grades, access.detections, input.structure), access };
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

describe('the content fix', () => {
  it('scores in AI readability, not Technical SEO: 8 failing of 14 graded pages (13 posts and the homepage), fixed, is 20 × (8/14)/4 = +2.86', () => {
    const { outcomes } = blog(13, 8);
    const [answer] = fixes(outcomes).filter((f) => f.type === 'quotable_opening');
    expect(answer).toMatchObject({
      template_key: '/blog/{slug}',
      affected_pages: 8,
      section: 'content',
      recommendation_class: 'experimental',
    });
    expect(answer!.effect).toEqual({
      technical_seo: 0,
      ai_readability: 2.86,
      ai_readability_pending_on: [],
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
  it('waits on quotable_unmeasured: a client-rendered page elsewhere leaves Quotable a range', () => {
    const shellPage: PageSpec = { path: '/app/x', template: '/app/{slug}', links: ['/'] };
    const r = blog(13, 8, {}, [shellPage]);
    expect(r.grades.ai_readability.components.quotable.score).toBe(null);
    const answer = fixes(r.outcomes).find((f) => f.type === 'quotable_opening');
    expect(answer?.effect).toMatchObject({
      ai_readability: null,
      ai_readability_pending_on: ['quotable_unmeasured'],
    });
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

  it('an orphan no path reaches is also a deep page: the two fixes overlap, and the higher-ranked takes the effect', () => {
    const { outcomes } = blog(6, 0, {}, [{ path: '/old-1' }]);
    const fs = fixes(outcomes).sort((a, b) => a.rank - b.rank);
    expect(fs.map((f) => f.type)).toEqual(['deep_pages', 'orphan_pages']);
    // both mean a link from the homepage: applied first, the deep-page fix raises Technical SEO;
    // the orphan fix after it adds that link again, which changes nothing
    expect(fs[0]!.effect.technical_seo).toBeGreaterThan(0);
    expect(fs[1]!.effect.technical_seo).toBe(0);
    expect(fs.every((f) => f.effect.ai_readability === 0)).toBe(true);
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
  it('carry every record: detected with a draft, not detected, and indeterminate with the gone page', () => {
    const { outcomes } = blog(6, 0, {}, [{ path: '/gone', status: 404 }]);
    const states = new Set(outcomes.map((o) => o.state));
    expect(states).toEqual(new Set(['not_detected', 'indeterminate']));
    const gone = outcomes.find((o) => o.state === 'indeterminate' && o.gone !== null);
    expect(gone).toBeDefined();
  });
});
