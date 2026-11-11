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
    const deps = checkRouteDeps(async () => false);
    await deps.captureFinished(req(), CHECK, FINISHED);
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
    const deps = checkRouteDeps(async () => false);
    let settled = false;
    const captured = deps.captureFinished(req(), CHECK, FINISHED).then(() => {
      settled = true;
    });
    await vi.waitFor(() => expect(fetched).toHaveLength(1));
    expect(settled).toBe(false);
    answer(new Response('{}'));
    await captured;
    expect(fetched.map((b) => b.event)).toEqual(['check_finished']);
  });
});
