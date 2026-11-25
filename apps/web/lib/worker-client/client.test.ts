import { createHash, createHmac, generateKeyPairSync, type KeyObject } from 'node:crypto';
import { readFileSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { REFUSALS } from '../../../../packages/worker/src/routes';
import type { Fetcher } from '../../../../packages/worker/src/fetch/fetcher';
import { CRAWL } from '../../../../packages/worker/src/identities';
import { InstantClock } from '../../../../packages/worker/src/test-support/clock';
import { fakeFetcher } from '../../../../packages/worker/src/test-support/fake-fetcher';
import { pageFetcher, startWorker, type InProcessWorker } from './__tests__/in-process-worker';
import { readRendered } from '@crawlmouse/engine/worker';
import { readMeasure } from '../../../../packages/worker/src/reader/measure';
import { READ_DEADLINE_MS } from '../../../../packages/worker/src/reader/thread-reader';
import { MEASURE_CONCURRENCY } from '../../../../packages/worker/src/server';
import {
  createWorkerClient,
  MEASURE_BUSY_WAITS_MS,
  MEASURE_TIMEOUT_MS,
  PROGRESS_TIMEOUT_MS,
  WORKER_REFUSALS,
  workerClientFromEnv,
} from './client';
import { batchIdOf, WorkerError, type BatchPost, type WorkerErrorKind } from './types';

const CHECK = '00000000-0000-4000-8000-0000000000c9';
const SITE = '00000000-0000-4000-8000-0000000000a9';
const BUDGET = { max_requests: 50, max_bytes: 1_000_000, max_seconds: 300 };
let seq = 0;

type CrawlPost = Extract<BatchPost, { kind: 'crawl' }>;

/** A crawl batch with a fresh batch number and nonce. */
function crawl(over: Partial<CrawlPost> = {}): CrawlPost {
  seq += 1;
  return {
    kind: 'crawl',
    check_id: CHECK,
    site_id: SITE,
    site_host: 'example.com',
    batch: seq,
    nonce: `nonce-${String(seq).padStart(16, '0')}`,
    budget: BUDGET,
    urls: ['https://example.com/', 'https://www.example.com/a'],
    ...over,
  };
}

let running: InProcessWorker[] = [];
const servers: http.Server[] = [];
afterEach(async () => {
  await Promise.all(running.map((w) => w.stop()));
  running = [];
  for (const s of servers.splice(0)) {
    s.closeAllConnections();
    await new Promise<void>((r) => s.close(() => r()));
  }
});

async function worker(...args: Parameters<typeof startWorker>): Promise<InProcessWorker> {
  const w = await startWorker(...args);
  running.push(w);
  return w;
}

const clientOf = (
  w: InProcessWorker,
  over: Partial<Parameters<typeof createWorkerClient>[0]> = {},
) =>
  createWorkerClient({
    url: w.base,
    signingSecret: w.signingSecret,
    privateKey: w.privateKey,
    now: () => w.clock.now(),
    ...over,
  });

async function refusal(p: Promise<unknown>): Promise<WorkerError> {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(WorkerError);
    return e as WorkerError;
  }
  throw new Error('expected a WorkerError');
}

const shape = (e: WorkerError) => ({ kind: e.kind, status: e.status, code: e.code });

/** A fetcher whose page requests wait until `release` is called. */
function gated(): { fetcher: (c: InstantClock) => Fetcher; release: () => void } {
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  return {
    release,
    fetcher: (clock) => {
      const inner = pageFetcher(clock);
      return async (url, identity, limits) => {
        await gate;
        return inner(url, identity, limits);
      };
    },
  };
}

