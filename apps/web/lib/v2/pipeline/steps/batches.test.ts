import { describe, expect, it } from 'vitest';
import { NonRetriableError } from 'inngest';
import { GRADE_VERSION } from '@crawlmouse/engine/v2/pipeline';
import type { BatchResult } from '@crawlmouse/types/v2';
import type { BatchAt, RunSoFar } from '../../../../../../inngest/check';
import type { CheckRequested } from '../../../../../../inngest/check-events';
import {
  CHECK,
  HOST,
  PAGE_CAP,
  SITE_ID,
  readRecorded,
  recordedInput,
  seedsOf,
} from '../../../../../../packages/engine/fixtures/v2/build/recorded';
import { WorkerError } from '../../../worker-client/types';
import { putJson } from '../evidence';
import { CRAWL_CEILING_S } from '../limits';
import { fakeWorker, memoryStore, queuedCheck } from '../test-support/fakes';
import { memoryEvidenceStore } from '../test-support/memory-evidence';
import { batchSteps, stagePages } from './batches';
import type { StepDeps } from './deps';

const T0 = Date.parse('2026-11-05T02:30:00Z');
const EVENT: CheckRequested = {
  checkId: CHECK,
  siteId: SITE_ID,
  accountId: null,
  host: 'built-site.test',
  homepageUrl: HOST,
  trigger: 'first_audit',
  pageCap: PAGE_CAP,
};
const SO: RunSoFar = {
  startedAt: T0,
  crawlFrom: T0,
  pagesCrawled: 0,
  linksFound: 0,
  release: null,
};
const CRAWL_1: BatchAt = { kind: 'crawl', batch: 1, stage: null };

const renumbered = (b: BatchResult, n: number): BatchResult => ({
  ...b,
  batch_id: `${CHECK}:${n}`,
});

async function setup(results = new Map<number, unknown>()) {
  const clock = { now: T0 };
  const iso = () => new Date(clock.now).toISOString();
  const { worker, posted, refuse, lost, held } = fakeWorker(results);
  const { store, batches } = memoryStore(
    recordedInput().site,
    [queuedCheck(CHECK, SITE_ID, '2026-11-05T02:29:58.000Z', GRADE_VERSION)],
    iso,
  );
  await store.claim(CHECK, 'run-1', null);
  const evidence = memoryEvidenceStore();
  await putJson(evidence, `anon/${SITE_ID}/${CHECK}/seeds.json.gz`, seedsOf(HOST));
  let nonces = 0;
  const deps = {
    store,
    evidence,
    worker: () => worker,
    now: () => clock.now,
    nonce: () => `nonce-${String(++nonces).padStart(16, '0')}`,
    env: {},
  } as unknown as StepDeps;
  return {
    steps: batchSteps(deps),
    deps,
    worker,
    clock,
    posted,
    refuse,
    lost,
    held,
    batches,
    evidence,
  };
}

