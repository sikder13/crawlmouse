import { describe, expect, it, vi } from 'vitest';
import type { CheckRequested } from '../../../../../../inngest/check-events';
import { getJson } from '../evidence';
import { REAP_AFTER_S } from '../limits';
import type { PipelineStore } from '../store';
import { memoryEvidenceStore } from '../test-support/memory-evidence';
import type { StepDeps } from './deps';
import { failCancelled, lifecycleSteps, reapCutoff, reapStalled } from './lifecycle';

const EVENT: CheckRequested = {
  checkId: 'c0000000-0000-4000-8000-000000000001',
  siteId: 's0000000-0000-4000-8000-000000000001',
  accountId: null,
  host: 'example.com',
  homepageUrl: 'https://example.com',
  trigger: 'manual',
  pageCap: 500,
};
const T0 = Date.UTC(2026, 10, 8, 12, 0, 0);

function deps(env: Record<string, string> = {}, now = T0) {
  const store = {
    claim: vi.fn(async () => 'claimed' as const),
    fail: vi.fn(async () => true),
    siteOf: vi.fn(async (): Promise<string | null> => EVENT.siteId),
    progress: vi.fn(async () => {}),
  };
  const evidence = memoryEvidenceStore();
  const d = {
    store: store as unknown as PipelineStore,
    evidence,
    env,
    now: () => now,
    discover: {
      userAgent: 'UA',
      now: () => now,
      fetch: (async (url: string) => ({
        status: url.endsWith('/sitemap.xml') ? 200 : 404,
        body: url.endsWith('/sitemap.xml')
          ? '<urlset><url><loc>https://example.com/a</loc></url></urlset>'
          : '',
        headers: {},
        finalUrl: url,
      })) as unknown as StepDeps['discover']['fetch'],
    },
  } as unknown as StepDeps;
  return { d, store, evidence };
}

describe('claim (findings 9, 10)', () => {
  it('fails nothing and claims nothing when CRAWL_PAUSED is 1', async () => {
    for (const value of ['1', ' 1\n']) {
      const { d, store } = deps({ CRAWL_PAUSED: value });
      expect(await lifecycleSteps(d).claim(EVENT, { runId: 'r', startedAt: null })).toEqual({
        outcome: 'paused',
        at: T0,
      });
      expect(store.claim).not.toHaveBeenCalled();
    }
  });

  it('claims through the store with the first step’s progress, timed from the first attempt', async () => {
    const { d, store } = deps({ CRAWL_PAUSED: '0' });
    store.claim.mockResolvedValueOnce('site_busy' as never);
    const steps = lifecycleSteps(d);
    expect(await steps.claim(EVENT, { runId: 'run-1', startedAt: null })).toEqual({
      outcome: 'site_busy',
      at: T0,
    });
    await steps.claim(EVENT, { runId: 'run-1', startedAt: T0 - 60_000 });
    const [first, second] = store.claim.mock.calls as unknown as [
      string,
      string,
      { steps: unknown[]; elapsed_ms: number },
    ][];
    expect(first![0]).toBe(EVENT.checkId);
    expect(first![1]).toBe('run-1');
    expect(first![2].steps[0]).toEqual({ phase: 'robots_and_sitemap', state: 'now' });
    expect(first![2].elapsed_ms).toBe(0);
    expect(second![2].elapsed_ms).toBe(60_000);
  });
});

describe('discover', () => {
  it('stores the seeds and returns counts and its time', async () => {
    const { d, evidence, store } = deps();
    const out = await lifecycleSteps(d).discover(EVENT, {
      startedAt: T0,
      crawlFrom: null,
      pagesCrawled: 0,
      linksFound: 0,
      release: null,
    });
    expect(out).toEqual({ seeds: 2, sitemap_urls: 1, at: T0 });
    expect(await getJson(evidence, `anon/${EVENT.siteId}/${EVENT.checkId}/seeds.json.gz`)).toEqual([
      { url: 'https://example.com', source: 'homepage', lastmod: null },
      { url: 'https://example.com/a', source: 'sitemap', lastmod: null },
    ]);
    expect(store.progress).toHaveBeenCalledTimes(1);
  });
});

describe('fail', () => {
  it('fails the check by its id and says whether it moved', async () => {
    const { d, store } = deps();
    store.fail.mockResolvedValueOnce(false);
    expect(await lifecycleSteps(d).fail(EVENT, 'paused')).toEqual({ failed: false });
    expect(store.fail).toHaveBeenCalledWith(EVENT.checkId, 'paused', null);
  });

  it('names the site the database holds the failed check under, not the event’s', async () => {
    const { d, store } = deps();
    store.siteOf.mockResolvedValueOnce('s-in-db');
    expect(await lifecycleSteps(d).fail(EVENT, 'paused')).toEqual({
      failed: true,
      siteId: 's-in-db',
    });
    expect(store.siteOf).toHaveBeenCalledWith(EVENT.checkId);
  });
});

describe('failCancelled (finding 4)', () => {
  const store = (claimed: { checkId: string; siteId: string } | null, moved: boolean) => ({
    checkOfRun: vi.fn(async () => claimed),
    fail: vi.fn(async () => moved),
  });

  it('fails the check the run claimed, by run id, with canceled', async () => {
    const s = store({ checkId: 'c', siteId: 's' }, true);
    expect(await failCancelled(s, 'run-9')).toEqual({ checkId: 'c', siteId: 's' });
    expect(s.fail).toHaveBeenCalledWith(null, 'canceled', 'run-9');
  });

  it('gives null when the check had already ended', async () => {
    expect(await failCancelled(store({ checkId: 'c', siteId: 's' }, false), 'run-9')).toBeNull();
  });

  it('gives null, failing nothing, when the run claimed no check', async () => {
    const s = store(null, true);
    expect(await failCancelled(s, 'run-9')).toBeNull();
    expect(s.fail).not.toHaveBeenCalled();
  });
});

describe('the reaper’s cutoff (D13)', () => {
  it('is thirty minutes before now', () => {
    expect(REAP_AFTER_S).toBe(30 * 60);
    expect(reapCutoff(T0)).toBe('2026-11-08T11:30:00.000Z');
  });

  it('is what reapStalled asks the store for', async () => {
    const reap = vi.fn(async () => []);
    await reapStalled({ reap }, () => T0);
    expect(reap).toHaveBeenCalledWith('2026-11-08T11:30:00.000Z');
  });
});
