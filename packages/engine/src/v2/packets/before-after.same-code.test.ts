/**
 * `after` is computed by the code the effect is computed with (CC-30 D7), shown by changing that
 * code: with the two counterfactual functions of grade/effects.ts replaced by ones that change
 * nothing, the rows say nothing changes. A row computed by a formula of its own would not follow.
 */
import { describe, expect, it, vi } from 'vitest';
import { CRAWLER_REGISTRY_V2 } from '../crawler-registry.js';
import { NO_STACK } from './test-support/facts.js';
import { accessRecord, contentRecord } from './test-support/records.js';
import type { PacketFacts } from './types.js';

vi.mock('../grade/effects.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../grade/effects.js')>()),
  servedAll: <T>(tally: T): T => tally,
  allPassing: <T>(tally: T): T => tally,
}));

const { beforeAfterOf } = await import('./before-after.js');

const facts: PacketFacts = {
  homepage_url: 'https://a.test',
  stack: NO_STACK,
  crawlers: CRAWLER_REGISTRY_V2.map((e) => ({
    ua: e.token,
    verdict: e.token === 'GPTBot' ? 'blocked_by_ua_rule' : 'allowed',
  })),
  pages: new Map(),
  edges: [],
  access_tests: [],
};

describe('with counterfactuals that change nothing', () => {
  it('the edge fix adds no crawler: the blocked pages stay blocked', () => {
    expect(beforeAfterOf({ family: 'access', record: accessRecord('GPTBot') }, facts)).toEqual([
      {
        measure: 'crawlers_reading_text',
        today: 5,
        after: 5,
        after_bound: 'exact',
        after_is_estimate: true,
      },
    ]);
  });

  it('the opening is still not quotable: the failing pages stay failing', () => {
    const record = contentRecord('direct_answer_150');
    expect(beforeAfterOf({ family: 'content', record }, facts)).toMatchObject([
      { measure: 'quotable_opening', today: false, after: false },
    ]);
  });
});