describe('post (finding 2)', () => {
  it('posts the planned URLs with a fresh nonce, after writing its row', async () => {
    const s = await setup();
    const out = await s.steps.post(EVENT, CRAWL_1, SO);
    expect(out).toEqual({ status: 'posted', urls: 50, at: T0, max_seconds: 240 });
    expect(s.posted).toHaveLength(1);
    expect(s.posted[0]).toMatchObject({
      kind: 'crawl',
      check_id: CHECK,
      site_id: SITE_ID,
      site_host: 'built-site.test',
      batch: 1,
      nonce: 'nonce-0000000000000001',
      budget: { max_requests: 400, max_bytes: 128 * 1024 * 1024, max_seconds: 240 },
    });
    expect(s.batches.get(`${CHECK}:1`)).toMatchObject({
      status: 'posted',
      nonce: 'nonce-0000000000000001',
      summary: { urls: 50, max_seconds: 240 },
    });
  });

  it('a retried post finds the batch the worker holds and posts nothing', async () => {
    const s = await setup();
    await s.steps.post(EVENT, CRAWL_1, SO);
    s.clock.now += 30_000;
    const again = await s.steps.post(EVENT, CRAWL_1, SO);
    expect(again).toEqual({ status: 'posted', urls: 50, at: T0, max_seconds: 240 });
    expect(s.posted).toHaveLength(1);
    expect(s.batches.get(`${CHECK}:1`)!.nonce).toBe('nonce-0000000000000001');
  });

  it('a re-post after a loss sends the same URLs with a fresh nonce', async () => {
    const s = await setup();
    await s.steps.post(EVENT, CRAWL_1, SO);
    s.lost.add(1);
    s.held.clear();
    await s.steps.post(EVENT, CRAWL_1, SO);
    expect(s.posted).toHaveLength(2);
    expect(s.posted[1]!.nonce).toBe('nonce-0000000000000002');
    expect(s.posted[1]).toMatchObject({
      urls: (s.posted[0] as unknown as { urls: string[] }).urls,
    });
    expect(s.batches.get(`${CHECK}:1`)!.nonce).toBe('nonce-0000000000000002');
  });

  it('answers busy and paused as outputs, and counts batch_exists as posted', async () => {
    const s = await setup();
    s.refuse.push('busy', 'paused', 'batch_exists');
    expect(await s.steps.post(EVENT, CRAWL_1, SO)).toEqual({ status: 'busy', at: T0 });
    expect(await s.steps.post(EVENT, CRAWL_1, SO)).toEqual({ status: 'paused' });
    expect(await s.steps.post(EVENT, CRAWL_1, SO)).toMatchObject({ status: 'posted' });
  });

  it('after a timeout, asks the worker: posted when it holds the batch, a retry when not', async () => {
    const s = await setup();
    const real = s.worker.postBatch;
    s.worker.postBatch = async (b) => {
      await real(b);
      throw new WorkerError('timeout', null, null);
    };
    expect(await s.steps.post(EVENT, CRAWL_1, SO)).toMatchObject({ status: 'posted' });
    s.refuse.push('network');
    s.worker.postBatch = real;
    await expect(
      s.steps.post(EVENT, { kind: 'crawl', batch: 2, stage: null }, SO),
    ).rejects.toMatchObject({ name: 'WorkerError', kind: 'network' });
  });

  it('fails the check on a refusal that a retry cannot change', async () => {
    const s = await setup();
    s.refuse.push('unauthorized', 'invalid');
    await expect(s.steps.post(EVENT, CRAWL_1, SO)).rejects.toThrow(
      'check failed: worker_unavailable',
    );
    await expect(s.steps.post(EVENT, CRAWL_1, SO)).rejects.toThrow('check failed: internal');
  });

  it('without worker credentials, fails the check worker_unavailable', async () => {
    const s = await setup();
    const steps = batchSteps({ ...s.deps, worker: () => null });
    await expect(steps.post(EVENT, CRAWL_1, SO)).rejects.toThrow(
      'check failed: worker_unavailable',
    );
  });

  it('fails the check worker_unavailable, non-retriably, when the client cannot be built (correctness 1)', async () => {
    const s = await setup();
    const steps = batchSteps({
      ...s.deps,
      worker: () => {
        throw new Error('WORKER_JWT_PRIVATE_KEY_PKCS8_B64 is not a base64 PKCS8 DER private key');
      },
    });
    for (const call of [
      () => steps.post(EVENT, CRAWL_1, SO),
      () => steps.poll(EVENT, CRAWL_1, SO),
      () => steps.read(EVENT, CRAWL_1, SO),
    ]) {
      const failure = await call().then(
        () => null,
        (e: unknown) => e,
      );
      expect(failure).toBeInstanceOf(NonRetriableError);
      expect(failure).toMatchObject({ message: 'check failed: worker_unavailable' });
    }
    // failBatch needs no worker, so it still ends a batch.
    await s.steps.post(EVENT, CRAWL_1, SO);
    await steps.failBatch(EVENT, CRAWL_1);
    expect(s.batches.get(`${CHECK}:1`)!.status).toBe('failed');
  });

  it('cuts max_seconds to what the crawl ceiling leaves, and posts nothing under the minimum', async () => {
    const s = await setup();
    s.clock.now = T0 + (CRAWL_CEILING_S - 200) * 1000;
    expect(await s.steps.post(EVENT, CRAWL_1, SO)).toMatchObject({ max_seconds: 200 - 90 });
    s.clock.now = T0 + (CRAWL_CEILING_S - 149) * 1000;
    expect(await s.steps.post(EVENT, { kind: 'crawl', batch: 2, stage: null }, SO)).toEqual({
      status: 'none',
      why: 'no_time',
    });
  });

  it('plans nothing more once the crawl has asked for every URL', async () => {
    const recorded = readRecorded('batches');
    const s = await setup(
      new Map([
        [1, renumbered(recorded[0]!, 1)],
        [2, renumbered(recorded[1]!, 2)],
      ]),
    );
    for (const n of [1, 2]) {
      const at: BatchAt = { kind: 'crawl', batch: n, stage: null };
      await s.steps.post(EVENT, at, SO);
      expect(await s.steps.read(EVENT, at, SO)).toMatchObject({ status: 'read' });
    }
    expect(await s.steps.post(EVENT, { kind: 'crawl', batch: 3, stage: null }, SO)).toEqual({
      status: 'none',
      why: 'done',
    });
  });
});

