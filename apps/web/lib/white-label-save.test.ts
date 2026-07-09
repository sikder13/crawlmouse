import { describe, it, expect } from 'vitest';
import { saveWhiteLabel } from './white-label-save';

const resLike = (ok: boolean, status: number, body: unknown = {}) =>
  ({ ok, status, json: () => Promise.resolve(body) }) as unknown as Response;

// SPEC 04.1 §3 — injectable client wrapper for the shipped white-label route. The server enforces the
// real gate (auth → paid → verified owner → claimed); this maps outcomes so the control can react.
describe('saveWhiteLabel', () => {
  it('POSTs the enable JSON and returns the new brand + visibility on 200', async () => {
    let url = ''; let init: RequestInit | undefined;
    const fetchImpl = (async (u: string, i: RequestInit) => {
      url = u; init = i;
      return resLike(true, 200, { ok: true, whiteLabel: { brandName: 'Acme', logoPath: null }, listed: false, indexable: false });
    }) as unknown as typeof fetch;
    const r = await saveWhiteLabel('abc', { enabled: true, brandName: 'Acme' }, fetchImpl);
    expect(r).toEqual({ ok: true, whiteLabel: { brandName: 'Acme', logoPath: null }, listed: false, indexable: false });
    expect(url).toBe('/api/reports/abc/white-label');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(init?.body as string)).toEqual({ enabled: true, brandName: 'Acme' });
  });

  it('maps the gate failures (402/403/409/503)', async () => {
    expect(await saveWhiteLabel('x', { enabled: false }, (async () => resLike(false, 402)) as unknown as typeof fetch)).toEqual({ ok: false, error: 'pro_required' });
    expect(await saveWhiteLabel('x', { enabled: false }, (async () => resLike(false, 403)) as unknown as typeof fetch)).toEqual({ ok: false, error: 'verification_required' });
    expect(await saveWhiteLabel('x', { enabled: false }, (async () => resLike(false, 409)) as unknown as typeof fetch)).toEqual({ ok: false, error: 'not_claimed' });
    expect(await saveWhiteLabel('x', { enabled: false }, (async () => resLike(false, 503)) as unknown as typeof fetch)).toEqual({ ok: false, error: 'unavailable' });
    expect(await saveWhiteLabel('x', { enabled: false }, (async () => resLike(false, 429)) as unknown as typeof fetch)).toEqual({ ok: false, error: 'rate_limited' });
  });

  it('fails closed on a network error', async () => {
    expect(await saveWhiteLabel('x', { enabled: false }, (async () => { throw new Error('net'); }) as unknown as typeof fetch)).toEqual({ ok: false, error: 'network' });
  });
});
