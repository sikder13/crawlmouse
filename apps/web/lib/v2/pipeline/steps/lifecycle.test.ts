import { describe, expect, it, vi } from 'vitest';
import type { CheckRequested } from '../../../../../../inngest/check-events';
import { getJson } from '../evidence';
import { DISCOVER_S, PACE, REAP_AFTER_S, RESERVE_S } from '../limits';
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
    claim: vi.fn(async (): Promise<'claimed' | 'site_busy' | 'gone'> => 'claimed'),
    requestSite: vi.fn(async (id: string) => ({
      id,
      account_id: 'a0000000-0000-4000-8000-000000000001',
      host: 'kept.example',
      next_check_at: null,
    })),
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
    store.claim.mockResolvedValueOnce('site_busy');
    const steps = lifecycleSteps(d);
    expect(await steps.claim(EVENT, { runId: 'run-1', startedAt: null })).toEqual({
      outcome: 'site_busy',
      at: T0,
    });
    expect(store.siteOf).not.toHaveBeenCalled();
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

describe('claim reads the claimed check’s site from the database (security 6)', () => {
  it('names the row’s site, and that site’s account, host and homepage', async () => {
    const { d, store } = deps();
    store.siteOf.mockResolvedValueOnce('s-in-db');
    expect(await lifecycleSteps(d).claim(EVENT, { runId: 'run-1', startedAt: null })).toEqual({
      outcome: 'claimed',
      at: T0,
      site: {
        siteId: 's-in-db',
        accountId: 'a0000000-0000-4000-8000-000000000001',
        host: 'kept.example',
        homepageUrl: 'https://kept.example',
      },
    });
    expect(store.siteOf).toHaveBeenCalledWith(EVENT.checkId);
    expect(store.requestSite).toHaveBeenCalledWith('s-in-db');
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

describe('failCancelled (finding 4, correctness 2)', () => {
  const store = (claimed: { checkId: string; siteId: string } | null, moved: boolean) => ({
    checkOfRun: vi.fn(async () => claimed),
    fail: vi.fn(async () => moved),
    siteOf: vi.fn(async (): Promise<string | null> => 's-in-db'),
  });

  it('fails the triggering event’s check by its id, claimed or not, with canceled', async () => {
    const s = store(null, true);
    expect(await failCancelled(s, { checkId: 'c', runId: 'run-9' })).toEqual({
      checkId: 'c',
      siteId: 's-in-db',
    });
    expect(s.fail).toHaveBeenCalledWith('c', 'canceled', null);
    expect(s.checkOfRun).not.toHaveBeenCalled();
  });

  it('gives null when the check had already ended', async () => {
    expect(await failCancelled(store(null, false), { checkId: 'c', runId: 'run-9' })).toBeNull();
  });

  it('without the event’s check id, fails the check the run claimed, by run id', async () => {
    const s = store({ checkId: 'c', siteId: 's' }, true);
    expect(await failCancelled(s, { checkId: null, runId: 'run-9' })).toEqual({
      checkId: 'c',
      siteId: 's',
    });
    expect(s.fail).toHaveBeenCalledWith(null, 'canceled', 'run-9');
  });

  it('gives null, failing nothing, when it has no check id and the run claimed no check', async () => {
    const s = store(null, true);
    expect(await failCancelled(s, { checkId: null, runId: 'run-9' })).toBeNull();
    expect(s.fail).not.toHaveBeenCalled();
  });
});

describe('the reaper’s cutoff (D13)', () => {
  it('is thirty minutes before now', () => {
    expect(REAP_AFTER_S).toBe(30 * 60);
    expect(reapCutoff(T0)).toBe('2026-11-08T11:30:00.000Z');
  });

  it('fails no check whose run may still be alive: REAP_AFTER_S is above the finish timeout plus the longest wait between heartbeats (correctness 10)', () => {
    // The waits the orchestration makes between two heartbeat writes (claim, discover, post, poll and
    // read write one), each from its bound; step latency comes on top. RESERVE_S is the time plan's
    // allowance for render, build, persist and finalize, which write none; nothing inside those
    // steps enforces it, the finish timeout does.
    const waits = {
      'a queued check’s claim waits while the site is busy': PACE.claimWaits * PACE.claimWaitS,
      'discovery, claim to its end': DISCOVER_S,
      'a post answered busy, to the next post': PACE.busyWaitS,
      'a post, or a poll, to the next poll': PACE.pollMaxS,
      'the last batch to the end of the run': RESERVE_S,
    };
    const longest = Math.max(...Object.values(waits));
    expect(longest).toBe(waits['a queued check’s claim waits while the site is busy']);
    // A run lives at most PACE.finishS (Inngest cancels it then, and the cancel handler fails its
    // check), so the reaper's bound is above that plus the longest wait.
    expect(REAP_AFTER_S).toBeGreaterThan(PACE.finishS + longest);
  });

  it('is what reapStalled asks the store for', async () => {
    const reap = vi.fn(async () => []);
    await reapStalled({ reap }, () => T0);
    expect(reap).toHaveBeenCalledWith('2026-11-08T11:30:00.000Z');
  });
});
