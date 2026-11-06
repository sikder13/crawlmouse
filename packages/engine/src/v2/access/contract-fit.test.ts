/**
 * What the access detectors hand on must fit the contract it will be stored in: each matrix row, less
 * the engine-only extras and with `text_share` (CC-14's) left null, is a CrawlerResult, and the
 * withholding decision is one the contract's Check rules (`i4_withheld`, `withheld_reasons`) accept. The
 * checks are taken from the CC-11 fixtures, a measured one and a withheld one, with only their
 * crawler rows replaced by ours.
 */
import { readFileSync } from 'node:fs';
import { CheckSchema, CrawlerResultSchema, type Check } from '@crawlmouse/types/v2';
import { describe, expect, it } from 'vitest';
import { fixtureInput, grid } from '../../../fixtures/v2/access/builders.js';
import { detectAccess } from './index.js';
import type { AccessResult, CrawlerAccess } from './types.js';

function contractCheck(file: string, withheld: boolean): Check {
  const data = JSON.parse(
    readFileSync(
      new URL(`../../../../../apps/web/lib/fixtures/v2/${file}.json`, import.meta.url),
      'utf8',
    ),
  ) as { checks: Check[] };
  return data.checks.find((c) => c.ai_readability?.withheld === withheld)!;
}

const MEASURED = contractCheck('clean-site', false);
const WITHHELD = contractCheck('challenged-site', true);

const asResult = ({
  counts: _c,
  supporting: _s,
  intent: _i,
  extent: _e,
  ...row
}: CrawlerAccess) => ({
  ...row,
  text_share: null,
});

const withRows = (check: Check, r: AccessResult): Check => ({
  ...check,
  crawlers: r.crawlers.map(asResult),
});

describe('the matrix fits the contract', () => {
  it.each([
    ['a clean grid', grid({ pages: ['/', '/p/1'] })],
    ['nike.com shape', fixtureInput('nike-com-shape.json')],
    ['cnn.com shape', fixtureInput('cnn-com-shape.json')],
    ['npr, derived', fixtureInput('npr-robots-unreachable.json')],
  ])('%s: every row is a CrawlerResult', (_name, input) => {
    for (const row of detectAccess(input).crawlers)
      expect(CrawlerResultSchema.safeParse(asResult(row)).success).toBe(true);
  });
});

describe('withholding agrees with the contract’s Check rule', () => {
  it('a check we would give a grade passes with a measured grade, and withheld only with a reason', () => {
    const r = detectAccess(grid({ pages: ['/', '/p/1'] }));
    expect(r.access_withheld).toBe(false);
    expect(CheckSchema.safeParse(withRows(MEASURED, r)).success).toBe(true);
    expect(CheckSchema.safeParse(withRows(WITHHELD, r)).success).toBe(true);
    const unexplained = withRows(WITHHELD, r);
    unexplained.ai_readability = { ...unexplained.ai_readability!, withheld_reasons: [] };
    expect(JSON.stringify(CheckSchema.safeParse(unexplained).error?.issues)).toContain(
      'withheld_reasons',
    );
  });

  it('a check we would withhold passes withheld and fails with a measured grade', () => {
    const r = detectAccess(fixtureInput('npr-robots-unreachable.json'));
    expect(r.access_withheld).toBe(true);
    expect(CheckSchema.safeParse(withRows(WITHHELD, r)).success).toBe(true);
    const wrong = withRows(MEASURED, r);
    expect(JSON.stringify(CheckSchema.safeParse(wrong).error?.issues)).toContain('i4_withheld');
  });

  it('one scored crawler measured, at the boundary, is withheld by both', () => {
    const cells = {
      'OAI-SearchBot': ['allowed', 'allowed'],
      'ChatGPT-User': ['not_measured', 'not_measured'],
      PerplexityBot: ['not_measured', 'not_measured'],
      'Claude-SearchBot': ['edge_blocks_automation', 'edge_blocks_automation'],
    } as const;
    const r = detectAccess(grid({ pages: ['/', '/p/1'], cells }));
    expect(r.scored_measured).toBe(1);
    expect(r.access_withheld).toBe(true);
    expect(CheckSchema.safeParse(withRows(WITHHELD, r)).success).toBe(true);
  });
});
