/**
 * The AI readability formula against independent truth: every expected value below was worked by hand
 * from the pinned formula (SPEC 17), with the arithmetic beside it, before the code existed. A row is a
 * site; its numbers are not produced by the code under test.
 */
import type { Verdict } from '@crawlmouse/types/v2';
import { describe, expect, it } from 'vitest';
import { every, grid } from '../../../fixtures/v2/access/builders.js';
import { detectAccess } from '../access/index.js';
import { accessScore, type CrawlerTally } from './access.js';
import { aiReadability } from './ai-readability.js';
import { quotableScore } from './quotable.js';
import { readableScore } from './readable.js';
import { signalsScore } from './signals.js';

const SCORED = ['OAI-SearchBot', 'ChatGPT-User', 'PerplexityBot', 'Claude-SearchBot'] as const;

/** A scored crawler with these cells; robots.txt read on every cell but `not_measured`. */
function crawler(ua: string, cells: Partial<Record<Verdict, number>>): CrawlerTally {
  const read = Object.entries(cells)
    .filter(([v]) => v !== 'not_measured')
    .reduce((n, [, k]) => n + (k ?? 0), 0);
  return {
    ua,
    scored: true,
    counts: cells,
    extent: {
      robots: { disallowed: cells.disallowed_by_robots ?? 0, read },
      edge: { blocked: 0, served: 0, answered: 0 },
    },
  };
}
const four = (...cells: Partial<Record<Verdict, number>>[]) =>
  SCORED.map((ua, i) => crawler(ua, cells[i]!));

describe('Access (max 40)', () => {
  it('A1: two crawlers served on 4 pages, two blocked by a user-agent rule: 40 × (1+1+0+0)/4 = 20', () => {
    const a = accessScore(
      four({ allowed: 4 }, { allowed: 4 }, { blocked_by_ua_rule: 4 }, { blocked_by_ua_rule: 4 }),
    );
    expect(a).toEqual({ score: 20, range: null, reason: null });
  });

  it('A2: unblocking one of four crawlers fully is exactly +10.00: 40 × (1+1+1+0)/4 = 30', () => {
    const before = accessScore(
      four({ allowed: 4 }, { allowed: 4 }, { blocked_by_ua_rule: 4 }, { blocked_by_ua_rule: 4 }),
    );
    const after = accessScore(
      four({ allowed: 4 }, { allowed: 4 }, { allowed: 4 }, { blocked_by_ua_rule: 4 }),
    );
    expect(after.score).toBe(30);
    expect(after.score! - before.score!).toBe(10);
  });

  it('A3: 6 served and 4 served thin is (6 + 4 × 0.5)/10 = 0.8; 40 × (0.8+1+1+1)/4 = 38', () => {
    const a = accessScore(
      four({ allowed: 6, allowed_thin: 4 }, { allowed: 4 }, { allowed: 4 }, { allowed: 4 }),
    );
    expect(a.score).toBe(38);
  });

  it('A4: a crawler robots.txt disallows on every page is left out: 40 × (1+1+0)/3 = 26.67', () => {
    const a = accessScore(
      four({ allowed: 4 }, { allowed: 4 }, { disallowed_by_robots: 4 }, { blocked_by_ua_rule: 4 }),
    );
    expect(a.score).toBe(26.67);
  });

  it('A4b: a robots.txt disallow never lowers the score: the same site with that crawler served scores no less', () => {
    const blocked = accessScore(
      four({ allowed: 4 }, { allowed: 4 }, { disallowed_by_robots: 4 }, { allowed: 4 }),
    );
    expect(blocked.score).toBe(40);
  });

  it('A5: one measured crawler and three refused unverified: withheld, range [40×1/4, 40×(1+3)/4] = [10, 40]', () => {
    const a = accessScore(
      four(
        { allowed: 2 },
        { refused_unverified: 2 },
        { refused_unverified: 2 },
        { refused_unverified: 2 },
      ),
    );
    expect(a).toEqual({
      score: null,
      range: { min: 10, max: 40 },
      reason: 'too_few_crawlers_measured',
    });
  });

  it('A6: every scored crawler disallowed by robots.txt on every page: withheld, blocked by choice', () => {
    const d = { disallowed_by_robots: 3 };
    expect(accessScore(four(d, d, d, d))).toEqual({
      score: null,
      range: { min: 0, max: 40 },
      reason: 'blocked_by_choice',
    });
  });

  it('A7: a crawler with one page in its denominator is not measured: 40 × (1+1+0)/3 = 26.67', () => {
    const a = accessScore(
      four(
        { allowed: 2 },
        { allowed: 2 },
        { blocked_by_ua_rule: 1, rate_limited: 3 },
        { blocked_by_ua_rule: 2 },
      ),
    );
    expect(a.score).toBe(26.67);
  });

  it('A8: edge_blocks_automation pages leave the denominator: c1 = 2/2, so 40', () => {
    const a = accessScore(
      four(
        { allowed: 2, edge_blocks_automation: 3 },
        { allowed: 4 },
        { allowed: 4 },
        { allowed: 4 },
      ),
    );
    expect(a.score).toBe(40);
  });

  it('A9: challenged pages leave the denominator: c1 = 2/2, so 40', () => {
    const a = accessScore(
      four({ allowed: 2, challenged_ua: 2 }, { allowed: 4 }, { allowed: 4 }, { allowed: 4 }),
    );
    expect(a.score).toBe(40);
  });

  it('A9b: rate-limited, pay-per-crawl and redirected-away pages leave the denominator', () => {
    const a = accessScore(
      four(
        { allowed: 2, rate_limited: 5 },
        { allowed: 2, payment_required: 5 },
        { allowed: 2, redirected_away: 5 },
        { allowed: 2, not_measured: 5 },
      ),
    );
    expect(a.score).toBe(40);
  });

  it('A10: a client-rendered site with every crawler served (31% of the text for crawler and control alike) scores 40, from the access rows', () => {
    const r = detectAccess(grid({ pages: ['/', '/p/1', '/p/2'] }));
    expect(accessScore(r.crawlers).score).toBe(40);
  });

  it('A1 from the access rows: two scored crawlers blocked by a user-agent rule on 2 pages', () => {
    const blocked = every(2, 'blocked_by_ua_rule');
    const r = detectAccess(
      grid({
        pages: ['/', '/p/1'],
        cells: { PerplexityBot: blocked, 'Claude-SearchBot': blocked },
      }),
    );
    expect(accessScore(r.crawlers).score).toBe(20);
  });
});

