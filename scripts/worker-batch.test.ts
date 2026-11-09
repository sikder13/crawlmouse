import { generateKeyPairSync } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  pageFetcher,
  plantedSecret,
  startWorker,
  type InProcessWorker,
} from '../apps/web/lib/worker-client/__tests__/in-process-worker';
import {
  createWorkerClient,
  SIGNING_SECRET_ENV,
  WORKER_URL_ENV,
} from '../apps/web/lib/worker-client/client';
import type { Fetcher } from '../packages/worker/src/fetch/fetcher';
import type { InstantClock } from '../packages/worker/src/test-support/clock';
import {
  DEFAULT_JWT_TTL_S,
  MAX_JWT_TTL_S,
  PRIVATE_KEY_ENV,
} from '../apps/web/lib/worker-client/jwt';
import { BUDGET_CEILINGS } from '../packages/worker/src/batch/request';
import {
  DEFAULT_BUDGET_SECONDS,
  main,
  MAX_BUDGET_SECONDS,
  MAX_BYTES,
  MAX_REQUESTS,
  parseEnv,
  POLL_GRACE_S,
  POLL_INTERVAL_MS,
} from './worker-batch';

let running: InProcessWorker[] = [];
const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(running.map((w) => w.stop()));
  running = [];
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** The worker in process, its virtual clock set to the real one, since the script's client reads that. */
async function worker(...args: Parameters<typeof startWorker>): Promise<InProcessWorker> {
  const w = await startWorker(...args);
  w.clock.advance(Date.now() - w.clock.now());
  running.push(w);
  return w;
}

const envOf = (w: InProcessWorker) => ({
  CRAWL_WORKER_URL: w.base,
  WORKER_SIGNING_SECRET: w.signingSecret,
  WORKER_JWT_PRIVATE_KEY_PKCS8_B64: w.privateKeyB64,
});

function outFile(): string {
  const dir = mkdtempSync(join(tmpdir(), 'worker-batch-'));
  dirs.push(dir);
  return join(dir, 'result.json');
}

/** Captured output, and a poll loop whose waits end once the worker has nothing running. */
function ioFor(w: InProcessWorker | null) {
  const out: string[] = [];
  const err: string[] = [];
  let t = 0;
  const sleeps: number[] = [];
  return {
    out,
    err,
    sleeps,
    io: {
      out: (line: string) => out.push(line),
      err: (line: string) => err.push(line),
      now: () => t,
      sleep: async (ms: number) => {
        sleeps.push(ms);
        t += ms;
        if (w && w.worker.running() > 0) await Promise.race([w.worker.idle(), tick()]);
      },
    },
  };
}
const tick = () => new Promise((r) => setTimeout(r, 5));

/** How many batches the worker holds, read through its signed metrics. */
async function storedBatches(w: InProcessWorker): Promise<number> {
  const client = createWorkerClient({
    url: w.base,
    signingSecret: w.signingSecret,
    privateKey: w.privateKey,
    now: () => w.clock.now(),
  });
  return ((await client.readMetrics()) as { batches_stored: number }).batches_stored;
}

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

describe('parseEnv', () => {
  it('reads KEY=value lines, keeps every `=` after the first, and skips comments and blanks', () => {
    expect(parseEnv('# operator values\n\nA=1\nB = two==\n  C=x=y \nnot a line\n')).toEqual({
      A: '1',
      B: 'two==',
      C: 'x=y',
    });
  });
});

