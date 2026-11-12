/**
 * Fix effects by counterfactual recompute: the exact values the formula table gives, the effects
 * adding up to the projected grades, and what a respected-intent robots.txt disallow does (nothing).
 *
 * No content check counts in Quotable yet, so AI readability is withheld on every real check and every
 * AI effect waits on its reasons. `scored` gives the same site Quotable's score from a tally of one
 * passing check, as it will read once a check counts, so the AI effects can be stated and checked.
 */
import { EffectSchema } from '@crawlmouse/types/v2';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { every } from '../../../fixtures/v2/access/builders.js';
import { blogSite, type Cells } from '../../../fixtures/v2/grade/sites.js';
import type { PageSpec } from '../../../fixtures/v2/detectors/builders.js';
import type { ContentFeatures } from '../content/read.js';
import type { Detection } from '../detectors/types.js';
import { applyFix, effectsOf } from './effects.js';
import { round } from './numbers.js';
import { crawlability, technicalSeo } from './technical-seo.js';
import { aiFrom, gradeCheck, type Grades } from './index.js';
import { detectorOutcomes } from './outcomes.js';
import { factsFor } from '../packets/test-support/facts.js';
import { writtenFrom } from '../packets/written.js';

function blog(n: number, unanswered: number, cells: Cells = {}, extra: PageSpec[] = []) {
  const { input, access } = blogSite(n, unanswered, cells, extra);
  const grades = gradeCheck(input);
  return {
    grades,
    ...detectorOutcomes(grades, access, input.structure, [], writtenFrom(factsFor(input))),
  };
}

/** Quotable as it will read once a check counts: one check passing on every page, 20. */
const QUOTABLE_SCORED = { checks: { author_and_date: { passing: 1, decided: 1, unread: 0 } } };

/** The blog with Quotable scored, so AI readability can be given and its effects stated. */
function scored(n: number, unanswered: number, cells: Cells = {}, extra: PageSpec[] = []) {
  const { input, access } = blogSite(n, unanswered, cells, extra);
  const g = gradeCheck(input);
  const inputs = { ...g.inputs, ai: { ...g.inputs.ai, quotable: QUOTABLE_SCORED } };
  const grades: Grades = { ...g, inputs, ai_readability: aiFrom(inputs.ai) };
  return {
    grades,
    ...detectorOutcomes(grades, access, input.structure, [], writtenFrom(factsFor(input))),
  };
}

/** The structure records gradeCheck was given: whole records, which its input type narrows. */
const structureOf = (g: Grades) => g.inputs.seo.detections as unknown as readonly Detection[];

const SEO_STATED = { technical_seo_pending_on: [], absorbed_by: null, estimate: true } as const;

const fixes = (o: ReturnType<typeof blog>['outcomes']) =>
  o.flatMap((x) => (x.state === 'detected' ? [x.fix] : []));
const blocked = every(2, 'blocked_by_ua_rule');