describe('Readable (max 30)', () => {
  const pages = (template: string, n: number, shares: (number | null)[]) =>
    Array.from({ length: n }, (_, i) => ({
      template_key: template,
      text_share: shares[i] ?? null,
    }));

  it('R1: 30 × (158×0.31 + 42×1 + 14×0.99)/214 = 30 × 104.84/214 = 14.70', () => {
    const r = readableScore([
      ...pages('/products/{slug}', 158, [0.3, 0.31, 0.33]),
      ...pages('/collections/{slug}', 42, [1]),
      ...pages('/blog/{slug}', 14, [0.98, 1]),
    ]);
    expect(r).toEqual({ score: 14.7, range: null });
  });

  it('R2: an unrendered template makes a range: [30×48.98/200, 30×(48.98+42)/200] = [7.35, 13.65]', () => {
    const r = readableScore([
      ...pages('/products/{slug}', 158, [0.31]),
      ...pages('/collections/{slug}', 42, []),
    ]);
    expect(r).toEqual({ score: null, range: { min: 7.35, max: 13.65 } });
  });

  it('R3: nothing rendered: range [0, 30]', () => {
    expect(readableScore(pages('/', 5, []))).toEqual({ score: null, range: { min: 0, max: 30 } });
  });

  it('R4: the median of an even sample is the mean of the middle two: 30 × (0.2+0.4)/2 = 9', () => {
    expect(readableScore(pages('/a', 4, [0.2, 0.4])).score).toBe(9);
  });

  it('R5: one template at 31%: 30 × 0.31 = 9.30', () => {
    expect(readableScore(pages('/', 3, [0.31, 0.31, 0.31])).score).toBe(9.3);
  });

  it('no graded page: range [0, 30]', () => {
    expect(readableScore([])).toEqual({ score: null, range: { min: 0, max: 30 } });
  });
});