describe('worker-batch against the worker, in process', () => {
  it('posts a crawl batch, polls it, samples metrics, writes both, and prints counts', async () => {
    const w = await worker();
    const out = outFile();
    const run = ioFor(w);
    const code = await main(
      [
        '--kind',
        'crawl',
        '--url',
        'https://example.com/',
        '--url',
        'https://example.com/a',
        '--out',
        out,
      ],
      envOf(w),
      run.io,
    );
    expect({ code, err: run.err }).toEqual({ code: 0, err: [] });
    const written = JSON.parse(readFileSync(out, 'utf8')) as {
      result: { kind: string; pages: unknown[]; requests: number };
      metrics: { batches_stored: number };
    };
    expect(written.result.kind).toBe('crawl');
    expect(written.metrics.batches_stored).toBe(1);
    expect(run.out).toEqual([
      'posted: crawl batch, 2 URLs',
      `done: pages ${written.result.pages.length}, requests ${written.result.requests}, partial none`,
      `wrote ${out}`,
    ]);
    expect(run.sleeps.every((ms) => ms === POLL_INTERVAL_MS)).toBe(true);
  });

  it("posts an access batch, each page's template key its path", async () => {
    const w = await worker();
    const out = outFile();
    const run = ioFor(w);
    const code = await main(
      [
        '--kind',
        'access',
        '--url',
        'https://example.com/products/a',
        '--out',
        out,
        '--budget-seconds',
        '60',
      ],
      envOf(w),
      run.io,
    );
    expect({ code, err: run.err }).toEqual({ code: 0, err: [] });
    const written = JSON.parse(readFileSync(out, 'utf8')) as {
      result: { kind: string; access_tests: Array<{ template_key: string }>; requests: number };
    };
    expect(written.result.kind).toBe('access');
    expect(new Set(written.result.access_tests.map((t) => t.template_key))).toEqual(
      new Set(['/products/a']),
    );
    expect(run.out[1]).toBe(
      `done: access tests ${written.result.access_tests.length}, requests ${written.result.requests}, partial none`,
    );
  });

  it('gives up once the budget and its grace have passed, polling every interval until then', async () => {
    const slow = gated();
    const w = await worker({}, slow.fetcher);
    const out = outFile();
    const run = ioFor(null);
    const code = await main(
      ['--kind', 'crawl', '--url', 'https://example.com/', '--out', out, '--budget-seconds', '1'],
      envOf(w),
      run.io,
    );
    slow.release();
    const window = (1 + POLL_GRACE_S) * 1000;
    expect(code).toBe(1);
    expect(run.sleeps).toEqual(
      Array.from({ length: Math.floor(window / POLL_INTERVAL_MS) + 1 }, () => POLL_INTERVAL_MS),
    );
    expect(run.err).toEqual([`the batch did not finish within ${window / 1000} s`]);
    expect(existsSync(out)).toBe(false);
  });
});

describe('worker-batch refuses before sending', () => {
  const crawlOf = (...urls: string[]) => ['--kind', 'crawl', ...urls.flatMap((u) => ['--url', u])];
  const one = crawlOf('https://example.com/');
  const cases: Array<[string, string[]]> = [
    ['no kind', ['--url', 'https://example.com/', '--out', '/x']],
    ['another kind', ['--kind', 'render', '--url', 'https://example.com/', '--out', '/x']],
    ['no URL', ['--kind', 'crawl', '--out', '/x']],
    ['no out', one],
    ['a second host', [...crawlOf('https://example.com/', 'https://example.org/'), '--out', '/x']],
    [
      'www. beside the bare host',
      [...crawlOf('https://example.com/', 'https://www.example.com/'), '--out', '/x'],
    ],
    ['a port', [...crawlOf('https://example.com:8443/'), '--out', '/x']],
    ['an address for a host', [...crawlOf('https://127.0.0.1/'), '--out', '/x']],
    ['not a URL', [...crawlOf('example.com'), '--out', '/x']],
    ['a URL twice', [...crawlOf('https://example.com/', 'https://example.com/'), '--out', '/x']],
    [
      '51 URLs',
      [
        ...crawlOf(...Array.from({ length: 51 }, (_, i) => `https://example.com/${i}`)),
        '--out',
        '/x',
      ],
    ],
    ['a budget of 0 s', [...one, '--out', '/x', '--budget-seconds', '0']],
    ['a budget over 1800 s', [...one, '--out', '/x', '--budget-seconds', '1801']],
    ['an unknown flag', [...one, '--out', '/x', '--force', 'yes']],
    ['a flag with no value', [...one, '--out']],
  ];
  it.each(cases)('%s', async (_, argv) => {
    const w = await worker();
    const run = ioFor(w);
    expect(await main(argv, envOf(w), run.io)).toBe(2);
    expect(run.err.length).toBeGreaterThan(0);
    expect(run.out).toEqual([]);
    expect(await storedBatches(w)).toBe(0);
  });

  it('names the values it needs when any is missing, and nothing else', async () => {
    const w = await worker();
    for (const name of Object.keys(envOf(w))) {
      const run = ioFor(w);
      const env: Record<string, string | undefined> = { ...envOf(w), [name]: undefined };
      expect(
        await main(
          ['--kind', 'crawl', '--url', 'https://example.com/', '--out', '/x'],
          env,
          run.io,
        ),
      ).toBe(2);
      expect(run.err).toEqual([
        'scripts/.env.local must set CRAWL_WORKER_URL, WORKER_SIGNING_SECRET and WORKER_JWT_PRIVATE_KEY_PKCS8_B64',
      ]);
    }
  });
});

