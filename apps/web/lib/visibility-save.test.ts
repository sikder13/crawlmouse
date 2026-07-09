import { describe, it, expect } from 'vitest';
import { saveVisibility } from './visibility-save';

const resLike = (ok: boolean, status: number, body: unknown = {}) =>
  ({ ok, status, json: () => Promise.resolve(body) }) as unknown as Response;

// SPEC 04.1 §4 — injectable client wrapper for the shipped visibility route (owner opt in/out of
// listed/indexable). Server enforces auth → verified owner → claimed; this maps outcomes only.
describe('saveVisibility', () => {
  it('POSTs the partial patch and returns the new state on 200', async () => {
    let url = ''; let init: RequestInit | undefined;
    const fetchImpl = (async (u: string, i: RequestInit) => {
      url = u; init = i;
      return resLike(true, 200, { ok: true, listed: false, indexable: true });
    }) as unknown as typeof fetch;
    const r = await saveVisibility('abc', { listed: false }, fetchImpl);
    expect(r).toEqual({ ok: true, listed: false, indexable: true });
    expect(url).toBe('/api/reports/abc/visibility');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(init?.body as string)).toEqual({ listed: false });
  });

  it('maps the gate failures (403/409/503)', async () => {
    expect(await saveVisibility('x', { listed: true }, (async () => resLike(false, 403)) as unknown as typeof fetch)).toEqual({ ok: false, error: 'verification_required' });
    expect(await saveVisibility('x', { listed: true }, (async () => resLike(false, 409)) as unknown as typeof fetch)).toEqual({ ok: false, error: 'not_claimed' });
    expect(await saveVisibility('x', { listed: true }, (async () => resLike(false, 503)) as unknown as typeof fetch)).toEqual({ ok: false, error: 'unavailable' });
    expect(await saveVisibility('x', { listed: true }, (async () => resLike(false, 429)) as unknown as typeof fetch)).toEqual({ ok: false, error: 'rate_limited' });
  });

  it('fails closed on a network error', async () => {
    expect(await saveVisibility('x', { indexable: false }, (async () => { throw new Error('net'); }) as unknown as typeof fetch)).toEqual({ ok: false, error: 'network' });
  });
});
