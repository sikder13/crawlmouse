import { describe, expect, it } from 'vitest';
import type { Check } from '@crawlmouse/types/v2';
import { findCheck, fixesAsOf, fixture } from './fixtures';
import { CHECKS } from './recordings';
import { keptOutClauses, nextBandSentence, seoSummary } from './sentences';

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

  it('keeps "blocked" for robots.txt and user-agent rules, groups crawlers sharing a fate, worst first', () => {
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