describe('the access fix', () => {
  it('fully unblocking one of four scored crawlers is exactly +10.00 AI readability, and no Technical SEO', () => {
    const { outcomes, grades } = scored(6, 0, {
      PerplexityBot: blocked,
      'Claude-SearchBot': blocked,
    });
    expect(grades.ai_readability.withheld).toBe(false);
    const edge = fixes(outcomes).filter((f) => f.type === 'edge_rule_blocks_crawler');
    expect(edge.map((f) => f.crawler_uas[0]).sort()).toEqual(['Claude-SearchBot', 'PerplexityBot']);
    for (const f of edge) {
      expect(f.effect).toEqual({
        ...SEO_STATED,
        technical_seo: 0,
        ai_readability: 10,
        ai_readability_pending_on: [],
      });
    }
  });

  it('while AI readability is withheld, the same fix has no AI effect: it waits on the grade’s reasons', () => {
    const { outcomes, grades } = blog(6, 0, { PerplexityBot: blocked });
    expect(grades.ai_readability).toMatchObject({
      withheld: true,
      withheld_reasons: ['quotable_unmeasured'],
    });
    const [edge] = fixes(outcomes).filter((f) => f.type === 'edge_rule_blocks_crawler');
    expect(edge!.effect).toEqual({
      ...SEO_STATED,
      technical_seo: 0,
      ai_readability: null,
      ai_readability_pending_on: ['quotable_unmeasured'],
    });
  });

  it('with Access withheld (one scored crawler measured), the AI effect waits on that reason', () => {
    const refused = every(2, 'refused_unverified');
    const { outcomes, grades } = scored(6, 0, {
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

  it('one crawler measured and the other three disallowed by robots.txt: Access is scored from the one', () => {
    const d = every(2, 'disallowed_by_robots');
    const { grades, outcomes } = scored(6, 0, {
      'OAI-SearchBot': d,
      'ChatGPT-User': d,
      'Claude-SearchBot': d,
    });
    expect(grades.ai_readability).toMatchObject({
      withheld: false,
      scored_from_fewer_crawlers: 1,
    });
    expect(grades.ai_readability.components.access.score).toBe(40);
    // the disallows are respected intent: no fix recommends them, or undoing them
    expect(fixes(outcomes).filter((f) => f.section === 'crawler_access')).toEqual([]);
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

describe('the author and date fix, end to end', () => {
  it('13 posts with no author: the fix opens for the template, and its AI effect waits on check_not_scored', () => {
    const { input, access } = blogSite(13, 0);
    const noAuthor = (f: ContentFeatures): ContentFeatures => ({
      ...f,
      json_ld: f.json_ld.map((n) => ({ ...n, has_author: false })),
      byline: { ...f.byline, meta_author: false, rel_author: false, itemprop_author: false },
    });
    const content = new Map(
      [...input.content].map(([u, f]) => [u, u.includes('/blog/') ? noAuthor(f) : f]),
    );
    const grades = gradeCheck({ ...input, content });
    expect(grades.ai_readability.components.quotable.score).toBe(null);
    const { outcomes } = detectorOutcomes(
      grades,
      access,
      input.structure,
      [],
      writtenFrom(factsFor(input)),
    );
    const [fix] = fixes(outcomes).filter((f) => f.type === 'missing_author_date');
    expect(fix).toMatchObject({
      template_key: '/blog/{slug}',
      affected_pages: 13,
      confidence: 'inconclusive',
    });
    expect(fix!.effect).toEqual({
      ...SEO_STATED,
      technical_seo: 0,
      ai_readability: null,
      ai_readability_pending_on: ['check_not_scored', 'quotable_unmeasured'],
    });
  });
});

describe('effects that cannot be stated', () => {
  const REFUSED = { technical_seo: null, technical_seo_pending_on: ['grade_refused'] };

  it('a refused Technical SEO grade gives every fix no Technical SEO effect, waiting on grade_refused', () => {
    // the homepage, two posts and an orphan are 4 graded pages, under the floor of 5
    const { grades, outcomes, overview } = blog(2, 0, {}, [{ path: '/old-1' }]);
    expect(grades.technical_seo.score).toBe(null);
    const fs = fixes(outcomes);
    expect(fs.map((f) => f.type)).toContain('orphan_pages');
    for (const f of fs) expect(f.effect).toMatchObject(REFUSED);
    expect(overview).toMatchObject(REFUSED);
  });

  it('a fix that would lift a refused grade out of refusal still has no Technical SEO effect', () => {
    // no internal link observed: refused (no_observed_links); the orphan fix adds the first link
    const { grades } = blog(6, 0);
    const inputs = { ...grades.inputs, seo: { ...grades.inputs.seo, edges: [] } };
    const page = inputs.seo.pages.find((p) => p.url.endsWith('/blog/post-0'))!;
    const record = {
      type: 'orphan_pages',
      state: 'detected',
      fingerprint: 'o',
      key: `orphan:${page.url}`,
      affected_urls: [page.url],
    } as never;
    const after = applyFix(inputs, { family: 'structure', record });
    expect(technicalSeo(inputs.seo).score).toBe(null);
    expect(technicalSeo(after.seo).score).not.toBe(null);
    expect(effectsOf(inputs, [{ family: 'structure', record }]).overview).toMatchObject(REFUSED);
  });

  it('on a refused grade, a fix after the one that lifts it out of refusal still has no Technical SEO effect', () => {
    // no internal link observed: refused (no_observed_links); several orphan fixes, the first of
    // which adds the first link and so lifts the grade out of refusal for every fix after it
    const { grades } = blog(7, 0);
    const inputs = { ...grades.inputs, seo: { ...grades.inputs.seo, edges: [] } };
    const records = inputs.seo.pages
      .filter((p) => p.url.includes('/blog/'))
      .map((p, i) => ({
        family: 'structure' as const,
        record: {
          type: 'orphan_pages',
          state: 'detected',
          fingerprint: `o${i}`,
          key: `orphan:${p.url}`,
          affected_urls: [p.url],
        } as never,
      }));
    const { byFix, overview } = effectsOf(inputs, records);
    expect(byFix.size).toBe(7);
    for (const { effect, absorbed_by } of byFix.values()) {
      expect(effect).toMatchObject(REFUSED);
      expect(absorbed_by).toBe(null);
    }
    expect(overview).toMatchObject(REFUSED);
  });

  it('on a refused grade, fixes with a stated AI effect still rank before those whose AI effect waits', () => {
    // two posts, both without an answer, and an orphan: 4 graded pages, refused as too small. Under a
    // rule that called every fix on a refused grade unstated, all three would tie and fingerprint order
    // would put the content fix first, so this site tells the two rules apart
    const { grades, outcomes } = scored(2, 2, {}, [{ path: '/old-9' }]);
    expect(grades.technical_seo.score).toBe(null);
    const fs = fixes(outcomes).sort((a, b) => a.rank - b.rank);
    expect(fs.map((f) => f.type)).toContain('quotable_opening');
    const waits = fs.map((f) => f.effect.ai_readability === null);
    expect(waits).toContain(false);
    expect(waits.slice(waits.indexOf(true)).every(Boolean)).toBe(true);
  });

  it('an edge fix for a crawler with one page that decides its share waits on crawler_too_few_pages', () => {
    // one sampled page blocked, the other rate-limited (out of the denominator)
    const { grades, outcomes } = scored(6, 0, {
      PerplexityBot: ['blocked_by_ua_rule', 'rate_limited'],
    });
    expect(grades.ai_readability.withheld).toBe(false);
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
    // no check counts in Quotable, so fixing one adds no points that can be stated, and the grade
    // it would move is withheld for Quotable as well
    expect(answer!.effect).toEqual({
      ...SEO_STATED,
      technical_seo: 0,
      ai_readability: null,
      ai_readability_pending_on: ['check_not_scored', 'quotable_unmeasured'],
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

describe('the content fix while the grade is given', () => {
  it('an uncounted check waits on check_not_scored alone', () => {
    const r = scored(13, 8);
    expect(r.grades.ai_readability.withheld).toBe(false);
    const answer = fixes(r.outcomes).find((f) => f.type === 'quotable_opening');
    expect(answer?.effect).toMatchObject({
      ai_readability: null,
      ai_readability_pending_on: ['check_not_scored'],
    });
  });
});

describe('a fix on a counted check (the checks passed as counted, as CC-18 will make them)', () => {
  // schema_with_description has no fix type, so the record is built by hand: it exercises the content
  // counterfactual and Quotable's range path, which no check reaches while none counts
  const { grades } = blog(13, 0);
  const counted = new Set(['schema_with_description', 'author_and_date'] as const);
  const record = (check: string, failing: number) => ({
    family: 'content' as const,
    record: { check, fingerprint: 'f', extent: { failing, of: 14, unread: 0 } } as never,
  });
  const withChecks = (checks: object) => ({
    ...grades.inputs,
    ai: { ...grades.inputs.ai, quotable: { checks } as never },
  });

  it('moves Quotable by the hand value: 12 of 14 pages fixed is 20 × (12/14)/2 = +8.57', () => {
    const inputs = withChecks({
      schema_with_description: { passing: 2, decided: 14, unread: 0 },
      author_and_date: { passing: 14, decided: 14, unread: 0 },
    });
    const { overview } = effectsOf(inputs, [record('schema_with_description', 12)], counted);
    expect(overview).toEqual({
      ...SEO_STATED,
      technical_seo: 0,
      ai_readability: 8.57,
      ai_readability_pending_on: [],
    });
  });

  it('waits on quotable_unmeasured while an unread page leaves Quotable a range', () => {
    const inputs = withChecks({
      schema_with_description: { passing: 2, decided: 14, unread: 1 },
      author_and_date: { passing: 14, decided: 14, unread: 0 },
    });
    const { overview } = effectsOf(inputs, [record('schema_with_description', 12)], counted);
    expect(overview).toMatchObject({
      ai_readability: null,
      ai_readability_pending_on: ['quotable_unmeasured'],
    });
  });

  it('a check not counted moves nothing, even when the inputs carry its tally', () => {
    const inputs = withChecks({
      question_headings: { passing: 2, decided: 14, unread: 0 },
      schema_with_description: { passing: 14, decided: 14, unread: 0 },
      author_and_date: { passing: 14, decided: 14, unread: 0 },
    });
    const fix = record('question_headings', 12);
    expect(applyFix(inputs, fix, counted)).toBe(inputs);
    // and by default, with no check counted, neither does a check the tests count above
    const schema = record('schema_with_description', 12);
    expect(applyFix(inputs, schema)).toBe(inputs);
    expect(effectsOf(inputs, [fix], counted).byFix.get('f')!.effect).toMatchObject({
      ai_readability: null,
      ai_readability_pending_on: ['check_not_scored'],
    });
  });
});

describe('the structure counterfactuals, by hand', () => {
  it('fixing a redirect chain takes the redirecting URL out of the crawl: 7/8 → 7/7, so 40/8 = +5.00', () => {
    // the blog's 7 pages and /r0, a URL behind a redirect chain that every post links to
    const { grades } = blog(6, 0, {}, [{ path: '/r0', status: 301 }]);
    const r0 = grades.inputs.seo.pages.find((p) => p.url.endsWith('/r0'))!.url;
    const posts = grades.inputs.seo.pages.filter((p) => p.url.includes('/blog/')).map((p) => p.url);
    const redirect = {
      type: 'redirect_chain',
      state: 'detected',
      fingerprint: 'r0',
      key: `redirect:${r0}`,
      affected_urls: posts,
    } as never;
    const inputs = { ...grades.inputs, seo: { ...grades.inputs.seo, detections: [redirect] } };
    expect(grades.inputs.seo.pages).toHaveLength(8);
    const { overview } = effectsOf(inputs, [{ family: 'structure', record: redirect }]);
    expect(overview.technical_seo).toBe(5);
    const after = applyFix(inputs, { family: 'structure', record: redirect });
    expect(after.seo.pages.map((p) => p.url)).not.toContain(r0);
    // AI readability is withheld (Quotable counts no check): no AI effect, waiting on its reason
    expect(overview).toMatchObject({
      ai_readability: null,
      ai_readability_pending_on: ['quotable_unmeasured'],
    });
  });
  it('three defects on one page: neither of the first two would raise a grade alone, so neither is absorbed', () => {
    const { grades } = blog(6, 0);
    const [p1] = grades.inputs.seo.pages.filter((p) => p.url.includes('/blog/'));
    const on = (type: string, prefix: string, subject: string) =>
      ({
        type,
        state: 'detected',
        fingerprint: type,
        key: `${prefix}:${subject}`,
        affected_urls: [p1!.url],
      }) as never;
    const records = [
      on('canonical_mismatch', 'canonical', p1!.url),
      on('duplicate_pagination', 'pagination', '/blog/page/{n}'),
      on('hreflang_gap', 'hreflang', p1!.url),
    ];
    const inputs = { ...grades.inputs, seo: { ...grades.inputs.seo, detections: records } };
    const { byFix } = effectsOf(
      inputs,
      records.map((record) => ({ family: 'structure' as const, record })),
    );
    expect([...byFix.values()].map((x) => [x.effect.technical_seo, x.absorbed_by])).toEqual([
      [0, null],
      [0, null],
      [5.72, null],
    ]);
  });
  it('the absorber is the first fix above that takes the effect, not the first that names the page', () => {
    // /old-1 is an orphan, so also deep, and a canonical record marks it: clearing the record ranks
    // first and leaves the deep-page fix its effect; the orphan fix, second, takes it
    const { grades } = blog(6, 0, {}, [{ path: '/old-1' }]);
    const old = grades.inputs.seo.pages.find((p) => p.url.endsWith('/old-1'))!.url;
    const redirect = {
      type: 'canonical_mismatch',
      state: 'detected',
      fingerprint: 'r',
      key: `canonical:${old}`,
      affected_urls: [old],
    } as never;
    const detections = [...structureOf(grades), redirect];
    const inputs = { ...grades.inputs, seo: { ...grades.inputs.seo, detections } };
    const fixes = detections
      .filter((d) => d.state === 'detected')
      .map((record) => ({ family: 'structure' as const, record }));
    const { byFix } = effectsOf(inputs, fixes);
    const ranked = [...byFix].sort((x, y) => x[1].rank - y[1].rank);
    const type = (fp: string) => detections.find((d) => d.fingerprint === fp)!.type;
    expect(ranked.map(([fp]) => type(fp))).toEqual([
      'canonical_mismatch',
      'orphan_pages',
      'deep_pages',
    ]);
    const [, orphan, deep] = ranked as [
      unknown,
      [string, unknown],
      [string, { absorbed_by: string | null; effect: { technical_seo: number | null } }],
    ];
    expect(deep[1].effect.technical_seo).toBeLessThanOrEqual(0);
    expect(deep[1].absorbed_by).toBe(orphan[0]);
  });

  it('an effect gone before any fix naming its page is left unattributed, not given to that fix', () => {
    // /y is an orphan, and the only page linking /x1../x4; its fixes link it, and the four with it,
    // so the deep-page fixes on /x1../x4 have nothing left. A redirect record names /x1 and ranks
    // between them; it takes nothing from deep(/x1)
    const extra: PageSpec[] = [
      { path: '/y', links: ['/x1', '/x2', '/x3', '/x4'] },
      ...['/x1', '/x2', '/x3', '/x4'].map((path) => ({ path })),
    ];
    const { grades } = blog(12, 0, {}, extra);
    const x1 = grades.inputs.seo.pages.find((p) => p.url.endsWith('/x1'))!.url;
    const redirect = {
      type: 'redirect_chain',
      state: 'detected',
      fingerprint: 'redir',
      key: 'redirect:https://a.test/r',
      affected_urls: [x1],
    } as never;
    const detections = [...structureOf(grades), redirect];
    const inputs = { ...grades.inputs, seo: { ...grades.inputs.seo, detections } };
    const fixes = detections
      .filter((d) => d.state === 'detected')
      .map((record) => ({ family: 'structure' as const, record }));
    const { byFix } = effectsOf(inputs, fixes);
    const keyOf = new Map(detections.map((d) => [d.fingerprint, d.key]));
    const absorbed = new Map(
      [...byFix].map(([fp, v]) => [keyOf.get(fp)!, v.absorbed_by && keyOf.get(v.absorbed_by)]),
    );
    expect(absorbed.get(`depth:${x1}`)).not.toBe('redirect:https://a.test/r');
    for (const [, v] of byFix) if (v.absorbed_by === 'redir') throw new Error('redirect named');
  });

  it('the absorber must name what the fix names: an orphan fix on another page taking the effect is not named', () => {
    // /old-1 is an orphan linking /old-2; the orphan fix on /old-1 also brings /old-2 within reach,
    // so the deep-page fix on /old-2 has nothing left, but the two fixes name different pages
    const { grades } = blog(20, 0, {}, [{ path: '/old-1', links: ['/old-2'] }, { path: '/old-2' }]);
    const old2 = grades.inputs.seo.pages.find((p) => p.url.endsWith('/old-2'))!.url;
    const fixes = structureOf(grades)
      .filter((d) => d.state === 'detected')
      .map((record) => ({ family: 'structure' as const, record }));
    const { byFix } = effectsOf(grades.inputs, fixes);
    const deep = structureOf(grades).find((d) => d.key === `depth:${old2}`)!;
    const alone = effectsOf(grades.inputs, [{ family: 'structure', record: deep }]).overview;
    expect(alone.technical_seo).toBeGreaterThan(0);
    expect(byFix.get(deep.fingerprint)!.effect.technical_seo).toBeLessThanOrEqual(0);
    expect(byFix.get(deep.fingerprint)!.absorbed_by).toBe(null);
  });

  it('a followed chain is a 200 row: the fix points its links at the final URL and drops the row', () => {
    // /old-menu-target redirects in two hops to /blog/post-0; the worker stores it as the requested URL
    // with the final response's status (200) and the landed page's links, and every page links to it
    const post0 = 'https://a.test/blog/post-0';
    // its row carries a link post-0's own row does not (read at another moment): the row's links
    // go with it, and post-0's own links stand
    const extra: PageSpec[] = [
      {
        path: '/old-menu-target',
        links: ['/', '/blog/post-5'],
        facts: { final_url: post0, redirect: { hops: 2, loop: false } },
      },
    ];
    const { grades } = blog(13, 0, {}, extra);
    const target = 'https://a.test/old-menu-target';
    const others = grades.inputs.seo.pages.filter((p) => p.url !== target);
    const edge = grades.inputs.seo.edges[0]!;
    const menu = others.map((p) => ({
      ...edge,
      from_url: p.url,
      to_url: target,
      anchor_text: 'Old',
    }));
    const redirect = {
      type: 'redirect_chain',
      state: 'detected',
      fingerprint: 'nav200',
      key: `redirect:${target}`,
      affected_urls: others.map((p) => p.url),
    } as never;
    const seo = {
      ...grades.inputs.seo,
      edges: [...grades.inputs.seo.edges, ...menu],
      detections: [redirect],
    };
    const inputs = { ...grades.inputs, seo };
    const after = applyFix(inputs, { family: 'structure', record: redirect });
    expect(after.seo.pages.map((p) => p.url)).not.toContain(target);
    expect(after.seo.edges.some((e) => e.from_url === target || e.to_url === target)).toBe(false);
    expect(after.seo.edges.some((e) => e.from_url === post0 && e.to_url.endsWith('/post-5'))).toBe(
      false,
    );
    // the menu links now reach post-0, once from each page
    const toPost0 = after.seo.edges.filter((e) => e.to_url === post0).map((e) => e.from_url);
    expect(new Set(toPost0).size).toBe(toPost0.length);
    expect(toPost0).toEqual(
      expect.arrayContaining(others.map((p) => p.url).filter((u) => u !== post0)),
    );
    // the record costs one URL: 14 of 15 clean, then 14 of 14
    expect(crawlability(seo)).toBeCloseTo(14 / 15, 12);
    expect(crawlability(after.seo)).toBe(1);
  });

  it('a chain the crawl stopped (a 3xx row) is dropped, and links to it are not moved to where it stopped', () => {
    const post0 = 'https://a.test/blog/post-0';
    const { grades } = blog(6, 0, {}, [
      { path: '/r', status: 301, facts: { final_url: post0, redirect: { hops: 5, loop: false } } },
    ]);
    const edge = grades.inputs.seo.edges[0]!;
    const toR = grades.inputs.seo.pages
      .filter((p) => p.url.includes('/blog/'))
      .map((p) => ({ ...edge, from_url: p.url, to_url: 'https://a.test/r' }));
    const redirect = {
      type: 'redirect_chain',
      state: 'detected',
      fingerprint: 'r5',
      key: 'redirect:https://a.test/r',
      affected_urls: [],
    } as never;
    const seo = {
      ...grades.inputs.seo,
      edges: [...grades.inputs.seo.edges, ...toR],
      detections: [redirect],
    };
    const after = applyFix({ ...grades.inputs, seo }, { family: 'structure', record: redirect });
    expect(after.seo.pages.map((p) => p.url)).not.toContain('https://a.test/r');
    expect(after.seo.edges.filter((e) => e.to_url === post0)).toEqual(
      seo.edges.filter((e) => e.to_url === post0),
    );
  });

  it('the redirect fix grades as the site built with its menu link on the final URL, same text', () => {
    const extra: PageSpec[] = [
      {
        path: '/old-menu-target',
        links: ['/'],
        facts: { final_url: 'https://a.test/blog/post-0', redirect: { hops: 2, loop: false } },
      },
    ];
    const { input, access } = blogSite(13, 0, {}, extra, ['/old-menu-target']);
    const grades = gradeCheck(input);
    const record = input.structure.find(
      (d) => d.type === 'redirect_chain' && d.state === 'detected',
    )!;
    const after = applyFix(grades.inputs, { family: 'structure', record });
    // the fixed site, built independently: the same menu, pointing at post-0, with its text
    const menu = [{ to: '/blog/post-0', anchor: 'About /old-menu-target' }];
    const fixed = gradeCheck(blogSite(13, 0, {}, [], menu).input).technical_seo;
    expect(technicalSeo(after.seo).score).toBe(fixed.score);
    expect(technicalSeo(after.seo).breakdown).toEqual(fixed.breakdown);
    const { overview } = detectorOutcomes(
      grades,
      access,
      input.structure,
      [],
      writtenFrom(factsFor(input)),
    );
    expect(overview.technical_seo).toBe(round(fixed.score! - grades.technical_seo.score!));
  });

  it('a followed chain whose final URL was not crawled: the row becomes the final URL, links and all', () => {
    const { grades } = blog(6, 0, {}, [
      {
        path: '/moved',
        links: ['/'],
        facts: { final_url: 'https://a.test/new-home', redirect: { hops: 2, loop: false } },
      },
    ]);
    const redirect = {
      type: 'redirect_chain',
      state: 'detected',
      fingerprint: 'mv',
      key: 'redirect:https://a.test/moved',
      affected_urls: [],
    } as never;
    const inputs = { ...grades.inputs, seo: { ...grades.inputs.seo, detections: [redirect] } };
    const after = applyFix(inputs, { family: 'structure', record: redirect });
    expect(after.seo.pages.map((p) => p.url)).toContain('https://a.test/new-home');
    expect(after.seo.pages.map((p) => p.url)).not.toContain('https://a.test/moved');
    expect(after.seo.pages).toHaveLength(inputs.seo.pages.length);
    expect(after.seo.edges.filter((e) => e.from_url === 'https://a.test/new-home')).toHaveLength(
      inputs.seo.edges.filter((e) => e.from_url === 'https://a.test/moved').length,
    );
  });

  it('a site-wide link to a redirect chain costs one URL, the redirecting one: 84.75, and the fix +2.67', () => {
    // the blog's 14 pages and the URL behind the chain, crawled (it answers 301); every page links to it
    const { grades: plain } = blog(13, 0);
    expect(plain.technical_seo.score).toBe(87.42);
    const { grades } = blog(13, 0, {}, [{ path: '/old-menu-target', status: 301 }]);
    const target = grades.inputs.seo.pages.find((p) => p.url.endsWith('/old-menu-target'))!.url;
    const linking = grades.inputs.seo.pages.filter((p) => p.url !== target).map((p) => p.url);
    expect(linking).toHaveLength(14);
    const redirect = {
      type: 'redirect_chain',
      state: 'detected',
      fingerprint: 'nav',
      key: `redirect:${target}`,
      affected_urls: linking,
    } as never;
    const inputs = { ...grades.inputs, seo: { ...grades.inputs.seo, detections: [redirect] } };
    // crawlability 14/15 with the record or without it: the 301 is outside the numerator either way
    // 0.6 × 79.03 + 40 × 14/15 = 47.418 + 37.333 = 84.75
    expect(technicalSeo(inputs.seo).score).toBe(84.75);
    expect(technicalSeo(grades.inputs.seo).score).toBe(84.75);
    // the fix links to the final URL, which takes the 301 out of the crawl: back to 87.42
    expect(
      effectsOf(inputs, [{ family: 'structure', record: redirect }]).overview.technical_seo,
    ).toBe(2.67);
  });

  it('a page carrying two defects counts once: clearing one moves nothing, clearing both 40/7', () => {
    const { grades } = blog(6, 0);
    const [p1] = grades.inputs.seo.pages.filter((p) => p.url.includes('/blog/'));
    const record = (type: string, prefix: string) =>
      ({
        type,
        state: 'detected',
        fingerprint: `${type}0`,
        key: `${prefix}:${p1!.url}`,
        affected_urls: [p1!.url],
      }) as never;
    const records = [record('hreflang_gap', 'hreflang'), record('canonical_mismatch', 'canonical')];
    const inputs = { ...grades.inputs, seo: { ...grades.inputs.seo, detections: records } };
    const one = effectsOf(inputs, [{ family: 'structure', record: records[0]! }]);
    expect(one.overview.technical_seo).toBe(0);
    const both = effectsOf(
      inputs,
      records.map((record) => ({ family: 'structure' as const, record })),
    );
    // 40/7 = 5.714 between the two grades as given, each to two places: 5.72 here
    expect(both.overview.technical_seo).toBe(5.72);
    // each alone moves nothing, so neither was absorbed: the second in the order takes all of it
    expect([...both.byFix.values()].map((x) => [x.effect.technical_seo, x.absorbed_by])).toEqual([
      [0, null],
      [5.72, null],
    ]);
  });

  it("descriptive anchors on the homepage take the generic share down to v1's alert, which v1 does not penalise: 0.6 × 20 × 0.2 = +2.40", () => {
    // three extra hubs link to every post with anchors of their own, so anchor diversity is not 0;
    // the homepage's and /x1's links are generic, above v1's 0.2 alert; /x1's alone are 6 of 30 = 0.2,
    // and v1 penalises only a share above it
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

  it('add up to the projected grades less the current ones, exactly', () => {
    const { outcomes, overview } = scored(13, 8, { PerplexityBot: blocked }, orphans);
    const fs = fixes(outcomes);
    expect(fs.map((f) => f.type).sort()).toEqual(
      expect.arrayContaining(['edge_rule_blocks_crawler', 'orphan_pages', 'quotable_opening']),
    );
    const seo = fs.reduce((n, f) => n + f.effect.technical_seo!, 0);
    const ai = fs.reduce((n, f) => n + (f.effect.ai_readability ?? 0), 0);
    expect(Math.abs(seo - overview.technical_seo!)).toBeLessThan(1e-9);
    expect(Math.abs(ai - overview.ai_readability!)).toBeLessThan(1e-9);
    expect(overview.technical_seo).toBeGreaterThan(0);
    expect(overview.ai_readability).toBeGreaterThan(0);
  });

  it('while AI readability is withheld, every AI effect and the overview’s wait on its reasons', () => {
    const { outcomes, overview } = blog(13, 8, { PerplexityBot: blocked }, orphans);
    const fs = fixes(outcomes);
    expect(fs.length).toBeGreaterThan(2);
    for (const f of [...fs.map((x) => x.effect), overview]) {
      expect(f.ai_readability).toBe(null);
      expect(f.ai_readability_pending_on).toContain('quotable_unmeasured');
    }
  });

  it('are ranked 1..n, the largest applied alone first', () => {
    const { outcomes } = scored(13, 8, { PerplexityBot: blocked }, orphans);
    const fs = fixes(outcomes).sort((a, b) => a.rank - b.rank);
    expect(fs.map((f) => f.rank)).toEqual(fs.map((_, i) => i + 1));
    expect(fs[0]!.type).toBe('edge_rule_blocks_crawler');
  });

  it('fixes whose AI effect waits on a reason rank after every fix whose effect can be stated', () => {
    const { outcomes } = scored(13, 8, { PerplexityBot: blocked }, orphans);
    const fs = fixes(outcomes).sort((a, b) => a.rank - b.rank);
    const unstated = fs.map((f) => f.effect.ai_readability === null);
    expect(unstated).toContain(true);
    expect(unstated).toContain(false);
    // once a fix without a stated effect appears, every later one is without one too
    expect(unstated.slice(unstated.indexOf(true)).every(Boolean)).toBe(true);
  });

  it('a fix whose AI effect waits on a reason ranks after one whose effect alone is negative', () => {
    // linking /deep/0 from the homepage alone lowers Technical SEO on this site (found by search);
    // the two posts without an answer open an uncounted content fix, whose AI effect is unknown
    const chain: PageSpec[] = Array.from({ length: 3 }, (_, i) => ({
      path: `/deep/${i}`,
      links: i < 2 ? [`/deep/${i + 1}`] : [],
    }));
    const { grades, outcomes } = scored(4, 2, {}, [{ path: '/hub', links: ['/deep/0'] }, ...chain]);
    const fs = fixes(outcomes).sort((a, b) => a.rank - b.rank);
    const deep = fs.find((f) => f.type === 'deep_pages' && f.title.includes('/deep/0'))!;
    const fingerprint = outcomes.find((o) => o.state === 'detected' && o.fix === deep)!.fingerprint;
    const record = grades.inputs.seo.detections.find((d) => d.fingerprint === fingerprint) as never;
    expect(
      effectsOf(grades.inputs, [{ family: 'structure', record }]).overview.technical_seo,
    ).toBeLessThan(0);
    const answer = fs.find((f) => f.type === 'quotable_opening')!;
    expect(answer.effect.ai_readability).toBe(null);
    expect(answer.rank).toBeGreaterThan(deep.rank);
  });

  it('an orphan no path reaches is also a deep page: the orphan fix absorbs the deep-page fix', () => {
    const { outcomes, overview } = blog(6, 0, {}, [{ path: '/old-1' }]);
    const fs = fixes(outcomes).sort((a, b) => a.rank - b.rank);
    // the orphan fix links it from the homepage, the deep-page fix from a page two clicks away; once
    // the orphan fix has linked it, the deep-page fix has nothing left to add
    expect(fs.map((f) => f.type)).toEqual(['orphan_pages', 'deep_pages']);
    const [orphan, deep] = fs as [(typeof fs)[0], (typeof fs)[0]];
    expect(orphan.effect.technical_seo).toBeGreaterThan(0);
    expect(deep.effect.technical_seo).toBeLessThanOrEqual(0);
    const orphanFp = outcomes.find((o) => o.state === 'detected' && o.fix === orphan)!.fingerprint;
    expect(deep.absorbed_by_fingerprint).toBe(orphanFp);
    expect(orphan.absorbed_by_fingerprint).toBe(null);
    expect(orphan.effect.technical_seo! + deep.effect.technical_seo!).toBeCloseTo(
      overview.technical_seo!,
      6,
    );
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
      { path: '/sec-0', kind: 'archive' },
      ...chain,
    ]);
    const url = (p: string) => grades.inputs.seo.pages.find((x) => x.url.endsWith(p))!.url;
    // three pages two clicks away, all linked from post-0: /sec-a and /sec-b, graded, and the
    // archive page /sec-0, the lowest URL, which is not graded and so does not link
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
        edge('/blog/post-0', '/sec-0'),
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

  it('add up on random sites too: any number of orphans and deep pages, any blocked crawlers, refused or not', () => {
    let aiStated = 0;
    let refused = 0;
    fc.assert(
      fc.property(
        fc.nat({ max: 4 }),
        fc.nat({ max: 3 }),
        fc.subarray(['PerplexityBot', 'Claude-SearchBot', 'OAI-SearchBot']),
        fc.nat({ max: 6 }),
        fc.constantFrom('withheld', 'scored', 'small'),
        (nOrphans, depth, blockedBots, unanswered, kind) => {
          const orphans = Array.from({ length: nOrphans }, (_, i) => ({ path: `/orphan/${i}` }));
          const chain: PageSpec[] = Array.from({ length: depth + 4 }, (_, i) => ({
            path: `/deep/${i}`,
            links: i + 1 < depth + 4 ? [`/deep/${i + 1}`] : [],
          }));
          const extra: PageSpec[] = [...orphans, { path: '/hub', links: ['/deep/0'] }, ...chain];
          const cells = Object.fromEntries(blockedBots.map((b) => [b, blocked]));
          // small: the homepage, one post and up to two orphans, under the floor of graded pages
          const r =
            kind === 'small'
              ? blog(1, Math.min(unanswered, 1), cells, orphans.slice(0, 2))
              : (kind === 'scored' ? scored : blog)(8, unanswered, cells, extra);
          const fs = fixes(r.outcomes);
          for (const f of fs) expect(EffectSchema.safeParse(f.effect).success).toBe(true);
          if (kind === 'small') {
            expect(r.overview.technical_seo).toBe(null);
            refused += 1;
          }
          // a refused grade leaves every Technical SEO effect unstated, and the overview's with them
          for (const f of fs) {
            expect(f.effect.technical_seo === null).toBe(r.overview.technical_seo === null);
          }
          // each effect is a difference of two grades given to two places, so the sum is exact
          if (r.overview.technical_seo !== null) {
            const seo = fs.reduce((n, f) => n + f.effect.technical_seo!, 0);
            expect(Math.abs(seo - r.overview.technical_seo)).toBeLessThan(1e-9);
          }
          // an absorbed fix names one ranked above it, and has no positive effect left
          const rankOf = new Map(
            r.outcomes.flatMap((o) =>
              o.state === 'detected' ? [[o.fingerprint, o.fix.rank]] : [],
            ),
          );
          for (const f of fs) {
            if (f.absorbed_by_fingerprint === null) continue;
            expect(rankOf.get(f.absorbed_by_fingerprint)!).toBeLessThan(f.rank);
            expect(
              (f.effect.technical_seo ?? 0) + (f.effect.ai_readability ?? 0),
            ).toBeLessThanOrEqual(0);
          }
          // AI effects are stated only when the grade is given, and then add up to the overview
          expect(r.overview.ai_readability !== null).toBe(!r.grades.ai_readability.withheld);
          if (r.overview.ai_readability !== null) {
            const ai = fs.reduce((n, f) => n + (f.effect.ai_readability ?? 0), 0);
            expect(Math.abs(ai - r.overview.ai_readability)).toBeLessThan(1e-9);
            aiStated += 1;
          }
        },
      ),
      { numRuns: 30, seed: 1717 },
    );
    // both branches ran
    expect(aiStated).toBeGreaterThan(0);
    expect(refused).toBeGreaterThan(0);
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
    const { outcomes } = detectorOutcomes(
      grades,
      access,
      input.structure,
      [],
      writtenFrom(factsFor(input)),
    );
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
