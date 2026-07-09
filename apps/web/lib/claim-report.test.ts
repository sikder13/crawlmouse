import { describe, it, expect } from 'vitest';
import { claimReport } from './claim-report';

const resLike = (ok: boolean, status = ok ? 200 : 400) =>
  ({ ok, status, json: () => Promise.resolve({}) }) as unknown as Response;

// SPEC 04.1 §2 — the injectable claim POST used by ClaimControl (mirrors mint-share). The real gate is
// server-side (auth → verified-owner); this just calls it and maps the outcomes so the UI can react.
describe('claimReport', () => {
  it('POSTs to the claim route and returns ok on 200', async () => {
    let url = ''; let method = '';
    const fetchImpl = (async (u: string, init: RequestInit) => { url = u; method = init.method as string; return resLike(true); }) as unknown as typeof fetch;
    expect(await claimReport('abc', fetchImpl)).toEqual({ ok: true });
    expect(url).toBe('/api/reports/abc/claim');
    expect(method).toBe('POST');
  });

  it('percent-encodes an i18n slug', async () => {
    let url = '';
    const fetchImpl = (async (u: string) => { url = u; return resLike(true); }) as unknown as typeof fetch;
    await claimReport('career-এক', fetchImpl);
    expect(url).toBe('/api/reports/career-%E0%A6%8F%E0%A6%95/claim');
  });

  it('maps 401 → auth_required and 403 → verification_required', async () => {
    expect(await claimReport('x', (async () => resLike(false, 401)) as unknown as typeof fetch)).toEqual({ ok: false, error: 'auth_required' });
    expect(await claimReport('x', (async () => resLike(false, 403)) as unknown as typeof fetch)).toEqual({ ok: false, error: 'verification_required' });
  });

  it('fails closed on a network error', async () => {
    const throwing = (async () => { throw new Error('net'); }) as unknown as typeof fetch;
    expect(await claimReport('x', throwing)).toEqual({ ok: false, error: 'network' });
  });
});
