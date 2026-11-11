/**
 * The stream, notify and cancel routes run into production's wiring: `requestAccess`
 * (lib/v2/pipeline/public-deps.ts), `checkRouteDeps` (_lib/deps.ts) and `checkRouteLimits`
 * (_lib/limits.ts) are the real modules. Replaced at the module boundary: the two Supabase clients
 * (each records its requests), the limiter's database call, Inngest, Next's `after`, and the three
 * handlers, which here hand back the viewer and the dependencies they were given.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CancelDeps } from './cancel/cancel';
import type { NotifyDeps } from './notify/notify';
import type { StreamDeps } from './stream/serve';

type Call = [string, ...unknown[]];
type Deps = StreamDeps & NotifyDeps & CancelDeps;

const h = vi.hoisted(() => {
  /** A supabase-js client that records each request's calls and answers with `answer.value`. */
  const recording = () => {
    const requests: [string, ...unknown[]][][] = [];
    const answer = { value: { data: null as unknown, error: null as unknown } };
    const client = {
      from(table: string) {
        const calls: [string, ...unknown[]][] = [['from', table]];
        requests.push(calls);
        const builder: Record<string, unknown> = {};
        for (const m of ['select', 'eq', 'in', 'order', 'range', 'maybeSingle', 'update']) {
          builder[m] = (...args: unknown[]) => {
            calls.push([m, ...args]);
            return builder;
          };
        }
        builder.then = (resolve: (v: unknown) => void) => resolve(answer.value);
        return builder;
      },
    };
    return { client, requests, answer };
  };
  return {
    session: recording(),
    admin: recording(),
    user: { id: null as string | null },
    limited: [] as unknown[][],
    sent: [] as unknown[],
    given: null as { viewer: unknown; deps: unknown } | null,
  };
});

vi.mock('server-only', () => ({}));
vi.mock('next/server', () => ({ after: () => undefined }));
vi.mock('@/lib/supabase/server', () => ({
  supabaseServer: async () => ({
    ...h.session.client,
    auth: {
      getUser: async () => ({ data: { user: h.user.id === null ? null : { id: h.user.id } } }),
    },
  }),
}));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => h.admin.client }));
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: async (...args: unknown[]) => {
    h.limited.push(args);
    return { allowed: true, remaining: 1, resetAt: new Date(0) };
  },
}));
vi.mock('../../../../../../inngest/client', () => ({
  inngest: { send: async (event: unknown) => void h.sent.push(event) },
}));
const handler = vi.hoisted(() => (...args: unknown[]) => {
  const viewer = args.find((a) => typeof a === 'object' && a !== null && 'userId' in a);
  h.given = { viewer, deps: args.at(-1) };
  return Response.json({});
});
vi.mock('./stream/serve', () => ({ serveStream: handler }));
vi.mock('./notify/notify', () => ({ notify: handler }));
vi.mock('./cancel/cancel', () => ({ cancel: handler }));

// Loaded here, not inside a test: the routes' module graph is not counted against a test's time.
import { POST as cancelRoute } from './cancel/route';
import { POST as notifyRoute } from './notify/route';
import { GET as streamRoute } from './stream/route';

const CHECK = '0b0e7a52-5f0b-4b53-9c0e-0d4a3a1f2c11';
const SITE = '5d0c7d0e-11a4-4b0b-8a43-6f3b4f8f2a10';
const USER = 'f2b0a6de-3a57-4f0e-9c55-0a1b2c3d4e5f';
const ctx = { params: Promise.resolve({ id: CHECK }) };
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

const routes = [
  ['stream', 'GET', streamRoute],
  ['notify', 'POST', notifyRoute],
  ['cancel', 'POST', cancelRoute],
] as const;

/** The viewer and the dependencies a route hands its handler for a request from `userId`. */
async function wired(route: (typeof routes)[number][2], method: string, userId: string | null) {
  h.user.id = userId;
  await route(new Request(`https://crawlmouse.test/api/checks/${CHECK}/x`, { method }), ctx);
  return h.given as { viewer: { userId: string | null }; deps: Deps };
}