describe('Quotable (max 20)', () => {
  // The counted checks: question_headings, schema_with_description, author_and_date. Answer-first and
  // specs-as-text are reported but not counted (CONTENT_CHECKS `scored`), so they are not inputs here.
  const none = { passing: 0, decided: 0, unread: 0 };

  it('Q1: 20 × (2/13 + 13/13 + 13/13)/3 = 14.36', () => {
    const q = quotableScore({
      checks: {
        question_headings: { passing: 2, decided: 13, unread: 0 },
        schema_with_description: { passing: 13, decided: 13, unread: 0 },
        author_and_date: { passing: 13, decided: 13, unread: 0 },
      },
    });
    expect(q).toEqual({ score: 14.36, range: null });
  });

  it('Q2: 8 more pages with a question heading: 20 × (10/13 + 1 + 1)/3 = 18.46', () => {
    const q = quotableScore({
      checks: {
        question_headings: { passing: 10, decided: 13, unread: 0 },
        schema_with_description: { passing: 13, decided: 13, unread: 0 },
        author_and_date: { passing: 13, decided: 13, unread: 0 },
      },
    });
    expect(q.score).toBe(18.46);
  });

  it('Q3: two unread pages make a range: each check open on them could pass or fail there, so [9.44, 17.22]', () => {
    const q = quotableScore({
      checks: {
        question_headings: { passing: 5, decided: 10, unread: 2 },
        schema_with_description: { passing: 12, decided: 12, unread: 0 },
        author_and_date: { passing: 0, decided: 0, unread: 2 },
      },
    });
    // lower = 20 × (5/12 + 12/12 + 0/2)/3 = 9.44; upper = 20 × (7/12 + 12/12 + 2/2)/3 = 17.22
    expect(q).toEqual({ score: null, range: { min: 9.44, max: 17.22 } });
  });

  it('Q3b: a check decided on every read page widens by its own unread pages only: [15, 17.22]', () => {
    const q = quotableScore({
      checks: {
        question_headings: { passing: 5, decided: 10, unread: 2 },
        schema_with_description: { passing: 12, decided: 12, unread: 0 },
        author_and_date: { passing: 10, decided: 10, unread: 2 },
      },
    });
    // lower = 20 × (5/12 + 1 + 10/12)/3 = 15; upper = 20 × (7/12 + 1 + 12/12)/3 = 17.22
    expect(q).toEqual({ score: null, range: { min: 15, max: 17.22 } });
  });

  it('no counted check applies to any page, and nothing unread: range [0, 20]', () => {
    const q = quotableScore({
      checks: { question_headings: none, schema_with_description: none, author_and_date: none },
    });
    expect(q).toEqual({ score: null, range: { min: 0, max: 20 } });
  });
});

describe('Signals (max 10)', () => {
  it('S1: schema and Content Signals present: 5 + 5 = 10', () => {
    expect(signalsScore({ schema_org: 'detected', content_signals: 'detected' })).toEqual({
      score: 10,
      range: null,
    });
  });
  it('S2: schema only: 5', () => {
    expect(signalsScore({ schema_org: 'detected', content_signals: 'not_detected' }).score).toBe(5);
  });
  it('S3: Content Signals undecided: range [5, 10]', () => {
    expect(signalsScore({ schema_org: 'detected', content_signals: 'indeterminate' })).toEqual({
      score: null,
      range: { min: 5, max: 10 },
    });
  });
});

describe('the AI readability grade', () => {
  it('T1: 20 + 14.70 + 12.69 + 10 = 57.39, on the engine letter scale (55 <= 57.39 < 60: C-)', () => {
    const g = aiReadability({
      access: { score: 20, range: null, reason: null },
      readable: { score: 14.7, range: null },
      quotable: { score: 12.69, range: null },
      signals: { score: 10, range: null },
    });
    expect(g.withheld).toBe(false);
    expect(g.total).toBe(57.39);
    expect(g.grade).toBe('C-');
  });

  it('T2: an unmeasured component withholds the grade, names why, and keeps the others', () => {
    const g = aiReadability({
      access: { score: 30, range: null, reason: null },
      readable: { score: null, range: { min: 0, max: 30 } },
      quotable: { score: 12.69, range: null },
      signals: { score: 10, range: null },
    });
    expect(g).toMatchObject({
      withheld: true,
      withheld_reasons: ['readable_unmeasured'],
      total: null,
      grade: null,
      access_range: null,
    });
    expect(g.components.access).toEqual({ score: 30, max: 40, heuristic: false, range: null });
    expect(g.components.readable).toEqual({
      score: null,
      max: 30,
      heuristic: false,
      range: { min: 0, max: 30 },
    });
  });

  it('T3: Access withheld for too few crawlers mirrors its range into access_range', () => {
    const g = aiReadability({
      access: { score: null, range: { min: 10, max: 40 }, reason: 'too_few_crawlers_measured' },
      readable: { score: 9.3, range: null },
      quotable: { score: 12.69, range: null },
      signals: { score: 10, range: null },
    });
    expect(g).toMatchObject({
      withheld: true,
      withheld_reasons: ['too_few_crawlers_measured'],
      access_range: { min: 10, max: 40 },
    });
  });
});