describe('stagePages', () => {
  const page = {
    url: 'https://x.test/a',
    template_key: '/',
    stage: 1 as const,
    picked_for: 'homepage' as const,
  };
  it('plans stage 2 only when stage 1 found it needed', () => {
    expect(stagePages({ stage1: [page], stage2_needed: false, stage2: [] }, 2)).toEqual({
      none: 'not_needed',
    });
    expect(stagePages({ stage1: [page], stage2_needed: null, stage2: [] }, 2)).toEqual({
      none: 'not_needed',
    });
    expect(stagePages({ stage1: [page], stage2_needed: true, stage2: [] }, 2)).toEqual({
      none: 'done',
    });
    expect(
      stagePages({ stage1: [page], stage2_needed: true, stage2: [{ ...page, stage: 2 }] }, 2),
    ).toEqual({ kind: 'access', pages: [{ url: page.url, template_key: '/' }] });
    expect(stagePages({ stage1: [], stage2_needed: null, stage2: [] }, 1)).toEqual({
      none: 'done',
    });
  });
});

describe('poll (finding 13)', () => {
  it('returns the status and its time only, and writes the heartbeat', async () => {
    const s = await setup();
    await s.steps.post(EVENT, CRAWL_1, SO);
    s.clock.now += 5_000;
    expect(await s.steps.poll(EVENT, CRAWL_1, SO)).toEqual({ status: 'running', at: T0 + 5_000 });
  });

  it('reads a worker that did not answer as unreachable, not as a failure', async () => {
    const s = await setup();
    s.worker.pollBatch = async () => {
      throw new WorkerError('timeout', null, null);
    };
    expect(await s.steps.poll(EVENT, CRAWL_1, SO)).toEqual({ status: 'unreachable', at: T0 });
  });
});

describe('read (finding 3)', () => {
  it('stores the result, marks the row done with its counts and release', async () => {
    const recorded = readRecorded('batches');
    const s = await setup(new Map([[1, renumbered(recorded[0]!, 1)]]));
    await s.steps.post(EVENT, CRAWL_1, SO);
    expect(await s.steps.read(EVENT, CRAWL_1, SO)).toEqual({
      status: 'read',
      pages: 50,
      links: (recorded[0] as { link_edges: unknown[] }).link_edges.length,
      access_tests: 0,
      partial: recorded[0]!.partial !== null,
      release: 'unreleased',
    });
    expect(s.batches.get(`${CHECK}:1`)).toMatchObject({
      status: 'done',
      result_path: `anon/${SITE_ID}/${CHECK}/batch-1.json.gz`,
      summary: { release: 'unreleased', pages: 50 },
    });
    expect(s.evidence.objects.has(`anon/${SITE_ID}/${CHECK}/batch-1.json.gz`)).toBe(true);
  });

  it('gives not_found when the worker no longer holds the batch', async () => {
    const s = await setup();
    expect(await s.steps.read(EVENT, CRAWL_1, SO)).toEqual({ status: 'not_found' });
  });

  it('refuses a result of another batch, or one the contract refuses', async () => {
    const recorded = readRecorded('batches');
    const s = await setup(
      new Map<number, unknown>([
        [1, renumbered(recorded[0]!, 2)],
        [2, { ...renumbered(recorded[0]!, 2), requests: -1 }],
      ]),
    );
    await s.steps.post(EVENT, CRAWL_1, SO);
    await expect(s.steps.read(EVENT, CRAWL_1, SO)).rejects.toThrow('check failed: internal');
    const second: BatchAt = { kind: 'crawl', batch: 2, stage: null };
    await s.steps.post(EVENT, second, SO);
    await expect(s.steps.read(EVENT, second, SO)).rejects.toThrow('check failed: internal');
  });
});

describe('failBatch', () => {
  it('marks a posted batch failed', async () => {
    const s = await setup();
    await s.steps.post(EVENT, CRAWL_1, SO);
    await s.steps.failBatch(EVENT, CRAWL_1);
    expect(s.batches.get(`${CHECK}:1`)).toMatchObject({
      status: 'failed',
      finished_at: '2026-11-05T02:30:00.000Z',
    });
  });
});