const tablesOf = (requests: Call[][]) => requests.map((r) => r[0]![1]);

beforeEach(() => {
  vi.stubEnv('V2_CHECKS_PUBLIC', '1');
  for (const client of [h.session, h.admin]) {
    client.requests.length = 0;
    client.answer.value = { data: null, error: null };
  }
  h.limited.length = 0;
  h.sent.length = 0;
  h.given = null;
});
afterEach(() => vi.unstubAllEnvs());

describe.each(routes)('/api/checks/[id]/%s, as production wires it', (_name, method, route) => {
  it('membership is asked with the session’s client, by site id, and not with the service role’s', async () => {
    const { viewer, deps } = await wired(route, method, USER);
    expect(viewer).toEqual({ userId: USER });

    h.session.answer.value = { data: [{ id: SITE }], error: null };
    expect(await deps.isMember(SITE, USER)).toBe(true);
    h.session.answer.value = { data: [], error: null };
    expect(await deps.isMember(SITE, USER)).toBe(false);
    const asked: Call[] = [
      ['from', 'sites'],
      ['select', 'id'],
      ['eq', 'id', SITE],
    ];
    expect(h.session.requests).toEqual([asked, asked]);
    expect(h.admin.requests).toEqual([]);
  });

  it('a user id that is not the session’s is not a member, and no client is asked', async () => {
    const { deps } = await wired(route, method, USER);
    h.session.answer.value = { data: [{ id: SITE }], error: null };
    expect(await deps.isMember(SITE, '00000000-0000-4000-8000-000000000000')).toBe(false);
    expect([h.session.requests, h.admin.requests]).toEqual([[], []]);
  });

  it('a membership read that fails throws: it is not answered as a refusal or as a member', async () => {
    const { deps } = await wired(route, method, USER);
    h.session.answer.value = { data: null, error: { code: '57014', message: 'timeout' } };
    await expect(deps.isMember(SITE, USER)).rejects.toThrow('reading the site as its member');
  });

  it('a visitor’s viewer has no user id', async () => {
    expect((await wired(route, method, null)).viewer).toEqual({ userId: null });
  });

  it('rows are read and written with the service role’s client, not the session’s', async () => {
    const { deps } = await wired(route, method, USER);
    await deps.store.snapshot(CHECK);
    h.admin.answer.value = { data: [], error: null };
    await deps.store.setNotifyEmail(CHECK, 'a@example.com');
    await deps.read.rows('checks', 'id', [CHECK]);
    expect(tablesOf(h.admin.requests)).toEqual(['checks', 'checks', 'checks']);
    expect(h.session.requests).toEqual([]);
  });

  it('events go to Inngest', async () => {
    const { deps } = await wired(route, method, USER);
    const event = { id: 'e-1', name: 'check.cancel.requested', data: { checkId: CHECK } };
    await deps.send(event as Parameters<Deps['send']>[0]);
    expect(h.sent).toEqual([event]);
  });

  it('each limit calls checkRateLimit with its key, its number and its window, failing open', async () => {
    const { deps } = await wired(route, method, USER);
    await deps.limits.streamOpens('203.0.113.7');
    await deps.limits.finishedOnce(CHECK);
    await deps.limits.notifyIp('203.0.113.7');
    await deps.limits.notifyAddress('dana@example.com');
    // No fourth argument: `failClosed` is not set, so each fails open (lib/rate-limit.ts).
    expect(h.limited).toEqual([
      ['stream:ip:203.0.113.7', 120, HOUR_MS],
      [expect.stringMatching(/^event:check_finished:[0-9a-f-]{36}$/), 1, DAY_MS],
      ['notify:ip:203.0.113.7', 10, DAY_MS],
      [expect.stringMatching(/^notify:email:[0-9a-f-]{36}$/), 5, DAY_MS],
    ]);
    const keys = h.limited.map((l) => l[0]).join(' ');
    expect(keys).not.toContain(CHECK);
    expect(keys).not.toContain('dana');
  });
});