describe('against the worker, in process', () => {
  it('reports that a worker with a signal address will signal the batch', async () => {
    // A closed local port: the signal fails at once, and nothing leaves the machine.
    const w = await worker({ appSignalUrl: 'https://127.0.0.1:1/api/webhooks/worker' });
    const batch = crawl();
    expect(await clientOf(w).postBatch(batch)).toEqual({
      batch_id: `${CHECK}:${batch.batch}`,
      signals: true,
    });
    await w.worker.idle();
  });

  it('reads a running batch from the real worker as live counts, and nothing once it is done', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const w = await worker({}, (clock) => {
      const page = pageFetcher(clock);
      return async (url, identity, limits) => {
        await gate;
        return page(url, identity, limits);
      };
    });
    const client = clientOf(w);
    const batch = crawl();
    await client.postBatch(batch);
    const id = batchIdOf(CHECK, batch.batch);
    const whileRunning = await client.readProgress(id);
    release();
    await w.worker.idle();
    expect(whileRunning).toEqual({
      pages: 0,
      links: 0,
      homepageRead: false,
      total: 0,
      fresh: [],
    });
    expect(await client.readProgress(id)).toBeNull();
    expect(await client.readProgress(`${CHECK}:424242`)).toBeNull();
  });

  it.each([
    ['a negative count', { pages: -1, links: 0 }],
    ['a fraction', { pages: 1.5, links: 0 }],
    ['a string', { pages: '3', links: 0 }],
    ['a missing field, as an older worker sends', { urls_done: 1 }],
  ])('takes no live counts from a progress with %s', async (_name, progress) => {
    const id = `${CHECK}:1`;
    const client = createWorkerClient({
      url: 'http://127.0.0.1:1',
      signingSecret: 's'.repeat(48),
      privateKey: generateKeyPairSync('ed25519').privateKey,
      fetch: async () =>
        new Response(
          JSON.stringify({
            batch_id: id,
            status: 'running',
            progress,
            pages_total: 0,
            live_pages: [],
          }),
        ),
    });
    expect(await client.readProgress(id)).toBeNull();
  });

  it('carries a real finished page from the worker, with its bounds', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const long = `/${'l'.repeat(600)}`;
    const links = [long, ...Array.from({ length: 30 }, (_, i) => `/p${i}`)]
      .map((href) => `<a href="${href}">x</a>`)
      .join('');
    const w = await worker({}, (clock) => {
      const page = fakeFetcher(clock, (url) =>
        url.endsWith('/robots.txt')
          ? { status: 404, body: '' }
          : { status: 200, body: `<html><body>${links}</body></html>` },
      );
      return async (url, identity, limits) => {
        if (url.endsWith('/a')) await gate;
        return page(url, identity, limits);
      };
    });
    const client = clientOf(w);
    const batch = crawl();
    await client.postBatch(batch);
    const id = batchIdOf(CHECK, batch.batch);
    let live: Awaited<ReturnType<typeof client.readProgress>> = null;
    for (let i = 0; i < 400 && !live?.total; i++) {
      live = await client.readProgress(id);
      await new Promise((r) => setTimeout(r, 5));
    }
    release();
    await w.worker.idle();
    expect(live).toMatchObject({ pages: 1, total: 1 });
    const [page] = live!.fresh;
    // The real crawl identity is the user agent, longer than a short token.
    expect(page!.identity).toBe(CRAWL.userAgent);
    expect(page!.identity.length).toBeGreaterThan(64);
    expect(page!.edges).toHaveLength(20);
    for (const e of page!.edges) expect(e.to.length).toBeLessThanOrEqual(512);
  });

  it('asks from the offset it is given, and hands back the pages finished since', async () => {
    const id = `${CHECK}:1`;
    const page = {
      url: 'https://site.test/a',
      status: 200,
      ms: 12,
      links: 1,
      identity: 'browser',
      edges: [{ from: 'https://site.test/a', to: 'https://site.test/b', js_only: false }],
    };
    const asked: string[] = [];
    const client = createWorkerClient({
      url: 'http://127.0.0.1:1',
      signingSecret: 's'.repeat(48),
      privateKey: generateKeyPairSync('ed25519').privateKey,
      fetch: async (url) => {
        asked.push(String(url));
        return new Response(
          JSON.stringify({
            batch_id: id,
            status: 'running',
            progress: { pages: 4, links: 9, homepage_read: true },
            pages_total: 4,
            live_pages: [page],
          }),
        );
      },
    });
    expect(await client.readProgress(id, 3)).toEqual({
      pages: 4,
      links: 9,
      homepageRead: true,
      total: 4,
      fresh: [page],
    });
    expect(asked).toEqual([`http://127.0.0.1:1/batch/${id}/progress?after=3`]);
  });

  it.each([
    ['a URL that is not one', { url: 'javascript:alert(1)' }],
    ['a status that is no status', { status: 9999 }],
    [
      'an edge to something that is no URL',
      { edges: [{ from: 'https://s.test/', to: 'x', js_only: false }] },
    ],
  ])('takes nothing from a live page with %s', async (_name, over) => {
    const id = `${CHECK}:1`;
    const page = {
      url: 'https://site.test/a',
      status: 200,
      ms: 1,
      links: 0,
      identity: 'browser',
      edges: [],
      ...over,
    };
    const client = createWorkerClient({
      url: 'http://127.0.0.1:1',
      signingSecret: 's'.repeat(48),
      privateKey: generateKeyPairSync('ed25519').privateKey,
      fetch: async () =>
        new Response(
          JSON.stringify({
            batch_id: id,
            status: 'running',
            progress: { pages: 1, links: 0 },
            pages_total: 1,
            live_pages: [page],
          }),
        ),
    });
    expect(await client.readProgress(id)).toBeNull();
  });

  it('reads a worker that does not say whether the homepage was read as not read', async () => {
    const id = `${CHECK}:1`;
    const client = createWorkerClient({
      url: 'http://127.0.0.1:1',
      signingSecret: 's'.repeat(48),
      privateKey: generateKeyPairSync('ed25519').privateKey,
      fetch: async () =>
        new Response(
          JSON.stringify({
            batch_id: id,
            status: 'running',
            progress: { pages: 1, links: 0 },
            pages_total: 0,
            live_pages: [],
          }),
        ),
    });
    expect(await client.readProgress(id)).toMatchObject({ homepageRead: false });
  });

  it('takes no live counts from an answer about another batch', async () => {
    const client = createWorkerClient({
      url: 'http://127.0.0.1:1',
      signingSecret: 's'.repeat(48),
      privateKey: generateKeyPairSync('ed25519').privateKey,
      fetch: async () =>
        new Response(
          JSON.stringify({
            batch_id: `${CHECK}:2`,
            status: 'running',
            progress: { pages: 1, links: 1 },
            pages_total: 0,
            live_pages: [],
          }),
        ),
    });
    expect(await client.readProgress(`${CHECK}:1`)).toBeNull();
  });

  it('answers null, never throwing, when the progress read fails or stalls', async () => {
    const down = createWorkerClient({
      url: 'http://127.0.0.1:1',
      signingSecret: 's'.repeat(48),
      privateKey: generateKeyPairSync('ed25519').privateKey,
      fetch: async () => {
        throw new Error('unreachable');
      },
    });
    expect(await down.readProgress(`${CHECK}:1`)).toBeNull();
    const asked: (AbortSignal | null | undefined)[] = [];
    const stalled = createWorkerClient({
      url: 'http://127.0.0.1:1',
      signingSecret: 's'.repeat(48),
      privateKey: generateKeyPairSync('ed25519').privateKey,
      timeoutMs: 60_000,
      fetch: (_url, init) => {
        asked.push(init?.signal);
        return new Promise((_resolve, reject) =>
          init!.signal!.addEventListener('abort', () => reject(init!.signal!.reason)),
        );
      },
    });
    const before = Date.now();
    expect(await stalled.readProgress(`${CHECK}:1`)).toBeNull();
    expect(asked).toHaveLength(1);
    expect(Date.now() - before).toBeLessThan(PROGRESS_TIMEOUT_MS + 1000);
  });

  it('posts a crawl batch it accepts, polls it to done, and reads metrics', async () => {
    const w = await worker();
    const client = clientOf(w);
    const batch = crawl();
    expect(await client.postBatch(batch)).toEqual({
      batch_id: `${CHECK}:${batch.batch}`,
      signals: false,
    });
    await w.worker.idle();
    const polled = await client.pollBatch(batchIdOf(CHECK, batch.batch));
    expect(polled).toMatchObject({
      status: 'done',
      result: {
        kind: 'crawl',
        check_id: CHECK,
        site_id: SITE,
        batch_id: `${CHECK}:${batch.batch}`,
      },
    });
    expect(await client.readMetrics()).toMatchObject({ batches_running: 0, batches_stored: 1 });
  });

  it('posts an access batch it accepts and polls it to done', async () => {
    const w = await worker();
    const client = clientOf(w);
    seq += 1;
    const batch: BatchPost = {
      kind: 'access',
      check_id: CHECK,
      site_id: SITE,
      site_host: 'example.com',
      batch: seq,
      nonce: `nonce-access-${String(seq).padStart(10, '0')}`,
      budget: BUDGET,
      pages: [{ url: 'https://example.com/products/a', template_key: '/products/*' }],
    };
    await client.postBatch(batch);
    await w.worker.idle();
    expect(await client.pollBatch(batchIdOf(CHECK, seq))).toMatchObject({
      status: 'done',
      result: { kind: 'access' },
    });
  });

  it('polls a running batch with its progress, a failed one as failed, an unknown one as not_found', async () => {
    const slow = gated();
    const w = await worker({}, slow.fetcher);
    const client = clientOf(w);
    const batch = crawl();
    await client.postBatch(batch);
    expect(await client.pollBatch(batchIdOf(CHECK, batch.batch))).toEqual({
      status: 'running',
      progress: {
        urls_done: 0,
        urls_total: 2,
        requests: 0,
        pages: 0,
        links: 0,
        homepage_read: false,
      },
    });
    slow.release();
    expect(await client.pollBatch(`${CHECK}:424242`)).toEqual({ status: 'not_found' });

    const broken = await worker({}, () => async () => {
      throw new Error('boom');
    });
    const other = clientOf(broken);
    const b = crawl();
    await other.postBatch(b);
    await broken.worker.idle();
    expect(await other.pollBatch(batchIdOf(CHECK, b.batch))).toEqual({ status: 'failed' });
  });

  it('maps each refusal the worker answers to its kind, status and code', async () => {
    const w = await worker();
    const client = clientOf(w);
    const other = generateKeyPairSync('ed25519').privateKey;
    const cases: Array<[string, () => Promise<unknown>, ReturnType<typeof shape>]> = [
      [
        'another signing secret',
        () => clientOf(w, { signingSecret: `${w.signingSecret}x` }).postBatch(crawl()),
        { kind: 'unauthorized', status: 401, code: 'bad_signature' },
      ],
      [
        'a clock six minutes slow',
        () => clientOf(w, { now: () => w.clock.now() - 6 * 60_000 }).postBatch(crawl()),
        { kind: 'unauthorized', status: 401, code: 'stale_ts' },
      ],
      [
        'another JWT key',
        () => clientOf(w, { privateKey: other }).postBatch(crawl()),
        { kind: 'unauthorized', status: 401, code: 'jwt_invalid' },
      ],
      [
        'a URL on another host',
        () => client.postBatch(crawl({ urls: ['https://example.org/'] })),
        { kind: 'forbidden', status: 403, code: 'jwt_scope' },
      ],
      [
        'a budget over the ceiling',
        () => client.postBatch(crawl({ budget: { ...BUDGET, max_seconds: 1801 } })),
        { kind: 'invalid', status: 400, code: 'invalid_body' },
      ],
      [
        'a body over a mebibyte',
        () =>
          client.postBatch(
            crawl({
              urls: Array.from(
                { length: 600 },
                (_, i) => `https://example.com/${i}/${'a'.repeat(2000)}`,
              ),
            }),
          ),
        { kind: 'too_large', status: 413, code: 'too_large' },
      ],
      [
        'a signed read of an unknown route',
        () => clientOf({ ...w, base: `${w.base}/nowhere` }).readMetrics(),
        { kind: 'server', status: 404, code: 'not_found' },
      ],
    ];
    for (const [name, call, expected] of cases) {
      expect({ name, ...shape(await refusal(call())) }).toEqual({ name, ...expected });
    }
  });

  it('maps a repeated batch, a replayed nonce and a full worker', async () => {
    const slow = gated();
    const w = await worker({ batchConcurrency: 1 }, slow.fetcher);
    const client = clientOf(w);
    const first = crawl();
    await client.postBatch(first);
    expect(shape(await refusal(client.postBatch(crawl())))).toEqual({
      kind: 'busy',
      status: 429,
      code: 'busy',
    });
    slow.release();
    await w.worker.idle();
    expect(shape(await refusal(client.postBatch({ ...crawl(), batch: first.batch })))).toEqual({
      kind: 'batch_exists',
      status: 409,
      code: 'batch_exists',
    });
    expect(shape(await refusal(client.postBatch({ ...crawl(), nonce: first.nonce })))).toEqual({
      kind: 'nonce_replayed',
      status: 409,
      code: 'nonce_replayed',
    });
  });

  it('maps a paused worker', async () => {
    const w = await worker({ paused: true });
    expect(shape(await refusal(clientOf(w).postBatch(crawl())))).toEqual({
      kind: 'paused',
      status: 503,
      code: 'paused',
    });
  });

  it('sends the worker strict body, with no site_host and no field the caller added', async () => {
    const w = await worker();
    const sent: Array<Record<string, unknown>> = [];
    const client = clientOf(w, {
      fetch: async (input, init) => {
        sent.push(JSON.parse(new TextDecoder().decode(init!.body as Uint8Array)));
        return fetch(input, init);
      },
    });
    // Fields a caller's object can carry that the worker's strict body does not take.
    const crawlBatch = {
      ...crawl(),
      stray: true,
      budget: { ...BUDGET, stray: 1 },
    } as unknown as BatchPost;
    await client.postBatch(crawlBatch);
    await client.postBatch({
      ...crawl(),
      kind: 'access',
      pages: [{ url: 'https://example.com/a', template_key: '/', stray: 1 }],
    } as unknown as BatchPost);
    expect(Object.keys(sent[0]!)).toEqual([
      'kind',
      'check_id',
      'site_id',
      'batch',
      'nonce',
      'jwt',
      'budget',
      'urls',
    ]);
    expect(sent[0]!.budget).toEqual(BUDGET);
    expect(Object.keys(sent[1]!)).toEqual([
      'kind',
      'check_id',
      'site_id',
      'batch',
      'nonce',
      'jwt',
      'budget',
      'pages',
    ]);
    expect(sent[1]!.pages).toEqual([{ url: 'https://example.com/a', template_key: '/' }]);
  });
});

