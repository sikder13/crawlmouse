import { describe, expect, it } from 'vitest';
import { AccessCauseSchema, VerdictSchema, type Check } from '@crawlmouse/types/v2';
import { findCheck, fixesAsOf, fixture } from './fixtures';
import { CHECKS } from './recordings';
import { TEMPLATE_NOUNS } from './format';
import {
  aiShortSummary,
  aiSummary,
  isAllowed,
  isBlocked,
  isSingularNoun,
  keptOutClauses,
  nextBandSentence,
  seoSummary,
  structureWord,
  thinSentence,
} from './sentences';

const d = fixture('bad-site');
const check = findCheck(d, CHECKS.badFirstAudit);
const fixes = fixesAsOf(d, check);
const isOpen = (f: (typeof fixes)[number]) => fixes.indexOf(f) < 3;

describe('the sentences about a check', () => {
  it('words the fixes to the next band by how many are open', () => {
    const [a, b] = [
      fixes.find((f) => f.effect.technical_seo === 4)!,
      fixes.find((f) => f.effect.technical_seo === 2)!,
    ];
    expect(nextBandSentence(79, 'B', [a, b], () => true)).toBe(
      'Two fixes take it to A-; both are open now.',
    );
    expect(nextBandSentence(79, 'B', [a, b], () => false)).toBe(
      'Two fixes take it to A-; they are on Pro.',
    );
    expect(nextBandSentence(79, 'B', [a, b], (f) => f === a)).toBe(
      'Two fixes take it to A-; one of them is open now.',
    );
    expect(nextBandSentence(83, 'B+', [a], () => true)).toBe(
      'One fix takes it to A-; it is open now.',
    );
    expect(nextBandSentence(91, 'A', fixes, () => true)).toBeNull();
    expect(nextBandSentence(60, 'C', [b], () => true)).toBeNull();
  });

  it('says nothing about structure when the grade was refused, rather than calling it weak', () => {
    const refused: Check = {
      ...check,
      technical_seo: {
        ...check.technical_seo!,
        score: null,
        grade: null,
        site_structure_score: null,
      },
    };
    const s = seoSummary(refused, fixes, isOpen);
    expect(s).toBe('Seven pages nobody links to.');
    expect(s).not.toMatch(/structure/i);
  });

  it('keeps "blocked" for robots.txt and user-agent rules, groups crawlers sharing a fate, in the contract’s verdict order', () => {
    const c = (
      ua: string,
      verdict: Check['crawlers'][number]['verdict'],
      cause: Check['crawlers'][number]['cause'] = null,
    ) => ({
      ua,
      verdict,
      cause,
      evidence_class: 'simulated' as const,
      scored: true,
      group: 'ai_search' as const,
    });
    expect(
      keptOutClauses([
        c('A', 'challenged_ua'),
        c('B', 'disallowed_by_robots'),
        c('C', 'disallowed_by_robots'),
        c('D', 'allowed'),
      ]),
    ).toEqual(['B and C are blocked by robots.txt', 'A gets a challenge page']);
  });
});

/** A copy of the bad-site check with `edit` applied to it. */
const variant = (edit: (c: Check) => void): Check => {
  const c = structuredClone(check);
  edit(c);
  return c;
};
const crawler = (c: Check, ua: string) => c.crawlers.find((x) => x.ua === ua)!;
/** The crawler reads every template in full. */
const readsAll = (c: Check, ua: string) => {
  const r = crawler(c, ua);
  Object.assign(r, { verdict: 'allowed', cause: null, text_share: 0.95 });
  r.by_template.forEach((t) => (t.verdict = 'allowed'));
};
const SCORED_THIN = ['OAI-SearchBot', 'ChatGPT-User', 'Claude-SearchBot'];

