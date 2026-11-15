import { beforeEach, describe, expect, it, vi } from 'vitest';

const captured = vi.hoisted(() => [] as { message: string; opts: Record<string, unknown> }[]);
vi.mock('@sentry/nextjs', () => ({
  captureMessage: (message: string, opts: Record<string, unknown>) =>
    captured.push({ message, opts }),
  flush: async () => true,
}));

import type { BuiltCheck } from '@crawlmouse/engine/v2/pipeline';
import type { CrawlBatchResult } from '@crawlmouse/types/v2';
import { checkRef } from '../pipeline/public';
import { storeLedgerDraft } from './draft-step';
import { ledgerWork } from './functions';
import { resetLedgerReportsForTest } from './report';
import type { LedgerStore } from './write';

const SECRET = 'ab'.repeat(32);
const CHECK = '3f1c2a7e-0000-4000-8000-000000000001';

const throwingStore = (): LedgerStore => ({
  source: async () => {
    throw new Error('database said: host shop.example is bad');
  },
  internal: async () => false,
  record: async () => {},
  dropDraft: async () => {},
  draftedBetween: async () => [CHECK],
});

beforeEach(() => {
  captured.length = 0;
  resetLedgerReportsForTest();
});

describe('ledgerWork', () => {
  it('with no key reads nothing and reports the missing key once per process', async () => {
    const store = throwingStore();
    const source = vi.spyOn(store, 'source');
    const work = ledgerWork(store, undefined);
    expect(await work.write(CHECK)).toBe('no_key');
    expect(await work.write(CHECK)).toBe('no_key');
    expect(await work.backfill(new Date())).toEqual({ outcome: 'no_key' });
    expect(source).not.toHaveBeenCalled();
    expect(captured.map((c) => c.message)).toEqual(['ledger-key-missing']);
  });

  it('a write that throws answers failed and is reported by check_ref, without the error', async () => {
    expect(await ledgerWork(throwingStore(), SECRET).write(CHECK)).toBe('failed');
    expect(captured).toEqual([
      {
        message: 'ledger-write-failed',
        opts: {
          level: 'error',
          tags: { signal: 'ledger-write-failed', stage: 'write' },
          extra: { check_ref: checkRef(CHECK) },
        },
      },
    ]);
    expect(JSON.stringify(captured)).not.toContain(CHECK);
    expect(JSON.stringify(captured)).not.toContain('shop.example');
  });

  it('the backfill reports each failed check and resolves', async () => {
    const r = await ledgerWork(throwingStore(), SECRET).backfill(new Date());
    expect(r).toMatchObject({ failed: 1 });
    expect(captured.map((c) => (c.opts.tags as { stage: string }).stage)).toEqual(['backfill']);
  });
});

describe('storeLedgerDraft', () => {
  const built = {
    check: { crawlers: [], stack: null, signals: [], without_js: null },
  } as unknown as Pick<BuiltCheck, 'check'>;
  const crawl = [] as CrawlBatchResult[];
  const input = { checkId: CHECK, built, crawl, homepage: 'https://site.example/' };

  it('stores the draft when the key is set', async () => {
    const put = vi.fn(async () => {});
    expect(await storeLedgerDraft({ put }, { RESEARCH_SITE_KEY: SECRET }, input)).toBe('stored');
    expect(put).toHaveBeenCalledWith(CHECK, expect.objectContaining({ observations: [] }));
  });

  it('stores nothing with no key, or with no sink', async () => {
    const put = vi.fn(async () => {});
    expect(await storeLedgerDraft({ put }, {}, input)).toBe('no_key');
    expect(await storeLedgerDraft(undefined, { RESEARCH_SITE_KEY: SECRET }, input)).toBe('no_sink');
    expect(put).not.toHaveBeenCalled();
  });

  it('a sink that throws is reported and does not throw into the build step', async () => {
    const put = vi.fn(async () => {
      throw new Error('boom');
    });
    await expect(storeLedgerDraft({ put }, { RESEARCH_SITE_KEY: SECRET }, input)).resolves.toBe(
      'failed',
    );
    expect(captured.map((c) => [c.message, (c.opts.tags as { stage: string }).stage])).toEqual([
      ['ledger-write-failed', 'draft'],
    ]);
  });
});