describe('ids the worker cannot route', () => {
  it('refuses them before sending anything', async () => {
    const calls: string[] = [];
    const client = createWorkerClient({
      url: 'http://127.0.0.1:9',
      signingSecret: 's'.repeat(32),
      privateKey: generateKeyPairSync('ed25519').privateKey,
      fetch: async (input) => {
        calls.push(String(input));
        return new Response('{}');
      },
    });
    for (const id of [
      '../metrics',
      `${CHECK}:1?x=1`,
      `${CHECK.toUpperCase()}:1`,
      `${CHECK}:12345678`,
      '',
    ]) {
      expect(shape(await refusal(client.pollBatch(id)))).toEqual({
        kind: 'invalid',
        status: null,
        code: null,
      });
    }
    expect(
      shape(await refusal(client.postBatch(crawl({ check_id: CHECK.toUpperCase() })))),
    ).toEqual({ kind: 'invalid', status: null, code: null });
    expect(
      shape(await refusal(client.postBatch(crawl({ site_host: 'example.com:8443' })))),
    ).toEqual({ kind: 'invalid', status: null, code: null });
    expect(calls).toEqual([]);
  });
});

describe('the refusal table', () => {
  it("names every refusal the worker can answer, with the worker's status", () => {
    const worker = Object.fromEntries(
      Object.entries(REFUSALS).map(([code, r]) => [code, r.status]),
    );
    const ours = Object.fromEntries([...WORKER_REFUSALS].map(([code, r]) => [code, r.status]));
    // The worker's server.ts answers 500 `internal` outside REFUSALS.
    expect(ours).toEqual({ ...worker, internal: 500 });
  });
});

