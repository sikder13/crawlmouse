import type { PGlite } from '@electric-sql/pglite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { doorDb } from '../../../__tests__/v2/_lib/door-pglite';
import { checkRef } from '../../../lib/v2/pipeline/public';
import { sqlPipelineStore } from '../../../lib/v2/pipeline/test-support/sql-store';
import type { StartDeps } from './_lib/start';
import { sqlStartStore } from './_lib/start-store-sql';

// POST /api/checks as the platform calls it. The start runs on PGlite through the SQL stores; the
// limiter, the guard and Turnstile are fakes here (start.test.ts runs the real ones).

const h = vi.hoisted(() => ({
  user: null as { id: string } | null,
  getUser: 0,
  built: 0,
  deps: null as unknown,
}));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({
  supabaseServer: async () => ({
    auth: {
      getUser: async () => {
        h.getUser += 1;
        return { data: { user: h.user } };
      },
    },
  }),
}));
vi.mock('./_lib/start-deps', () => ({
  startDeps: (signedIn: StartDeps['signedIn']) => {
    h.built += 1;
    return { ...(h.deps as StartDeps), signedIn };
  },
}));

import { POST } from './route';

const REQUEST = '0b9d3c52-7c1e-4f0a-9a44-1f2e3d4c5b6a';
// stableId('public_check', REQUEST, 'example.com'), computed outside this codebase (start.test.ts).
const CHECK = '171e539a-b989-8cdd-9aa7-3245efaf29a2';
const IP = '203.0.113.9';

