/**
 * The two declarations, and both grades assembled from a check's records: the client-rendered site
 * every crawler is served (31 % of its text without JavaScript), and the same site before any page is
 * rendered, which is every check until CC-14 runs.
 */
import { CheckSchema, type Check, type PageResult } from '@crawlmouse/types/v2';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { grid } from '../../../fixtures/v2/access/builders.js';
import { site } from '../../../fixtures/v2/detectors/builders.js';
import { detectAccess } from '../access/index.js';
import type { ContentFeatures } from '../content/read.js';
import { detectStructure } from '../detectors/index.js';
import { contentSignals, schemaOrg } from './declarations.js';
import { gradeCheck, type GradeInput } from './index.js';

describe('Content Signals', () => {
  it('is present in the comment form Cloudflare writes, as crawlmouse.com serves it', () => {
    const robots = readFileSync(
      new URL('../../../../../apps/web/lib/robots-txt.ts', import.meta.url),
      'utf8',
    );
    const line = /# Content-Signal: [^'`\n]+/.exec(robots)![0];
    expect(contentSignals(`${line}\nUser-agent: *\nAllow: /\n`)).toMatchObject({
      state: 'detected',
      evidence: `robots.txt line 1: ${line}`,
      counts_toward_grade: true,
    });
  });

  it('is present as a directive, and whatever its values say', () => {
    expect(contentSignals('User-agent: *\nContent-Signal: search=no, ai-train=no').state).toBe(
      'detected',
    );
  });

  it('is absent with no such line, or one naming none of search, ai-input, ai-train', () => {
    expect(contentSignals('User-agent: *\nDisallow:').state).toBe('not_detected');
    expect(contentSignals('Content-Signal: foo=yes').state).toBe('not_detected');
    expect(contentSignals('').state).toBe('not_detected');
  });

  it('is undecided when robots.txt could not be read; its evidence is bounded', () => {
    expect(contentSignals(null).state).toBe('indeterminate');
    const long = contentSignals(`Content-Signal: search=yes ${'x'.repeat(2000)}`);
    expect(new TextEncoder().encode(long.evidence).length).toBeLessThanOrEqual(500);
  });
});

describe('schema.org', () => {
  const f = (types: string[][]): ContentFeatures[] =>
    types.map(
      (t) =>
        ({
          json_ld: t.map((x) => ({
            types: [x],
            has_description: false,
            has_author: false,
            has_dated_publication: false,
          })),
        }) as ContentFeatures,
    );
  it('is present when a graded page carries a typed JSON-LD node, absent when none does, undecided with no page', () => {
    expect(schemaOrg(f([[], ['WebPage']])).state).toBe('detected');
    expect(schemaOrg(f([[], []])).state).toBe('not_detected');
    expect(schemaOrg([]).state).toBe('indeterminate');
  });
});

/** A static HTML page whose opening answers, with schema and a byline. */
const ARTICLE: ContentFeatures = {
  client_rendered: false,
  has_h1: true,
  words_after_h1: 300,
  opening: [{ tag: 'p', words: 160, answer_sentences: 2, question: false }],
  headings: { count: 4, questions: 1 },
  json_ld: [
    {
      types: ['BlogPosting'],
      has_description: true,
      has_author: true,
      has_dated_publication: true,
    },
  ],
  byline: {
    meta_author: true,
    published_time: true,
    rel_author: false,
    itemprop_author: false,
    itemprop_date: false,
    time_datetime: false,
  },
  specs: { structured: 0, label_value_lines: 0, spec_images: 0 },
};