/** A client over a scripted fetch, for answers the worker in process does not give. */
function scripted(answer: () => Response) {
  return createWorkerClient({
    url: 'https://worker.test',
    signingSecret: 's'.repeat(32),
    privateKey: generateKeyPairSync('ed25519').privateKey,
    timeoutMs: 200,
    fetch: async () => answer(),
  });
}

const jsonResponse = (status: number, body: unknown) =>
  new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });

describe('answers the worker in process does not give', () => {
  const cases: Array<[number, unknown, WorkerErrorKind, string | null]> = [
    [429, 'Too Many Requests', 'busy', null],
    [409, {}, 'server', null],
    [503, '<html>unavailable</html>', 'server', null],
    [503, { error: 'busy' }, 'server', null],
    [401, { error: 'constructor' }, 'unauthorized', null],
    [403, { error: '__proto__' }, 'forbidden', null],
    [400, { error: 'toString' }, 'invalid', null],
    [408, { error: 'body_timeout' }, 'timeout', 'body_timeout'],
    [408, 'Request Timeout', 'timeout', null],
    [413, 'too big', 'too_large', null],
    [500, { error: 'internal' }, 'server', 'internal'],
    [502, '<html>bad gateway</html>', 'server', null],
    [418, {}, 'server', null],
    [200, {}, 'server', null],
    [202, { batch_id: `${CHECK}:999` }, 'server', null],
    [202, 'not json', 'server', null],
  ];
  it.each(cases)('%i %j → %s', async (status, body, kind, code) => {
    const client = scripted(() => jsonResponse(status, body));
    expect(shape(await refusal(client.postBatch(crawl())))).toEqual({ kind, status, code });
  });

  it('a poll answer that is not one of the worker’s is a server error', async () => {
    const id = `${CHECK}:1`;
    for (const body of [
      { batch_id: id, status: 'queued' },
      { batch_id: `${CHECK}:2`, status: 'failed' },
      { batch_id: id, status: 'done' },
      'not json',
    ]) {
      const client = scripted(() => jsonResponse(200, body));
      expect(shape(await refusal(client.pollBatch(id)))).toEqual({
        kind: 'server',
        status: 200,
        code: null,
      });
    }
    const unknown404 = scripted(() => jsonResponse(404, '<html>404</html>'));
    expect(shape(await refusal(unknown404.pollBatch(id)))).toEqual({
      kind: 'server',
      status: 404,
      code: null,
    });
  });

  it('metrics that are not JSON are a server error', async () => {
    const client = scripted(() => jsonResponse(200, 'not json'));
    expect(shape(await refusal(client.readMetrics()))).toEqual({
      kind: 'server',
      status: 200,
      code: null,
    });
  });
});

