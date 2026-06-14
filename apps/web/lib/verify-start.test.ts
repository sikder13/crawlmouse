import { describe, it, expect, vi, afterEach } from 'vitest';
import { startVerification } from './verify-start';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

afterEach(() => vi.unstubAllGlobals());

describe('startVerification', () => {
  it('routes to /verify/<id> on success — never back to /dashboard (the original bug)', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(200, { id: 'abc123', token: 't0ken', verified: false }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await startVerification('alynthe.com', 'dns_txt');

    expect(result).toEqual({ ok: true, redirectTo: '/verify/abc123' });
    expect(result.redirectTo).not.toBe('/dashboard');
  });

  it('POSTs the chosen domain + method to /api/verify/start (the dead button never called the API)', async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) =>
      jsonResponse(200, { id: 'x1', token: 't', verified: false }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await startVerification('example.com', 'meta_tag');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/verify/start');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ domain: 'example.com', method: 'meta_tag' });
  });

  it('still routes to the verify page when the domain is already verified', async () => {
    // /api/verify/start returns { id, verified: true } for an already-verified domain; the verify
    // page then renders the "Verified" state. We must still navigate there, not treat it as an error.
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(200, { id: 'v9', token: 't', verified: true })));

    const result = await startVerification('owned.com', 'dns_txt');

    expect(result).toEqual({ ok: true, redirectTo: '/verify/v9' });
  });

  it('surfaces the server error message on a failed start (e.g. rate limited)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(429, { error: 'Too many verification requests. Try again later.' })));

    const result = await startVerification('example.com', 'dns_txt');

    expect(result).toEqual({ ok: false, error: 'Too many verification requests. Try again later.' });
  });

  it('treats a 200 response with no id as a failure (defensive — guards against a future server-shape regression)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(200, { token: 't', verified: false })));

    const result = await startVerification('example.com', 'dns_txt');

    expect(result).toEqual({ ok: false, error: 'Could not start verification' });
  });

  it('returns a friendly error when the network call itself throws', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));

    const result = await startVerification('example.com', 'dns_txt');

    expect(result).toEqual({ ok: false, error: 'Network error' });
  });
});
