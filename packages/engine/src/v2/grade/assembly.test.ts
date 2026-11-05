/**
 * The two declarations, and both grades assembled from a check's records: the client-rendered site
 * every crawler is served (31 % of its text without JavaScript), and the same site before any page is
 * rendered, which is every check until CC-14 runs.
 */
import { CheckSchema, type Check } from '@crawlmouse/types/v2';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { site } from '../../../fixtures/v2/detectors/builders.js';
import type { ContentFeatures } from '../content/read.js';
import { detectStructure } from '../detectors/index.js';
import { contentSignals, schemaOrg } from './declarations.js';
import { csrSite, post } from '../../../fixtures/v2/grade/sites.js';
import { gradeCheck } from './index.js';

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
    // a key that merely ends in a signal's name is not that signal
    expect(contentSignals('Content-Signal: x-search=yes').state).toBe('not_detected');
    expect(contentSignals('Content-Signal: no-ai-train=no').state).toBe('not_detected');
    expect(contentSignals('Content-Signal: foo=1;ai-train=no').state).toBe('detected');
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
    expect(schemaOrg(f([[], ['WebPage']]), 0).state).toBe('detected');
    expect(schemaOrg(f([[], []]), 0).state).toBe('not_detected');
    expect(schemaOrg([], 0).state).toBe('indeterminate');
  });

  it('with a graded page not fetched: present if a read page is marked, otherwise undecided, not absent', () => {
    expect(schemaOrg(f([[], ['WebPage']]), 3).state).toBe('detected');
    expect(schemaOrg(f([[], []]), 1)).toMatchObject({
      state: 'indeterminate',
      evidence: 'No JSON-LD on the 2 graded pages read; 1 not read.',
    });
    expect(schemaOrg([], 2).state).toBe('indeterminate');
  });
});

const ARTICLE = post(true);

describe('both grades for a check', () => {
  it('a client-rendered site every crawler is served: Access 40 (counted once), Readable 30 × 0.31 = 9.30', () => {
    const g = gradeCheck(csrSite(0.31));
    expect(g.ai_readability.components.access.score).toBe(40);
    expect(g.ai_readability.components.readable.score).toBe(9.3);
    // Signals: schema and Content Signals present: 10. Quotable counts no check yet, so the grade is
    // withheld for it alone, with Quotable's range 0..20: the total would be 59.30 to 79.30.
    expect(g.ai_readability.components.signals.score).toBe(10);
    expect(g.ai_readability).toMatchObject({
      withheld: true,
      withheld_reasons: ['quotable_unmeasured'],
      total: null,
      scored_from_fewer_crawlers: null,
    });
    expect(g.ai_readability.components.quotable).toMatchObject({
      score: null,
      range: { min: 0, max: 20 },
    });
    expect(g.content).toBe(null);
    expect(g.grade_version).toBe('2.0.0');
  });

  it('before any page is rendered, AI readability is withheld for Readable too, with Access and Signals scored', () => {
    const g = gradeCheck(csrSite(null));
    expect(g.ai_readability).toMatchObject({
      withheld: true,
      withheld_reasons: ['readable_unmeasured', 'quotable_unmeasured'],
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

  it('no check counts in Quotable: what the checks find moves neither Quotable nor the Content section', () => {
    const base = csrSite(0.31);
    const failing = {
      ...post(false),
      json_ld: [],
      headings: { count: 4, questions: 0, section_questions: 0 },
    };
    const g = gradeCheck({
      ...base,
      content: new Map([...base.content.keys()].map((u) => [u, failing])),
    });
    expect(g.content).toBe(null);
    expect(g.ai_readability.components.quotable).toEqual(
      gradeCheck(base).ai_readability.components.quotable,
    );
    // every page fails three checks; author/date and specs do not apply without an Article or Product node
    expect([...g.content_failures.values()]).toEqual(
      Array(6).fill(['direct_answer_150', 'question_headings', 'schema_with_description']),
    );
  });

  it('a graded page not fetched leaves the Content section without a score, and Quotable a range', () => {
    const base = csrSite(0.31);
    const [first, ...rest] = [...base.content.entries()];
    expect(first).toBeDefined();
    const g = gradeCheck({ ...base, content: new Map(rest) });
    expect(g.content).toBe(null);
    expect(g.ai_readability.components.quotable.score).toBe(null);
    expect(g.ai_readability.components.quotable.range).not.toBe(null);
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
