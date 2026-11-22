import { describe, expect, it } from 'vitest';
import type { CrawlBatchResult, Finding } from '@crawlmouse/types/v2';
import { crawlBatch, crawlRow } from '../../../fixtures/v2/build/rows.js';
import { nothingReadReason } from './nothing-read.js';

const URL_A = 'https://example.test/';
const origin = 'https://example.test';

const batch = (pages: CrawlBatchResult['pages'], findings: Finding[] = []): CrawlBatchResult => ({
  ...crawlBatch(0, pages),
  findings,
});

const robots = (
  why: 'network' | 'timeout' | 'server_error' | 'challenged' | 'byte_budget' | 'redirect_status',
): Finding => ({
  kind: 'robots_unreachable',
  origin,
  why,
});
const notRequested = () => crawlRow({ url: URL_A, outcome: 'not_requested' });
const failed = () => crawlRow({ url: URL_A, outcome: 'failed' });

describe('nothingReadReason: a crawl that got no response from any page', () => {
  it.each([200, 403, 404, 429, 500, 503])(
    'is null when a page answered, even with %i: that is a response to report',
    (status) => {
      const row = crawlRow({ url: URL_A, outcome: 'fetched', status });
      expect(nothingReadReason([batch([row])])).toBeNull();
    },
  );

  it('is null when one batch read a page and another read none', () => {
    const read = batch([crawlRow({ url: URL_A, outcome: 'fetched', status: 200 })]);
    const none = batch([notRequested()], [robots('network')]);
    expect(nothingReadReason([none, read])).toBeNull();
  });

  it.each(['network', 'timeout'] as const)(
    'is site_unreachable when robots.txt got no answer (%s)',
    (why) => {
      expect(nothingReadReason([batch([notRequested()], [robots(why)])])).toBe('site_unreachable');
    },
  );

  it.each(['server_error', 'challenged', 'byte_budget', 'redirect_status'] as const)(
    'is nothing_read when robots.txt was answered and unusable (%s): the host is up',
    (why) => {
      expect(nothingReadReason([batch([notRequested()], [robots(why)])])).toBe('nothing_read');
    },
  );

  it('is nothing_read for an address the SSRF guard refused, not "unreachable"', () => {
    const refused: Finding = { kind: 'site_refused', origin };
    expect(nothingReadReason([batch([failed()], [refused])])).toBe('nothing_read');
  });

  it('is nothing_read for a request that failed with robots.txt read: its error class is not stored', () => {
    expect(nothingReadReason([batch([failed()])])).toBe('nothing_read');
  });

  it('is nothing_read when robots.txt disallows every page', () => {
    const row = crawlRow({ url: URL_A, outcome: 'robots_disallowed' });
    expect(nothingReadReason([batch([row])])).toBe('nothing_read');
  });

  it('is nothing_read for a batch with no rows', () => {
    expect(nothingReadReason([batch([])])).toBe('nothing_read');
  });

  it('holds whichever order the batches arrive in', () => {
    const dead = batch([notRequested()], [robots('network')]);
    const empty = batch([]);
    expect(nothingReadReason([dead, empty])).toBe('site_unreachable');
    expect(nothingReadReason([empty, dead])).toBe('site_unreachable');
  });
});
