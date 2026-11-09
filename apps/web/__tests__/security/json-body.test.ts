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