describe('no secret leaves the script', () => {
  const forms = (v: string): string[] => [
    v,
    Buffer.from(v).toString('base64'),
    Buffer.from(v).toString('base64url'),
  ];

  it('in its output or any error, on every path', async () => {
    const w = await worker();
    const paused = await worker({ paused: true });
    const closed = http.createServer();
    await new Promise<void>((r) => closed.listen(0, '127.0.0.1', r));
    const closedUrl = `http://127.0.0.1:${(closed.address() as AddressInfo).port}`;
    await new Promise<void>((r) => closed.close(() => r()));
    const otherKey = generateKeyPairSync('ed25519')
      .privateKey.export({ format: 'der', type: 'pkcs8' })
      .toString('base64');
    const rsaKey = generateKeyPairSync('rsa', { modulusLength: 2048 })
      .privateKey.export({ format: 'der', type: 'pkcs8' })
      .toString('base64');
    const wrongSecret = plantedSecret();

    const envs: Array<ReturnType<typeof envOf>> = [
      envOf(w),
      { ...envOf(w), WORKER_SIGNING_SECRET: wrongSecret },
      { ...envOf(w), WORKER_JWT_PRIVATE_KEY_PKCS8_B64: otherKey },
      { ...envOf(w), WORKER_JWT_PRIVATE_KEY_PKCS8_B64: rsaKey },
      {
        ...envOf(w),
        WORKER_JWT_PRIVATE_KEY_PKCS8_B64: Buffer.from(plantedSecret()).toString('base64'),
      },
      { ...envOf(w), CRAWL_WORKER_URL: 'not a url' },
      { ...envOf(w), CRAWL_WORKER_URL: closedUrl },
      envOf(paused),
    ];
    const planted = envs.flatMap((e) => [
      e.CRAWL_WORKER_URL,
      ...forms(e.WORKER_SIGNING_SECRET),
      e.WORKER_JWT_PRIVATE_KEY_PKCS8_B64,
      Buffer.from(e.WORKER_JWT_PRIVATE_KEY_PKCS8_B64, 'base64').toString('base64url'),
    ]);
    const texts: string[] = [];
    const codes: number[] = [];
    for (const env of envs) {
      for (const argv of [
        ['--kind', 'crawl', '--url', 'https://example.com/', '--out', outFile()],
        [
          '--kind',
          'crawl',
          '--url',
          'https://example.com/',
          '--url',
          'https://example.org/',
          '--out',
          outFile(),
        ],
      ]) {
        const run = ioFor(w);
        try {
          codes.push(await main(argv, env, run.io));
        } catch (e) {
          texts.push(String(e), (e as Error).stack ?? '', JSON.stringify(e));
        }
        texts.push(...run.out, ...run.err);
      }
    }
    expect(codes).toContain(0);
    expect(codes.filter((c) => c !== 0).length).toBeGreaterThanOrEqual(envs.length + 6);
    const all = texts.join('\n');
    expect(all).toMatch(/unauthorized/);
    expect(all).toMatch(/paused/);
    expect(all).toMatch(/network/);
    expect(all).toMatch(/WORKER_JWT_PRIVATE_KEY_PKCS8_B64 is not/);
    for (const p of planted) expect(all).not.toContain(p);
  });
});

describe('the runbook section', () => {
  const runbook = readFileSync(new URL('../docs/ops/worker-runbook.md', import.meta.url), 'utf8');
  const heading = '### Send one signed batch (operators)';
  const start = runbook.indexOf(heading);
  // Whitespace folded to one space, so line wrapping neither breaks nor satisfies a check.
  const section = runbook.slice(start, runbook.indexOf('\n## ', start)).replace(/\s+/g, ' ');

  it("states the script's numbers as the code has them", () => {
    expect(start).toBeGreaterThan(-1);
    expect(MAX_BUDGET_SECONDS).toBe(BUDGET_CEILINGS.max_seconds);
    for (const phrase of [
      `polls it every ${POLL_INTERVAL_MS / 1000} s`,
      `its time budget plus ${POLL_GRACE_S} s`,
      `${DEFAULT_BUDGET_SECONDS} by default, at most ${MAX_BUDGET_SECONDS}, the worker's ceiling`,
      `capped at ${MAX_REQUESTS.toLocaleString('en')} and ${MAX_BYTES / 1024 / 1024} MiB`,
      `\`exp\` ${DEFAULT_JWT_TTL_S / 60} minutes after \`iat\``,
      `lives longer than an hour`,
    ]) {
      expect(section).toContain(phrase);
    }
    expect(MAX_JWT_TTL_S).toBe(3600);
  });

  it('names the three values by the names the client reads', () => {
    for (const name of [WORKER_URL_ENV, SIGNING_SECRET_ENV, PRIVATE_KEY_ENV]) {
      expect(section).toContain(`\`${name}\``);
    }
  });
});
