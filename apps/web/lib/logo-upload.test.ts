import { describe, it, expect } from 'vitest';
import { uploadLogo } from './logo-upload';

const resLike = (ok: boolean, status: number, body: unknown = {}) =>
  ({ ok, status, json: () => Promise.resolve(body) }) as unknown as Response;
const blob = () => new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' });

// SPEC 04.1 §3 — injectable client wrapper for the shipped logo route (multipart). Returns the stored
// logoPath, which the caller then attaches via the white-label route. The server byte-validation is the
// authoritative gate (U4); this maps outcomes only.
describe('uploadLogo', () => {
  it('POSTs multipart with the logo field and returns logoPath on 200', async () => {
    let url = ''; let init: RequestInit | undefined;
    const fetchImpl = (async (u: string, i: RequestInit) => {
      url = u; init = i;
      return resLike(true, 200, { ok: true, logoPath: 'abc/deadbeef.png' });
    }) as unknown as typeof fetch;
    const r = await uploadLogo('abc', blob(), fetchImpl);
    expect(r).toEqual({ ok: true, logoPath: 'abc/deadbeef.png' });
    expect(url).toBe('/api/reports/abc/logo');
    expect(init?.method).toBe('POST');
    expect(init?.body instanceof FormData).toBe(true);
    expect((init?.body as FormData).get('logo')).toBeInstanceOf(Blob);
  });

  it('maps 402 → pro_required, 400 → invalid_image, 503 → unavailable', async () => {
    expect(await uploadLogo('x', blob(), (async () => resLike(false, 402)) as unknown as typeof fetch)).toEqual({ ok: false, error: 'pro_required' });
    expect(await uploadLogo('x', blob(), (async () => resLike(false, 400, { reason: 'no_svg' })) as unknown as typeof fetch)).toEqual({ ok: false, error: 'invalid_image' });
    expect(await uploadLogo('x', blob(), (async () => resLike(false, 503)) as unknown as typeof fetch)).toEqual({ ok: false, error: 'unavailable' });
    expect(await uploadLogo('x', blob(), (async () => resLike(false, 429)) as unknown as typeof fetch)).toEqual({ ok: false, error: 'rate_limited' });
  });

  it('fails closed on a network error', async () => {
    expect(await uploadLogo('x', blob(), (async () => { throw new Error('net'); }) as unknown as typeof fetch)).toEqual({ ok: false, error: 'network' });
  });
});