function csrSite(textShare: number | null): GradeInput {
  const paths = ['/', '/p/1', '/p/2', '/p/3', '/p/4', '/p/5'];
  const s = site(paths.map((path) => ({ path, links: paths.filter((p) => p !== path) })));
  const pages: PageResult[] = s.pages.map((p) => ({
    ...p,
    without_js:
      textShare === null
        ? null
        : { raw_words: 310, rendered_words: 1000, text_share: textShare, state: 'partial' },
  }));
  return {
    pages,
    edges: s.edges,
    homepage_url: s.homepage_url,
    content: new Map(pages.map((p) => [p.url, ARTICLE])),
    crawlers: detectAccess(grid({ pages: ['/', '/p/1'] })).crawlers,
    structure: detectStructure(s),
    robots_txt: '# Content-Signal: search=yes, ai-input=yes, ai-train=yes\nUser-agent: *\nAllow: /',
    title_and_meta: null,
    refusal: { excludedPageCount: 0, estimateSource: 'frontier', crawlTruncated: false },
  };
}

describe('both grades for a check', () => {
  it('a client-rendered site every crawler is served: Access 40 (counted once), Readable 30 × 0.31 = 9.30', () => {
    const g = gradeCheck(csrSite(0.31));
    expect(g.ai_readability.components.access.score).toBe(40);
    expect(g.ai_readability.components.readable.score).toBe(9.3);
    // Quotable: every check that applies passes on all six pages (specs apply to none): 20.
    // Signals: schema and Content Signals present: 10. Total 40 + 9.30 + 20 + 10 = 79.30.
    expect(g.ai_readability).toMatchObject({ withheld: false, total: 79.3, grade: 'B' });
    expect(g.content).toMatchObject({ score: 100 });
    expect(g.grade_version).toBe('2.0.0');
  });

  it('before any page is rendered, AI readability is withheld for Readable, with the other components scored', () => {
    const g = gradeCheck(csrSite(null));
    expect(g.ai_readability).toMatchObject({
      withheld: true,
      withheld_reasons: ['readable_unmeasured'],
      total: null,
      access_range: null,
    });
    expect(g.ai_readability.components.readable).toMatchObject({
      score: null,
      range: { min: 0, max: 30 },
    });
    expect(g.ai_readability.components.access.score).toBe(40);
    expect(g.technical_seo.score).not.toBeNull();
  });

  it('a client-rendered homepage turns on v1 orphan suppression, read from the homepage features', () => {
    const base = csrSite(0.31);
    const s = site([
      { path: '/', links: ['/p/1', '/p/2', '/p/3', '/p/4'] },
      ...['/p/1', '/p/2', '/p/3', '/p/4'].map((path) => ({ path, links: ['/'] })),
      { path: '/lonely' },
    ]);
    const input = {
      ...base,
      pages: s.pages,
      edges: s.edges,
      structure: detectStructure(s),
      content: new Map(s.pages.map((p) => [p.url, ARTICLE])),
    };
    const shell = new Map(input.content).set(s.homepage_url, { ...ARTICLE, client_rendered: true });
    const statik = gradeCheck(input).technical_seo;
    const spa = gradeCheck({ ...input, content: shell }).technical_seo;
    expect(statik.breakdown.orphanRatioScore).toBeLessThan(1);
    expect(spa.breakdown.orphanRatioScore).toBe(1);
  });

  it("what it returns fits the contract's Check, stored beside a fixture check", () => {
    const data = JSON.parse(
      readFileSync(
        new URL('../../../../../apps/web/lib/fixtures/v2/clean-site.json', import.meta.url),
        'utf8',
      ),
    ) as { checks: Check[] };
    const base = data.checks.find((c) => c.status === 'finished')!;
    for (const share of [0.31, null]) {
      const g = gradeCheck(csrSite(share));
      const check = {
        ...base,
        grade_version: g.grade_version,
        technical_seo: g.technical_seo,
        ai_readability: g.ai_readability,
        content: g.content,
        signals: [
          ...base.signals.filter(
            (x) => x.signal !== 'schema_org' && x.signal !== 'content_signals',
          ),
          ...g.signals,
        ],
      };
      const parsed = CheckSchema.safeParse(check);
      expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
    }
  });
});
