import { describe, expect, it } from 'vitest';
import type { CrawlBatchResult, Finding } from '@crawlmouse/types/v2';
import { crawlBatch, crawlRow } from '../../../fixtures/v2/build/rows.js';
import { nothingReadReason } from './nothing-read.js';

const URL_A = 'https://example.test/';
const origin = 'https://example.test';
const HOME = URL_A;

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
      expect(nothingReadReason([batch([row])], HOME)).toBeNull();
    },
  );

  it('is null when one batch read a page and another read none', () => {
    const read = batch([crawlRow({ url: URL_A, outcome: 'fetched', status: 200 })]);
    const none = batch([notRequested()], [robots('network')]);
    expect(nothingReadReason([none, read], HOME)).toBeNull();
  });

  it.each(['network', 'timeout'] as const)(
    'is site_unreachable when robots.txt got no answer (%s)',
    (why) => {
      expect(nothingReadReason([batch([notRequested()], [robots(why)])], HOME)).toBe(
        'site_unreachable',
      );
    },
  );

  it.each(['server_error', 'challenged', 'byte_budget', 'redirect_status'] as const)(
    'is nothing_read when robots.txt was answered and unusable (%s): the host is up',
    (why) => {
      expect(nothingReadReason([batch([notRequested()], [robots(why)])], HOME)).toBe(
        'nothing_read',
      );
    },
  );

  it('is nothing_read for an address the SSRF guard refused, not "unreachable"', () => {
    const refused: Finding = { kind: 'site_refused', origin };
    expect(nothingReadReason([batch([failed()], [refused])], HOME)).toBe('nothing_read');
  });

  it('is nothing_read for a request that failed with robots.txt read: its error class is not stored', () => {
    expect(nothingReadReason([batch([failed()])], HOME)).toBe('nothing_read');
  });

  it('is nothing_read when robots.txt disallows every page', () => {
    const row = crawlRow({ url: URL_A, outcome: 'robots_disallowed' });
    expect(nothingReadReason([batch([row])], HOME)).toBe('nothing_read');
  });

  it('is nothing_read for a batch with no rows', () => {
    expect(nothingReadReason([batch([])], HOME)).toBe('nothing_read');
  });

  it('holds whichever order the batches arrive in', () => {
    const dead = batch([notRequested()], [robots('network')]);
    const empty = batch([]);
    expect(nothingReadReason([dead, empty], HOME)).toBe('site_unreachable');
    expect(nothingReadReason([empty, dead], HOME)).toBe('site_unreachable');
  });

  it('is nothing_read when only another origin of the site failed: the homepage was not shown to be down', () => {
    const www: Finding = {
      kind: 'robots_unreachable',
      origin: 'https://www.example.test',
      why: 'network',
    };
    expect(nothingReadReason([batch([notRequested()], [www])], HOME)).toBe('nothing_read');
  });

  it('is nothing_read when the homepage origin failed and another origin answered', () => {
    const answered = {
      ...batch([notRequested()], [robots('network')]),
      robots: [{ origin: 'https://www.example.test', status: 200 }],
    } as unknown as CrawlBatchResult;
    expect(nothingReadReason([answered], HOME)).toBe('nothing_read');
  });

  it('is nothing_read when the homepage timed out and answered in a later batch', () => {
    const later = {
      ...batch([notRequested()]),
      robots: [{ origin, status: 503 }],
    } as unknown as CrawlBatchResult;
    expect(nothingReadReason([batch([notRequested()], [robots('timeout')]), later], HOME)).toBe(
      'nothing_read',
    );
  });

  it('is site_unreachable when the only other origin also got no answer', () => {
    const silent = {
      ...batch([notRequested()], [robots('network')]),
      robots: [{ origin: 'https://www.example.test', status: null }],
    } as unknown as CrawlBatchResult;
    expect(nothingReadReason([silent], HOME)).toBe('site_unreachable');
  });
});
