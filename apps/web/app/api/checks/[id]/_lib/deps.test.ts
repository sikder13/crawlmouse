import { generateKeyPairSync } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { checkRef } from '../../../../../lib/v2/pipeline/public';

/**
 * `checkRouteDeps().captureFinished` executed, with the Supabase service client, Inngest and Next's
 * `after` replaced at the module boundary. What else the factory wires is in ../wiring.test.ts.
 */
const h = vi.hoisted(() => ({
  afterTasks: [] as Array<() => unknown>,
  afterThrows: false,
}));
vi.mock('server-only', () => ({}));
vi.mock('next/server', () => ({
  after: (task: () => unknown) => {
    if (h.afterThrows) throw new Error('`after` was called outside a request scope');
    h.afterTasks.push(task);
  },
}));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({}) }));
vi.mock('../../../../../../../inngest/client', () => ({
  inngest: { send: async () => undefined },
}));

import { checkRouteDeps } from './deps';
import { SIGNING_SECRET_ENV, WORKER_URL_ENV } from '../../../../../lib/worker-client/client';
import { PRIVATE_KEY_ENV } from '../../../../../lib/worker-client/jwt';
import { SIGNATURE_HEADER, TS_HEADER, signRead } from '../../../../../lib/worker-client/sign';

const CHECK = '0b0e7a52-5f0b-4b53-9c0e-0d4a3a1f2c11';
const req = () => new Request(`https://crawlmouse.test/api/checks/${CHECK}/stream`);
const FINISHED = { trigger: 'first_audit', status: 'finished', pages: 3, durationMs: 9 } as const;

let fetched: Array<Record<string, unknown>>;
/** Settles the capture's request; a test leaves it unsettled to stand for a PostHog that hangs. */
let answer: (res: Response) => void;

beforeEach(() => {
  h.afterTasks.length = 0;
  h.afterThrows = false;
  fetched = [];
  vi.stubEnv('NEXT_PUBLIC_POSTHOG_KEY', 'phc_test');
  vi.stubGlobal('fetch', (_url: string, init: { body: string }) => {
    fetched.push(JSON.parse(init.body));
    return new Promise<Response>((resolve) => {
      answer = resolve;
    });
  });
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('checkRouteDeps().captureFinished', () => {
  it('resolves before the capture is sent: the capture is left for `after`', async () => {
    const deps = checkRouteDeps({} as never, { userId: null });
    await deps.captureFinished(req(), CHECK, FINISHED, null);
    expect([h.afterTasks.length, fetched]).toEqual([1, []]);

    const ran = h.afterTasks[0]!();
    await vi.waitFor(() => expect(fetched).toHaveLength(1));
    expect(fetched[0]).toMatchObject({
      event: 'check_finished',
      distinct_id: `check:${checkRef(CHECK)}`,
      properties: { ...FINISHED, check_ref: checkRef(CHECK) },
    });
    answer(new Response('{}'));
    await ran;
  });

  it('awaits the capture itself when `after` refuses it', async () => {
    h.afterThrows = true;
    const deps = checkRouteDeps({} as never, { userId: null });
    let settled = false;
    const captured = deps.captureFinished(req(), CHECK, FINISHED, null).then(() => {
      settled = true;
    });
    await vi.waitFor(() => expect(fetched).toHaveLength(1));
    expect(settled).toBe(false);
    answer(new Response('{}'));
    await captured;
    expect(fetched.map((b) => b.event)).toEqual(['check_finished']);
  });
});

describe('checkRouteDeps().liveProgress', () => {
  const BATCH = `${CHECK}:2`;
  const SECRET = 's'.repeat(32);

  function plantWorker() {
    const key = generateKeyPairSync('ed25519').privateKey.export({ format: 'der', type: 'pkcs8' });
    vi.stubEnv(WORKER_URL_ENV, 'https://worker.test');
    vi.stubEnv(SIGNING_SECRET_ENV, SECRET);
    vi.stubEnv(PRIVATE_KEY_ENV, key.toString('base64'));
  }

  it('reads the running batch from the worker, signed for progress, and returns its answer', async () => {
    plantWorker();
    const calls: Array<{ url: string; headers: Headers }> = [];
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      calls.push({ url: String(url), headers: new Headers(init.headers) });
      return Response.json({
        batch_id: BATCH,
        status: 'running',
        progress: { pages: 2, links: 3, homepage_read: true },
        pages_total: 5,
        live_pages: [],
      });
    });

    const got = await checkRouteDeps({} as never, { userId: null }).liveProgress!(BATCH, 3);

    expect(got).toEqual({ pages: 2, links: 3, homepageRead: true, total: 5, fresh: [] });
    expect(calls.map((c) => c.url)).toEqual([
      `https://worker.test/batch/${BATCH}/progress?after=3`,
    ]);
    const ts = calls[0]!.headers.get(TS_HEADER)!;
    expect(calls[0]!.headers.get(SIGNATURE_HEADER)).toBe(signRead(SECRET, ts, `progress:${BATCH}`));
  });

  it('leaves the stream on the database when the worker key cannot be read', async () => {
    plantWorker();
    vi.stubEnv(PRIVATE_KEY_ENV, 'bm90IGEga2V5');
    const calls: unknown[] = [];
    vi.stubGlobal('fetch', async (url: string) => {
      calls.push(url);
      return Response.json({});
    });
    expect(await checkRouteDeps({} as never, { userId: null }).liveProgress!(BATCH, 0)).toBeNull();
    expect(calls).toEqual([]);
  });

  it('leaves the stream on the database when the worker is not configured', async () => {
    vi.stubEnv(WORKER_URL_ENV, '');
    const calls: unknown[] = [];
    vi.stubGlobal('fetch', async (url: string) => {
      calls.push(url);
      return Response.json({});
    });
    expect(await checkRouteDeps({} as never, { userId: null }).liveProgress!(BATCH, 0)).toBeNull();
    expect(calls).toEqual([]);
  });
});
