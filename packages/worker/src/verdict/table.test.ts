import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { VerdictSchema } from '@crawlmouse/types/v2';
import { DECISION_TABLE, THIN_RATIO, decide, type Cell, type Observed } from './table.js';

const OBSERVED: Observed[] = [
  'served',
  'refused',
  'gone',
  'challenged',
  'rate_limited',
  'payment',
  'redirected_away',
  'error',
  'not_requested',
];

const anyCell: fc.Arbitrary<Cell> = fc.record({
  robots: fc.constantFrom('readable' as const, 'blocks_site' as const),
  crawlerAllowed: fc.boolean(),
  oursAllowed: fc.boolean(),
  control: fc.constantFrom(...OBSERVED),
  crawler: fc.constantFrom(...OBSERVED),
  canary: fc.constantFrom(...OBSERVED),
  words: fc.option(fc.integer({ min: 0, max: 5000 }), { nil: null }),
  controlWords: fc.option(fc.integer({ min: 0, max: 5000 }), { nil: null }),
});

/** A page where every request was served and robots allows everything. */
const base: Cell = {
  robots: 'readable',
  crawlerAllowed: true,
  oursAllowed: true,
  control: 'served',
  crawler: 'served',
  canary: 'not_requested',
  words: 500,
  controlWords: 500,
};

describe('decision table: shape', () => {
  it('gives every possible cell exactly one row, and every verdict is one of the eleven (property)', () => {
    fc.assert(
      fc.property(anyCell, (cell) => {
        const row = decide(cell);
        expect(VerdictSchema.options).toContain(row.verdict);
      }),
      { numRuns: 5000 },
    );
  });

  it('reaches every row: each row is the first match for some cell', () => {
    const reached = new Set<string>();
    fc.assert(
      fc.property(anyCell, (cell) => void reached.add(decide(cell).id)),
      { numRuns: 20000 },
    );
    expect([...reached].sort()).toEqual(DECISION_TABLE.map((r) => r.id).sort());
  });

  it('has unique row ids', () => {
    const ids = DECISION_TABLE.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('decision table: the canary rule', () => {
  it('blocked_by_ua_rule if and only if the crawler was refused and the canary was served (property)', () => {
    fc.assert(
      fc.property(anyCell, (cell) => {
        const blocked = decide(cell).verdict === 'blocked_by_ua_rule';
        const expected =
          cell.robots === 'readable' &&
          cell.crawlerAllowed &&
          cell.oursAllowed &&
          cell.control === 'served' &&
          (cell.crawler === 'refused' || cell.crawler === 'gone') &&
          cell.canary === 'served';
        expect(blocked).toBe(expected);
      }),
      { numRuns: 5000 },
    );
  });

  it.each(['refused', 'challenged', 'rate_limited', 'error', 'not_requested'] as const)(
    'a refusal with the canary %s is refused_unverified, even when other crawlers were served',
    (canary) => {
      expect(decide({ ...base, crawler: 'refused', canary }).verdict).toBe('refused_unverified');
    },
  );

  it('treats a 404 or 410 to the crawler, while the control was served, as a refusal', () => {
    expect(decide({ ...base, crawler: 'gone', canary: 'served' }).verdict).toBe(
      'blocked_by_ua_rule',
    );
    expect(decide({ ...base, crawler: 'gone', canary: 'refused' }).verdict).toBe(
      'refused_unverified',
    );
  });
});

describe('decision table: precedence', () => {
  it('robots.txt blocking the site wins over everything', () => {
    fc.assert(
      fc.property(anyCell, (cell) => {
        expect(decide({ ...cell, robots: 'blocks_site' }).verdict).toBe('not_measured');
      }),
    );
  });

  it("a disallow of the crawler's token wins whatever the requests got (property)", () => {
    fc.assert(
      fc.property(anyCell, (cell) => {
        const row = decide({ ...cell, robots: 'readable', crawlerAllowed: false });
        expect(row).toMatchObject({ verdict: 'disallowed_by_robots', evidence: 'declared' });
      }),
    );
  });

  it('a blocked control is edge_blocks_automation whatever the crawler got', () => {
    for (const control of ['challenged', 'refused'] as const) {
      for (const crawler of OBSERVED)
        expect(decide({ ...base, control, crawler }).verdict).toBe('edge_blocks_automation');
    }
  });

  it('a control that was not served for any other reason is not_measured', () => {
    for (const control of [
      'gone',
      'rate_limited',
      'payment',
      'redirected_away',
      'error',
      'not_requested',
    ] as const) {
      expect(decide({ ...base, control }).verdict).toBe('not_measured');
    }
  });

  it.each([
    ['rate_limited', 'rate_limited', 'rate_limit_429'],
    ['payment', 'payment_required', 'pay_per_crawl_402'],
    ['redirected_away', 'redirected_away', 'cross_host_redirect'],
    ['challenged', 'challenged_ua', 'automation_challenge'],
    ['error', 'not_measured', null],
    ['not_requested', 'not_measured', null],
  ] as const)('crawler %s -> %s, cause %s', (crawler, verdict, cause) => {
    const row = decide({ ...base, crawler });
    expect(row.verdict).toBe(verdict);
    expect(row.cause.of({ control: null, crawler: null })).toBe(cause);
  });
});

describe('decision table: thin', () => {
  it(`is allowed at exactly ${THIN_RATIO * 100}% of the control's words, allowed_thin just under`, () => {
    expect(decide({ ...base, words: 400, controlWords: 500 }).verdict).toBe('allowed');
    expect(decide({ ...base, words: 399, controlWords: 500 }).verdict).toBe('allowed_thin');
  });

  it('a served response with no word count to compare is not measured, never allowed', () => {
    expect(decide({ ...base, words: null, controlWords: 500 })).toMatchObject({
      id: 'served_uncounted',
      verdict: 'not_measured',
    });
    expect(decide({ ...base, words: 400, controlWords: null }).verdict).toBe('not_measured');
  });

  it('is allowed when neither response has text to compare (both counted, both 0)', () => {
    expect(decide({ ...base, words: 0, controlWords: 0 }).verdict).toBe('allowed');
  });

  it('a crawler response with no page text against a control with text is thin', () => {
    expect(decide({ ...base, words: 0, controlWords: 500 }).verdict).toBe('allowed_thin');
  });

  it('allowed only with both word counts taken (property)', () => {
    fc.assert(
      fc.property(anyCell, (cell) => {
        if (decide(cell).verdict === 'allowed') {
          expect(cell.words).not.toBeNull();
          expect(cell.controlWords).not.toBeNull();
          expect(cell.words!).toBeGreaterThanOrEqual(THIN_RATIO * cell.controlWords!);
        }
      }),
      { numRuns: 5000 },
    );
  });
});
