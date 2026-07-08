import { describe, it, expect, vi } from 'vitest';
import { mintReport } from './mint-share';

// SPEC 04 §6 (V11) — one-step mint at the grade reveal. The share affordance mints the audit into a
// PUBLIC report and returns its slug, so the shared link is the /r/ URL (built by reportShareUrl), never
// the private capability URL. Injectable fetch + track (house pattern) → fully unit-tested. Fires
// `report_minted` on success only.

describe('mintReport', () => {
  it('POSTs the auditId to the mint route and returns the slug + fires report_minted', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ slug: 'rep-xyz' }), { status: 200 }));
    const trackImpl = vi.fn();
    const result = await mintReport('aud-1', fetchImpl as unknown as typeof fetch, trackImpl);
    expect(result).toEqual({ ok: true, slug: 'rep-xyz' });
    expect(fetchImpl).toHaveBeenCalledWith('/api/reports/mint', expect.objectContaining({ method: 'POST' }));
    expect(JSON.parse((fetchImpl.mock.calls[0] as unknown as [string, { body: string }])[1].body)).toEqual({ auditId: 'aud-1' });
    expect(trackImpl).toHaveBeenCalledWith('report_minted', { slug: 'rep-xyz' });
  });

  it('returns the error (no slug) and fires NO event on a rejection', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ error: 'captcha_required' }), { status: 429 }));
    const trackImpl = vi.fn();
    const result = await mintReport('aud-1', fetchImpl as unknown as typeof fetch, trackImpl);
    expect(result).toEqual({ ok: false, error: 'captcha_required' });
    expect(trackImpl).not.toHaveBeenCalled();
  });

  it('returns error on a network failure without throwing', async () => {
    const fetchImpl = vi.fn(async () => { throw new Error('offline'); });
    await expect(mintReport('aud-1', fetchImpl as unknown as typeof fetch, vi.fn())).resolves.toEqual({ ok: false, error: 'mint_failed' });
  });
});
