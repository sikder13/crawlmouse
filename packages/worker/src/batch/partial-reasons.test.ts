import { describe, expect, it } from 'vitest';
import { BatchPartialReasonSchema, BatchPartialSchema } from '@crawlmouse/types/v2';
import { createFetcher } from '../fetch/fetcher.js';
import { Sites } from '../politeness/sites.js';
import { InstantClock } from '../test-support/clock.js';
import { startServer } from '../test-support/http.js';
import { PARTIAL_REASONS } from './findings.js';
import { runBatch } from './run.js';
import { RobotsCache } from './site-rules.js';

/**
 * Why a batch did less than it was asked, as fields the engine reads (CC-15's follow-up, PR #54),
 * not as limitation text: the reasons are a contract enum, and a batch result's `partial` parses
 * with the contract's schema before it leaves the worker.
 */

describe('batch partial reasons', () => {
  it("are exactly the contract's BatchPartialReason values, in its order", () => {
    expect([...PARTIAL_REASONS]).toEqual(BatchPartialReasonSchema.options);
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
