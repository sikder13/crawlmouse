import { NextRequest, NextResponse } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { handleEdge } from '../../middleware';

// POST /api/audits/start reads req.json() whatever the Content-Type, so before CC-SEC any page could
// make its visitors' browsers start crawls with a text/plain POST, which needs no CORS preflight. The
// request here goes through the middleware and, when it passes, on to the real route handler, with
// every rate-limit bucket, database call and event recorded.

const calls = vi.hoisted(() => [] as string[]);
const recorder = vi.hoisted(() => (name: string): unknown => {
  const chain: unknown = new Proxy(() => undefined, {
    get(_, prop) {
      if (prop === 'then')
        return (resolve: (v: unknown) => void) => resolve({ data: null, error: null });
      return (...args: unknown[]) => {
        calls.push(`${name}.${String(prop)}${prop === 'from' ? `(${String(args[0])})` : ''}`);
        return chain;
      };
    },
  });
  return chain;
});

vi.mock('server-only', () => ({}));
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: async (key: string) => {
    calls.push(`rateLimit(${key.split(':')[0]})`);
    return { allowed: true };
  },
}));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => recorder('admin') }));
vi.mock('@/lib/supabase/server', () => ({
  supabaseServer: async () => ({ auth: { getUser: async () => ({ data: { user: null } }) } }),
}));
vi.mock('@/lib/inngest', () => ({ inngest: recorder('inngest') }));
vi.mock('@/lib/anon-session', () => ({ getOrCreateAnonSessionId: async () => 'anon-1' }));
vi.mock('@crawlmouse/engine', () => ({ validateUrlOrThrow: async () => undefined }));

const BODY = JSON.stringify({ url: 'https://example.com' });

/** The request as the platform runs it: the middleware, then the route when the middleware passes it. */
async function send(contentType: string): Promise<Response> {
  const req = new NextRequest(
    new Request('https://crawlmouse.com/api/audits/start', {
      method: 'POST',
      headers: { 'content-type': contentType },
      body: BODY,
    }),
  );
  const edge = await handleEdge(
    req,
    (r) => Promise.resolve(NextResponse.next({ request: r })),
    () => {},
  );
  if (edge.headers.get('x-middleware-next') !== '1') return edge;
  const { POST } = await import('../../app/api/audits/start/route');
  return POST(
    new Request('https://crawlmouse.com/api/audits/start', {
      method: 'POST',
      headers: { 'content-type': contentType },
      body: BODY,
    }),
  );
}

beforeEach(() => {
  calls.length = 0;
});

describe('POST /api/audits/start with a body not declared JSON', () => {
  it('a text/plain POST with a JSON body gets 415 before any rate-limit bucket or insert', async () => {
    const res = await send('text/plain;charset=UTF-8');
    expect(res.status).toBe(415);
    expect(await res.json()).toEqual({
      error: 'Send the request body as JSON',
      code: 'unsupported_media_type',
    });
    expect(calls).toEqual([]);
  });

  it('the same body declared JSON reaches the global bucket and the insert (the pipeline is live)', async () => {
    await send('application/json');
    expect(calls).toContain('rateLimit(global)');
    expect(calls).toContain('admin.insert');
  });
});

// POST /api/checks (CC-22b D2) reads JSON and is a public route with the lenient origin rule. Its row
// in the registry is what the middleware reads, so these requests go through the middleware and, when
// it passes them, on to the real route with V2_CHECKS_PUBLIC unset, where the route is a 404.
async function sendCheck(headers: Record<string, string>): Promise<Response> {
  const request = () =>
    new Request('https://crawlmouse.com/api/checks', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        url: 'https://example.com',
        requestId: '0b9d3c52-7c1e-4f0a-9a44-1f2e3d4c5b6a',
      }),
    });
  const edge = await handleEdge(
    new NextRequest(request()),
    (r) => Promise.resolve(NextResponse.next({ request: r })),
    () => {},
  );
  if (edge.headers.get('x-middleware-next') !== '1') return edge;
  const { POST } = await import('../../app/api/checks/route');
  return POST(request());
}

describe('POST /api/checks through the middleware, V2_CHECKS_PUBLIC unset', () => {
  beforeEach(() => {
    delete process.env.V2_CHECKS_PUBLIC;
  });

  it('a body not declared JSON gets 415 from the middleware', async () => {
    const res = await sendCheck({ 'content-type': 'text/plain;charset=UTF-8' });
    expect(res.status).toBe(415);
    expect(await res.json()).toEqual({
      error: 'Send the request body as JSON',
      code: 'unsupported_media_type',
    });
  });

  it('a cross-site post gets 403 from the middleware', async () => {
    const res = await sendCheck({
      'content-type': 'application/json',
      origin: 'https://evil.example',
      'sec-fetch-site': 'cross-site',
    });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'Cross-site request refused', code: 'cross_site' });
  });

  it('a JSON post from our own page reaches the route, which is a 404 with nothing touched', async () => {
    const res = await sendCheck({
      'content-type': 'application/json',
      origin: 'https://crawlmouse.com',
    });
    expect(res.status).toBe(404);
    // The route's own body: the middleware's 404 for an unregistered path also carries `error`.
    expect(await res.json()).toEqual({ code: 'not_found' });
    expect(calls).toEqual([]);
  });
});
