import { describe, expect, it } from 'vitest';
import { BatchPartialReasonSchema, type BatchPartialReason } from '@crawlmouse/types/v2';
import { accessBatch, crawlBatch } from '../../../fixtures/v2/build/rows.js';
import { decideStatus, PARTIAL_RULE } from './status.js';

const partial = (reasons: BatchPartialReason[]) => ({ reasons });
const crawlWith = (reasons: BatchPartialReason[]) => ({
  crawl: [crawlBatch(0, [], [], [], reasons.length ? partial(reasons) : null)],
  access: [],
});

describe("a built check's status", () => {
  it('decides every partial reason the contract lists', () => {
    expect(Object.keys(PARTIAL_RULE).sort()).toEqual([...BatchPartialReasonSchema.options].sort());
  });

  it('is finished when no batch did less than it was asked', () => {
    expect(decideStatus(crawlWith([]))).toEqual({
      status: 'finished',
      reasons: [],
      crawl_partial: false,
      unfinished: [],
    });
  });

  it.each(BatchPartialReasonSchema.options.filter((r) => PARTIAL_RULE[r].partial))(
    'is partial, the crawl cut short, for %s on a crawl batch',
    (reason) => {
      expect(decideStatus(crawlWith([reason]))).toEqual({
        status: 'partial',
        reasons: [reason],
        crawl_partial: true,
        unfinished: [],
      });
    },
  );

  it('is finished for a Crawl-delay honoured in full: slow, and every URL still fetched', () => {
    expect(decideStatus(crawlWith(['crawl_delay_10s_or_more']))).toEqual({
      status: 'finished',
      reasons: [],
      crawl_partial: false,
      unfinished: [],
    });
  });

  it("is partial for an access batch's spent budget, without telling the structure detectors the crawl was cut", () => {
    const b = { ...accessBatch(1, []), partial: partial(['budget_requests']) };
    expect(decideStatus({ crawl: [crawlBatch(0, [])], access: [b] })).toEqual({
      status: 'partial',
      reasons: ['budget_requests'],
      crawl_partial: false,
      unfinished: [],
    });
  });

  it('lists each reason once, sorted, across batches', () => {
    const batches = {
      crawl: [
        crawlBatch(0, [], [], [], partial(['site_stopped', 'budget_bytes'])),
        crawlBatch(1, [], [], [], partial(['budget_bytes'])),
      ],
      access: [],
    };
    expect(decideStatus(batches).reasons).toEqual(['budget_bytes', 'site_stopped']);
  });

  it('is partial, the crawl cut short, when the crawl was not run to its end', () => {
    expect(decideStatus(crawlWith([]), ['crawl'])).toEqual({
      status: 'partial',
      reasons: [],
      crawl_partial: true,
      unfinished: ['crawl'],
    });
  });

  it('is partial, the crawl whole, when the sample was not tested to its end', () => {
    expect(decideStatus(crawlWith([]), ['sample'])).toEqual({
      status: 'partial',
      reasons: [],
      crawl_partial: false,
      unfinished: ['sample'],
    });
  });
});