const post = (body: unknown, headers: Record<string, string> = {}) =>
  new Request('https://crawlmouse.com/api/checks', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': IP, ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
const VALID = { url: 'https://example.com/', requestId: REQUEST };

const read = async (res: Response) => ({ status: res.status, body: await res.json() });

let db: PGlite;
let sent: unknown[];
let ipAsked: unknown[][];
let captured: Array<{ url: string; body: Record<string, unknown> }>;
let logged: string[];

function deps(over: Partial<StartDeps> = {}): Omit<StartDeps, 'signedIn'> {
  return {
    admit: async (host) => host !== 'intranet.example.com',
    store: sqlStartStore(db),
    limits: {
      global: async () => true,
      ip: async (...args) => {
        ipAsked.push(args);
        return { allowed: true, resetAt: new Date(0) };
      },
      domain: async () => true,
    },
    verifyTurnstile: async () => false,
    pipeline: {
      store: sqlPipelineStore(db),
      send: async (event) => void sent.push(event),
      now: () => Date.UTC(2026, 10, 10, 12),
    },
    ...over,
  };
}

const counts = async () => ({
  sites: (await db.query('select 1 from public.sites')).rows.length,
  checks: (await db.query('select 1 from public.checks')).rows.length,
});

beforeEach(async () => {
  db = await doorDb();
  sent = [];
  ipAsked = [];
  captured = [];
  logged = [];
  h.user = null;
  h.getUser = 0;
  h.built = 0;
  h.deps = deps();
  vi.stubEnv('V2_CHECKS_PUBLIC', '1');
  vi.stubEnv('V2_PIPELINE', '1');
  vi.stubEnv('CRAWL_PAUSED', '');
  vi.stubEnv('NEXT_PUBLIC_POSTHOG_KEY', 'phc_test');
  vi.stubGlobal('fetch', async (url: string, init: { body: string }) => {
    captured.push({ url: String(url), body: JSON.parse(init.body) });
    return new Response('{}');
  });
  for (const level of ['log', 'info', 'warn', 'error'] as const) {
    vi.spyOn(console, level).mockImplementation((...args) => void logged.push(args.join(' ')));
  }
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('POST /api/checks, V2_CHECKS_PUBLIC unset', () => {
  it.each([
    ['unset', undefined],
    ['0', '0'],
    ['true', 'true'],
  ])(
    'is a 404 for the value %s, before the body, the session or the database is read',
    async (_, value) => {
      vi.stubEnv('V2_CHECKS_PUBLIC', value as string);
      const req = post(VALID);
      const json = vi.spyOn(req, 'json');
      expect(await read(await POST(req))).toEqual({ status: 404, body: { code: 'not_found' } });
      expect(json).not.toHaveBeenCalled();
      expect([h.built, h.getUser]).toEqual([0, 0]);
      expect(await counts()).toEqual({ sites: 0, checks: 0 });
      expect(captured).toEqual([]);
    },
  );
});

describe('POST /api/checks, before the body is read', () => {
  it('503 `unavailable` while V2_PIPELINE is unset: no function would run the check', async () => {
    vi.stubEnv('V2_PIPELINE', '');
    const req = post(VALID);
    const json = vi.spyOn(req, 'json');
    expect(await read(await POST(req))).toEqual({
      status: 503,
      body: { code: 'unavailable', error: 'Audits are not available right now.' },
    });
    expect(json).not.toHaveBeenCalled();
    expect(h.built).toBe(0);
    expect(await counts()).toEqual({ sites: 0, checks: 0 });
  });

  it('503 `paused` under CRAWL_PAUSED, with v1’s body, for a body that would not parse', async () => {
    vi.stubEnv('CRAWL_PAUSED', '1');
    const req = post('not json');
    const json = vi.spyOn(req, 'json');
    expect(await read(await POST(req))).toEqual({
      status: 503,
      body: {
        error: 'New audits are paused right now. Please try again shortly.',
        code: 'paused',
      },
    });
    expect(json).not.toHaveBeenCalled();
    expect(h.built).toBe(0);
  });
});

describe('POST /api/checks, the body', () => {
  it.each([
    ['not JSON', 'not json'],
    ['null', 'null'],
    ['no url', { requestId: REQUEST }],
    ['an empty url', { url: '', requestId: REQUEST }],
    ['a url that is not a string', { url: 7, requestId: REQUEST }],
    [
      'a url longer than 2,048 characters',
      { url: `https://example.com/${'a'.repeat(2048)}`, requestId: REQUEST },
    ],
    ['no requestId', { url: 'https://example.com/' }],
    ['a requestId that is not a uuid', { url: 'https://example.com/', requestId: 'abc' }],
    ['an empty turnstileToken', { ...VALID, turnstileToken: '' }],
  ])('400 `invalid_request` for %s, and the start is not run', async (_, body) => {
    expect(await read(await POST(post(body)))).toEqual({
      status: 400,
      body: { code: 'invalid_request', error: 'Send a url and a requestId.' },
    });
    expect(h.built).toBe(0);
    expect(await counts()).toEqual({ sites: 0, checks: 0 });
  });
});

describe('POST /api/checks, a start', () => {
  it('200 {checkId}, not to be stored, with one site, one check and one event', async () => {
    const res = await POST(post(VALID));
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await read(res)).toEqual({ status: 200, body: { checkId: CHECK } });
    expect(await counts()).toEqual({ sites: 1, checks: 1 });
    expect(sent).toHaveLength(1);
  });

  it('the same request again answers the same check and starts nothing', async () => {
    await POST(post(VALID));
    expect(await read(await POST(post(VALID)))).toEqual({ status: 200, body: { checkId: CHECK } });
    expect(await counts()).toEqual({ sites: 1, checks: 1 });
    expect(sent).toHaveLength(1);
  });

  it('a refusal is answered with its status and body', async () => {
    const res = await POST(post({ ...VALID, url: 'https://intranet.example.com/' }));
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await read(res)).toEqual({
      status: 400,
      body: { code: 'invalid_url', error: 'Enter the address of a public website.' },
    });
  });

  it('the caller’s address is the platform’s, and a visitor is not signed in', async () => {
    await POST(post(VALID));
    expect(ipAsked).toEqual([[IP, false]]);
  });

  it('a caller with a session is counted as signed in', async () => {
    h.user = { id: 'u1' };
    await POST(post(VALID));
    expect(ipAsked).toEqual([[IP, true]]);
  });

  it('the Turnstile token in the body reaches the verifier', async () => {
    const seen: unknown[][] = [];
    h.deps = deps({
      limits: {
        global: async () => true,
        ip: async () => ({ allowed: false, resetAt: new Date(0) }),
        domain: async () => true,
      },
      verifyTurnstile: async (...args) => {
        seen.push(args);
        return true;
      },
    });
    const res = await POST(post({ ...VALID, turnstileToken: 'tok' }));
    expect(res.status).toBe(200);
    expect(seen).toEqual([['tok', IP]]);
  });
});

describe('POST /api/checks, `check_started`', () => {
  it('is sent once for a start, under the check’s ref, with no person profile', async () => {
    await POST(post(VALID, { cookie: 'ph=abc' }));
    expect(captured).toEqual([
      {
        url: 'https://us.i.posthog.com/i/v0/e/',
        body: {
          api_key: 'phc_test',
          event: 'check_started',
          distinct_id: `check:${checkRef(CHECK)}`,
          properties: {
            trigger: 'first_audit',
            check_ref: checkRef(CHECK),
            $process_person_profile: false,
          },
        },
      },
    ]);
  });

  it('carries neither the request id, the check id, the host nor the caller’s address', async () => {
    await POST(post(VALID));
    const wire = JSON.stringify(captured);
    expect(captured).toHaveLength(1);
    for (const absent of [REQUEST, CHECK, 'example.com', IP]) expect(wire).not.toContain(absent);
  });

  it('is not sent again when the same request is answered again', async () => {
    await POST(post(VALID));
    await POST(post(VALID));
    expect(captured).toHaveLength(1);
  });

  it.each([
    ['a host the guard refuses', () => post({ ...VALID, url: 'https://intranet.example.com/' })],
    ['a body that does not parse', () => post({ url: 'https://example.com/' })],
  ])('is not sent for %s', async (_, request) => {
    expect((await POST(request())).status).toBe(400);
    expect(captured).toEqual([]);
  });

  it.each([
    ['the day’s ceiling', { global: async () => false }, 503],
    ['the address limit', { ip: async () => ({ allowed: false, resetAt: new Date(0) }) }, 429],
    ['the domain limit', { domain: async () => false }, 429],
  ])('is not sent for a start refused by %s', async (_, limit, status) => {
    const open = deps().limits;
    h.deps = deps({ limits: { ...open, ...limit } });
    expect((await POST(post(VALID))).status).toBe(status);
    expect(captured).toEqual([]);
  });

  it('is not sent where analytics needs prior consent, and the start is answered', async () => {
    const res = await POST(post(VALID, { cookie: 'cm_consent_required=1' }));
    expect(await read(res)).toEqual({ status: 200, body: { checkId: CHECK } });
    expect(captured).toEqual([]);
  });

  it('a capture that fails does not fail the start', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new Error('network');
    });
    expect(await read(await POST(post(VALID)))).toEqual({ status: 200, body: { checkId: CHECK } });
  });
});

describe('POST /api/checks, what is logged', () => {
  it('a start logs neither the request id nor the check id', async () => {
    await POST(post(VALID));
    await POST(post(VALID));
    expect(logged.join('\n')).not.toMatch(new RegExp(`${REQUEST}|${CHECK}`, 'i'));
  });

  it('a failure is a fixed 500, logged with both ids written out of its message', async () => {
    h.deps = deps({
      pipeline: {
        ...deps().pipeline,
        send: async () => {
          throw new Error(`send failed for ${CHECK} (request ${REQUEST.toUpperCase()})`);
        },
      },
    });
    expect(await read(await POST(post(VALID)))).toEqual({
      status: 500,
      body: { code: 'start_failed', error: 'The audit could not be started. Try again.' },
    });
    expect(logged).toEqual([
      '[api/checks] start failed: send failed for [redacted] (request [redacted])',
    ]);
    expect(captured).toEqual([]);
  });
});
