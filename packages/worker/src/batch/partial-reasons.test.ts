import { describe, expect, it } from 'vitest';
import { BatchPartialReasonSchema, BatchPartialSchema } from '@crawlmouse/types/v2';
import { createFetcher } from '../fetch/fetcher.js';
import { Sites } from '../politeness/sites.js';
import { InstantClock } from '../test-support/clock.js';
import { startServer } from '../test-support/http.js';
import { Findings, PARTIAL_REASONS } from './findings.js';
import {
  MAX_CRAWL_DELAY_S,
  RobotsCache,
  SLOW_CRAWL_DELAY_S,
  type OriginRules,
} from './site-rules.js';
import { runBatch } from './run.js';

/**
 * Why a batch did less than it was asked, as fields the engine reads (CC-15's follow-up, PR #54),
 * not as limitation text: the reasons are a contract enum, and a batch result's `partial` parses
 * with the contract's schema before it leaves the worker.
 */

describe('batch partial reasons', () => {
  it('every finding that makes a batch partial gives a contract value, and every value has one', () => {
    // One of each finding the batch can record, made the way the batch makes it.
    const f = new Findings();
    for (const budget of ['requests', 'bytes', 'seconds'] as const) f.budgetSpent(budget);
    const at = 1_700_000_000_000;
    f.notRequested({
      reason: 'site_stopped',
      site: 'example.com',
      stop: { reason: 'three_429_responses', at, until: at + 1 },
    });
    // A reading as the batch holds it; only its state and the Crawl-delay are read here.
    const origin = (host: string, state: string, crawlDelayS: number | null): OriginRules => ({
      origin: `https://${host}`,
      reading: { state, why: 'status_5xx' } as unknown as OriginRules['reading'],
      crawlDelayS,
      fromCache: false,
    });
    f.origin(origin('a.example.com', 'unreachable', null));
    f.origin(origin('b.example.com', 'too_large', null));
    f.origin(origin('c.example.com', 'refused', null));
    f.origin(origin('d.example.com', 'rules', SLOW_CRAWL_DELAY_S));
    f.origin(origin('e.example.com', 'rules', MAX_CRAWL_DELAY_S + 1));
    f.resultSizeLimit(8);
    expect(f.partialReasons().sort()).toEqual([...BatchPartialReasonSchema.options].sort());
    expect(PARTIAL_REASONS).toBe(BatchPartialReasonSchema.options);
  });

  it('robots_unreachable reaches the result as a field the contract parses', async () => {
    const server = await startServer((req, res) => {
      res.statusCode = req.url === '/robots.txt' ? 503 : 200;
      res.end();
    });
    try {
      const clock = new InstantClock();
      const result = await runBatch(
        {
          kind: 'crawl',
          check_id: '00000000-0000-4000-8000-0000000000c5',
          site_id: '00000000-0000-4000-8000-0000000000a5',
          batch: 1,
          nonce: 'n'.repeat(16),
          jwt: 'x',
          budget: { max_requests: 100, max_bytes: 1_000_000, max_seconds: 60 },
          urls: [`${server.base}/`],
        },
        {
          clock,
          sites: new Sites(clock),
          fetcher: createFetcher(clock, { bypassSsrf: true }),
          robotsCache: new RobotsCache(clock),
        },
      );
      expect(BatchPartialSchema.parse(result.partial)).toEqual({ reasons: ['robots_unreachable'] });
    } finally {
      await server.close();
    }
  });

  it('a complete batch carries null, which the schema also accepts', () => {
    expect(BatchPartialSchema.parse(null)).toBeNull();
  });
});
