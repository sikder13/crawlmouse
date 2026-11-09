import { generateKeyPairSync, type KeyObject } from 'node:crypto';
import { readFileSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { REFUSALS } from '../../../../packages/worker/src/routes';
import type { Fetcher } from '../../../../packages/worker/src/fetch/fetcher';
import { InstantClock } from '../../../../packages/worker/src/test-support/clock';
import { pageFetcher, startWorker, type InProcessWorker } from './__tests__/in-process-worker';
import { createWorkerClient, WORKER_REFUSALS, workerClientFromEnv } from './client';
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
  it('posts a crawl batch it accepts, polls it to done, and reads metrics', async () => {
    const w = await worker();
    const client = clientOf(w);
    const batch = crawl();
    expect(await client.postBatch(batch)).toEqual({ batch_id: `${CHECK}:${batch.batch}` });
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
      progress: { urls_done: 0, urls_total: 2, requests: 0 },
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
    [408, { error: 'body_timeout' }, 'invalid', 'body_timeout'],
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

  it('a redirect is not followed: the signed request goes nowhere else', async () => {
    const hits: string[] = [];
    const elsewhere = await listen((req, res) => {
      hits.push(req.url ?? '');
      res.end('{}');
    });
    const url = await listen((_req, res) => {
      res.writeHead(307, { location: `${elsewhere}/batch` });
      res.end();
    });
    expect(shape(await refusal(over(url).postBatch(crawl())))).toEqual({
      kind: 'network',
      status: null,
      code: null,
    });
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