describe('thin templates, counted per crawler', () => {
  it('names a template thin to the scored crawlers only when a scored crawler reads it thin', () => {
    // The scored crawlers read every template in full; only unscored ClaudeBot reads one thin.
    const c = variant((c) => SCORED_THIN.forEach((ua) => readsAll(c, ua)));
    expect(crawler(c, 'ClaudeBot').by_template.map((t) => t.verdict)).toContain('allowed_thin');
    expect(aiSummary(c)).toBe('PerplexityBot gets a challenge page.');
    expect(thinSentence(c)).toBeNull();
    expect(aiShortSummary(c)).toBe('PerplexityBot gets a challenge page.');
  });

  it('says how many read it thin, and which, when not all the crawlers that got in do', () => {
    const c = variant((c) => readsAll(c, 'OAI-SearchBot'));
    expect(aiSummary(c)).toBe(
      'PerplexityBot gets a challenge page; product pages are empty to ChatGPT-User and Claude-SearchBot.',
    );
    // One scored crawler reads the product template in full, so it is not "empty without JavaScript".
    expect(thinSentence(c)).toBeNull();
  });

  it('says every scored crawler gets in, on the AI card and its short form, when none is kept out or reads thin', () => {
    const c = variant((c) => [...SCORED_THIN, 'PerplexityBot'].forEach((ua) => readsAll(c, ua)));
    const all = 'All four scored crawlers get in and read 95% of the text or more.';
    expect(aiSummary(c)).toBe(all);
    expect(aiShortSummary(c)).toBe(all);
  });

  it('agrees the verb with a single template, and the homepage is the one singular page noun', () => {
    const c = variant((c) => {
      for (const ua of SCORED_THIN) {
        crawler(c, ua).by_template.forEach(
          (t) => (t.verdict = t.template_key === '/' ? 'allowed_thin' : 'allowed'),
        );
      }
    });
    expect(thinSentence(c)).toBe('The homepage is empty without JavaScript.');
    expect(aiSummary(c)).toBe(
      'PerplexityBot gets a challenge page; the homepage is empty to the other three.',
    );
    for (const [label, noun] of Object.entries(TEMPLATE_NOUNS)) {
      expect(isSingularNoun(noun.pages), label).toBe(label === 'Homepage');
    }
  });
});

describe('the wording at each threshold and form', () => {
  const seo = (points: number) =>
    fixes.find((f) => f.effect.technical_seo === points && f.effect.ai_readability === 0)!;
  const [four, two, one] = [seo(4), seo(2), seo(1)];

  it('words three fixes to the next band, all open or two of them', () => {
    // 78 + 4 + 2 + 1 = 85, the A- floor: three fixes.
    expect(nextBandSentence(78, 'B', [four, two, one], () => true)).toBe(
      'Three fixes take it to A-; all are open now.',
    );
    expect(nextBandSentence(78, 'B', [four, two, one], (f) => f !== one)).toBe(
      'Three fixes take it to A-; two of them are open now.',
    );
  });

  it('words a single fix on Pro', () => {
    expect(nextBandSentence(83, 'B+', [two], () => false)).toBe(
      'One fix takes it to A-; it is on Pro.',
    );
  });

  it('calls structure sound from 70, uneven from 50, and weak below', () => {
    expect(structureWord(100)).toBe('Sound structure');
    expect(structureWord(70)).toBe('Sound structure');
    expect(structureWord(69.99)).toBe('Uneven structure');
    expect(structureWord(50)).toBe('Uneven structure');
    expect(structureWord(49.99)).toBe('Weak structure');
    expect(structureWord(0)).toBe('Weak structure');
  });

  it('names each thin template, in the plural for more than one', () => {
    expect(thinSentence(check)).toBe('Product pages are empty without JavaScript.');
    const two = variant((c) => {
      for (const ua of SCORED_THIN) {
        crawler(c, ua).by_template.find((t) => t.template_key === '/blog/{slug}')!.verdict =
          'allowed_thin';
      }
    });
    expect(thinSentence(two)).toBe('Product pages and blog posts are empty without JavaScript.');
  });
});

describe('the vocabulary', () => {
  it('says "blocked" for robots.txt and user-agent rules and for no other verdict (FACTS I2)', () => {
    for (const verdict of VerdictSchema.options.filter((v) => !isAllowed(v))) {
      for (const cause of [null, ...AccessCauseSchema.options]) {
        const as = (ua: string) => ({
          ua,
          verdict,
          cause,
          evidence_class: 'simulated' as const,
          scored: true,
          group: 'ai_search' as const,
        });
        const clauses = [...keptOutClauses([as('A')]), ...keptOutClauses([as('A'), as('B')])];
        expect(clauses).toHaveLength(2);
        for (const clause of clauses) {
          expect(/\bblocked\b/.test(clause), `${verdict}/${cause}: ${clause}`).toBe(
            isBlocked(verdict),
          );
        }
      }
    }
  });
});