async function listen(handler: http.RequestListener): Promise<string> {
  const server = http.createServer(handler);
  servers.push(server);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

describe('transport failures', () => {
  const key = generateKeyPairSync('ed25519').privateKey;
  const over = (url: string, timeoutMs = 200) =>
    createWorkerClient({ url, signingSecret: 's'.repeat(32), privateKey: key, timeoutMs });

  it('a worker that does not answer in time is a timeout', async () => {
    const url = await listen(() => undefined);
    const started = Date.now();
    expect(shape(await refusal(over(url).postBatch(crawl())))).toEqual({
      kind: 'timeout',
      status: null,
      code: null,
    });
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  it('a body that stops arriving is a timeout too', async () => {
    const url = await listen((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.write('{"batch_id":');
    });
    expect(shape(await refusal(over(url).pollBatch(`${CHECK}:1`)))).toEqual({
      kind: 'timeout',
      status: 200,
      code: null,
    });
  });

  it('a refused connection is a network error', async () => {
    const url = await listen(() => undefined);
    const closed = servers.pop()!;
    await new Promise<void>((r) => closed.close(() => r()));
    expect(shape(await refusal(over(url).readMetrics()))).toEqual({
      kind: 'network',
      status: null,
      code: null,
    });
  });

  it('a redirect is not followed: no signed request goes anywhere else', async () => {
    const hits: string[] = [];
    const elsewhere = await listen((req, res) => {
      hits.push(req.url ?? '');
      res.end('{}');
    });
    const url = await listen((req, res) => {
      res.writeHead(307, { location: `${elsewhere}${req.url}` });
      res.end();
    });
    const client = over(url);
    // Node's fetch fails a POST's redirect by itself (the sent bytes are detached), so the signed GETs
    // are the requests that show whether a redirect is followed.
    for (const call of [
      () => client.postBatch(crawl()),
      () => client.pollBatch(`${CHECK}:1`),
      () => client.readMetrics(),
    ]) {
      expect(shape(await refusal(call()))).toEqual({ kind: 'network', status: null, code: null });
    }
    expect(hits).toEqual([]);
  });
});

describe('no secret leaves in an error', () => {
  const key = generateKeyPairSync('ed25519').privateKey;
  const keyB64 = key.export({ format: 'der', type: 'pkcs8' }).toString('base64');
  const secret = `planted-signing-secret-${'9f'.repeat(16)}`;

  /** A worker that answers each request with everything it was sent, and the planted values. */
  function echoing(
    status: number,
    error: (planted: string) => unknown,
    mode: 'answer' | 'throw' | 'abort',
  ) {
    const seen: string[] = [];
    const client = createWorkerClient({
      url: 'https://worker.test',
      signingSecret: secret,
      privateKey: key,
      timeoutMs: 100,
      now: () => 1_800_000_000_000,
      fetch: async (_input, init) => {
        const headers = new Headers(init?.headers);
        const body = init?.body ? new TextDecoder().decode(init.body as Uint8Array) : '';
        const jwt = body ? (JSON.parse(body) as { jwt: string }).jwt : '';
        const planted = [
          secret,
          keyB64,
          jwt,
          headers.get('x-crawlmouse-signature') ?? '',
          body,
        ].join(' ');
        seen.push(jwt, headers.get('x-crawlmouse-signature') ?? '');
        if (mode === 'throw') throw new TypeError(`fetch failed: ${planted}`, { cause: planted });
        if (mode === 'abort') throw new DOMException(`timed out: ${planted}`, 'TimeoutError');
        return new Response(JSON.stringify({ error: error(planted), detail: planted }), { status });
      },
    });
    return { client, seen };
  }

  const forms = (v: string): string[] => [
    v,
    Buffer.from(v).toString('base64'),
    Buffer.from(v).toString('base64url'),
  ];

  it('in any message, string, stack or JSON form, on every path', async () => {
    const codes = [...WORKER_REFUSALS.keys()];
    const errors: WorkerError[] = [];
    const seen: string[] = [];
    const paths: Array<[number, (p: string) => unknown, 'answer' | 'throw' | 'abort']> = [
      ...codes.map(
        (c) =>
          [WORKER_REFUSALS.get(c)!.status, () => c, 'answer'] as [
            number,
            (p: string) => unknown,
            'answer',
          ],
      ),
      [401, (p) => p, 'answer'],
      [500, (p) => p, 'answer'],
      [200, (p) => p, 'answer'],
      [0, () => null, 'throw'],
      [0, () => null, 'abort'],
    ];
    for (const [status, error, mode] of paths) {
      const { client, seen: s } = echoing(status, error, mode);
      const calls: Array<[string, () => Promise<unknown>]> = [
        ['post', () => client.postBatch(crawl())],
        ['poll', () => client.pollBatch(`${CHECK}:1`)],
        ['metrics', () => client.readMetrics()],
      ];
      for (const [method, call] of calls) {
        // The two answers that are not failures: a poll's 404 `not_found`, and metrics that are JSON.
        const answers =
          mode === 'answer' &&
          ((method === 'poll' && status === 404 && error('') === 'not_found') ||
            (method === 'metrics' && status === 200));
        if (answers) {
          await call();
          continue;
        }
        errors.push(await refusal(call()));
      }
      seen.push(...s);
    }
    const kinds = new Set(errors.map((e) => e.kind));
    expect([...kinds].sort()).toEqual(
      [
        'batch_exists',
        'busy',
        'forbidden',
        'invalid',
        'network',
        'nonce_replayed',
        'paused',
        'server',
        'timeout',
        'too_large',
        'unauthorized',
      ].sort(),
    );
    const jwts = seen.filter((v) => v.split('.').length === 3);
    expect(jwts.length).toBeGreaterThan(0);
    const planted = [
      ...forms(secret),
      keyB64,
      Buffer.from(keyB64, 'base64').toString('base64url'),
      ...jwts,
      ...jwts.map((j) => j.split('.')[2]!),
      ...seen.filter((v) => /^[0-9a-f]{64}$/.test(v)),
    ];
    for (const e of errors) {
      expect(e).toBeInstanceOf(WorkerError);
      expect(e.cause).toBeUndefined();
      for (const text of [e.message, String(e), e.stack ?? '', JSON.stringify(e)]) {
        for (const p of planted) expect(text).not.toContain(p);
      }
    }
  });
});

describe('workerClientFromEnv', () => {
  const env = (w: InProcessWorker) => ({
    CRAWL_WORKER_URL: w.base,
    WORKER_SIGNING_SECRET: w.signingSecret,
    WORKER_JWT_PRIVATE_KEY_PKCS8_B64: w.privateKeyB64,
  });

  it('is null when any of the three is missing or empty', async () => {
    const full = env(await worker());
    for (const name of Object.keys(full) as Array<keyof typeof full>) {
      expect(workerClientFromEnv({ ...full, [name]: undefined })).toBeNull();
      expect(workerClientFromEnv({ ...full, [name]: '' })).toBeNull();
      expect(workerClientFromEnv({ ...full, [name]: '  ' })).toBeNull();
    }
  });

  it("drops the URL's trailing slash, and reaches the worker with the three values", async () => {
    // The worker's clock is virtual; this client reads the real one, so the worker is set to it.
    const w = await worker();
    w.clock.advance(Date.now() - w.clock.now());
    const client = workerClientFromEnv({ ...env(w), CRAWL_WORKER_URL: `${w.base}/` });
    expect(await client!.readMetrics()).toMatchObject({ batches_running: 0 });
    expect(await client!.postBatch(crawl())).toMatchObject({ batch_id: expect.any(String) });
  });

  it('refuses a key that is not Ed25519, naming the variable and not the value', async () => {
    const w = await worker();
    const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 })
      .privateKey.export({ format: 'der', type: 'pkcs8' })
      .toString('base64');
    expect(() => workerClientFromEnv({ ...env(w), WORKER_JWT_PRIVATE_KEY_PKCS8_B64: rsa })).toThrow(
      /^WORKER_JWT_PRIVATE_KEY_PKCS8_B64 is not an Ed25519 private key$/,
    );
  });
});

describe('createWorkerClient', () => {
  const key: KeyObject = generateKeyPairSync('ed25519').privateKey;
  it('refuses a URL that is not plain http(s), without repeating it', () => {
    for (const url of [
      'ftp://worker.test',
      'https://u:p@worker.test',
      'https://worker.test/?q=1',
      'nonsense',
    ]) {
      expect(() =>
        createWorkerClient({ url, signingSecret: 's'.repeat(32), privateKey: key }),
      ).toThrow(
        /^CRAWL_WORKER_URL must be an http\(s\) URL with no credentials, query or fragment$/,
      );
    }
  });

  it('refuses plain http to another machine, and takes it to this one', () => {
    for (const url of [
      'http://worker.test',
      'http://crawlmouse-worker-staging.fly.dev',
      'http://10.0.0.1',
    ]) {
      expect(() =>
        createWorkerClient({ url, signingSecret: 's'.repeat(32), privateKey: key }),
      ).toThrow(/^CRAWL_WORKER_URL must be https unless the worker is on this machine$/);
    }
    for (const url of ['http://127.0.0.1:9', 'http://localhost:8080', 'http://[::1]:8080']) {
      expect(() =>
        createWorkerClient({ url, signingSecret: 's'.repeat(32), privateKey: key }),
      ).not.toThrow();
    }
  });

  it('refuses an empty signing secret or a key that is not Ed25519', () => {
    expect(() =>
      createWorkerClient({ url: 'https://worker.test', signingSecret: '', privateKey: key }),
    ).toThrow(/WORKER_SIGNING_SECRET/);
    const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
    expect(() =>
      createWorkerClient({
        url: 'https://worker.test',
        signingSecret: 's'.repeat(32),
        privateKey: rsa,
      }),
    ).toThrow(/Ed25519/);
  });
});

describe('the app does not depend on the worker package', () => {
  it('no app file here imports it', () => {
    for (const file of ['client.ts', 'jwt.ts', 'sign.ts', 'types.ts']) {
      const source = readFileSync(new URL(`./${file}`, import.meta.url), 'utf8');
      expect({
        file,
        imports: /from ['"][^'"]*(?:packages\/worker|@crawlmouse\/worker)/.test(source),
      }).toEqual({
        file,
        imports: false,
      });
    }
  });
});

describe('measureRendered (questions/042, design C)', () => {
  const SECRET_ = 's'.repeat(48);
  const reading = {
    raw_words: 3,
    rendered_words: 12,
    challenged: false,
    links: { js_only: ['https://example.com/shop'], js_only_count: 1, truncated: false },
  };
  const make = (respond: (req: Request) => Response | Promise<Response>) => {
    const seen: Request[] = [];
    const waits: number[] = [];
    const client = createWorkerClient({
      sleep: async (ms) => {
        waits.push(ms);
      },
      url: 'http://127.0.0.1:9',
      signingSecret: SECRET_,
      privateKey: generateKeyPairSync('ed25519').privateKey,
      now: () => 1_800_000_000_000,
      fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
        const req = new Request(input, init);
        seen.push(req.clone());
        return respond(req);
      }) as typeof fetch,
    });
    return { client, seen, waits };
  };

  it('posts the two sides signed under the measure key, and returns the reading', async () => {
    const { client, seen } = make(() => Response.json({ reading }));
    expect(await client.measureRendered!('<p>a</p>', '<p>b</p>', 'https://example.com/p')).toEqual(
      reading,
    );
    const req = seen[0]!;
    expect(new URL(req.url).pathname).toBe('/render/measure');
    const raw = new Uint8Array(await req.arrayBuffer());
    const ts = req.headers.get('x-crawlmouse-ts')!;
    // Computed here, apart from sign.ts: the body's digest and length, and the HMAC under the key
    // derived from the label over ts, digest and length.
    const digest = createHash('sha256').update(raw).digest('hex');
    expect(req.headers.get('x-crawlmouse-body-sha256')).toBe(digest);
    expect(req.headers.get('x-crawlmouse-body-bytes')).toBe(String(raw.length));
    const key = createHmac('sha256', SECRET_).update('crawlmouse-worker-measure-v1').digest();
    const expected = createHmac('sha256', key)
      .update(`${ts}.${digest}.${raw.length}`)
      .digest('hex');
    expect(req.headers.get('x-crawlmouse-signature')).toBe(expected);
    expect(JSON.parse(new TextDecoder().decode(raw))).toEqual({
      static_html: '<p>a</p>',
      rendered_html: '<p>b</p>',
      url: 'https://example.com/p',
    });
  });

  it.each([
    ['a stopped read', () => Response.json({ failed: 'reader_deadline' })],
    ['a refusal', () => Response.json({ error: 'reader_unavailable' }, { status: 503 })],
    [
      'a reading of the wrong shape',
      () => Response.json({ reading: { ...reading, raw_words: -1 } }),
    ],
    ['an extra field', () => Response.json({ reading: { ...reading, x: 1 } })],
  ])('answers null for %s, and never throws', async (_name, respond) => {
    const { client, seen } = make(respond);
    expect(
      await client.measureRendered!('<p>a</p>', '<p>b</p>', 'https://example.com/p'),
    ).toBeNull();
    expect(seen).toHaveLength(1);
  });

  const busy = () => Response.json({ error: 'measure_busy' }, { status: 429 });

  it('waits long enough for every read the worker holds ahead of it, and its own', () => {
    // The worker holds MEASURE_CONCURRENCY signed requests, each read under READ_DEADLINE_MS, one
    // after another on its measure thread; 5 s more is for the HTML each way.
    // and 5 s for a replacement thread to load.
    expect(MEASURE_TIMEOUT_MS).toBeGreaterThanOrEqual(
      MEASURE_CONCURRENCY * READ_DEADLINE_MS + 5_000 + 5_000,
    );
  });

  it('waits and asks again while the worker is busy measuring, then returns the reading', async () => {
    let n = 0;
    const { client, seen, waits } = make(() => (n++ < 2 ? busy() : Response.json({ reading })));
    expect(await client.measureRendered!('<p>a</p>', '<p>b</p>', 'https://example.com/p')).toEqual(
      reading,
    );
    expect(seen).toHaveLength(3);
    expect(waits).toEqual([1_000, 2_000]);
    // Each try is signed afresh, over the same body.
    expect(new Set(seen.map((r) => r.headers.get('x-crawlmouse-body-sha256'))).size).toBe(1);
  });

  it(`gives up after ${MEASURE_BUSY_WAITS_MS.length} waits`, async () => {
    const { client, seen, waits } = make(busy);
    expect(
      await client.measureRendered!('<p>a</p>', '<p>b</p>', 'https://example.com/p'),
    ).toBeNull();
    expect(waits).toEqual([...MEASURE_BUSY_WAITS_MS]);
    expect(seen).toHaveLength(MEASURE_BUSY_WAITS_MS.length + 1);
  });

  it("is read by the worker's own route: the same headers, digest and signature", async () => {
    const w = await worker({}, undefined, { measure: async (b) => readMeasure(b) });
    const s = '<html><body><div id="root"></div></body></html>';
    const r = '<html><body><main><h1>Ridge tent</h1><a href="/shop">Shop</a></main></body></html>';
    expect(await clientOf(w).measureRendered!(s, r, 'https://example.com/p')).toEqual(
      readRendered(s, r, 'https://example.com/p'),
    );
  });

  it('asks again after a network failure, such as a busy worker resetting a long upload', async () => {
    let n = 0;
    const { client, seen, waits } = make(() => {
      if (n++ === 0) throw new TypeError('fetch failed');
      return Response.json({ reading });
    });
    expect(await client.measureRendered!('<p>a</p>', '<p>b</p>', 'https://example.com/p')).toEqual(
      reading,
    );
    expect(seen).toHaveLength(2);
    expect(waits).toEqual([1_000]);
  });

  it('answers null after a network failure on every try, and never throws', async () => {
    const { client, seen } = make(() => {
      throw new TypeError('fetch failed');
    });
    expect(
      await client.measureRendered!('<p>a</p>', '<p>b</p>', 'https://example.com/p'),
    ).toBeNull();
    expect(seen).toHaveLength(MEASURE_BUSY_WAITS_MS.length + 1);
  });

  it('does not ask again after a timeout', async () => {
    const { client, seen } = make(() => {
      throw new DOMException('timed out', 'TimeoutError');
    });
    expect(
      await client.measureRendered!('<p>a</p>', '<p>b</p>', 'https://example.com/p'),
    ).toBeNull();
    expect(seen).toHaveLength(1);
  });

  it('does not ask again on a 429 that is not the worker saying it is busy measuring', async () => {
    const { client, seen } = make(() => Response.json({ error: 'busy' }, { status: 429 }));
    expect(
      await client.measureRendered!('<p>a</p>', '<p>b</p>', 'https://example.com/p'),
    ).toBeNull();
    expect(seen).toHaveLength(1);
  });
});
