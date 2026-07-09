import { describe, it, expect } from 'vitest';
import { fetchOwnership } from './report-owner-probe';

const resLike = (body: unknown, ok = true) => ({ ok, json: () => Promise.resolve(body) }) as unknown as Response;

// SPEC 04.1 R2 — the probe response is the ONLY thing the client trusts for control state. The fetch
// helper normalizes the owner payload and FAILS CLOSED to {owned:false} on any non-200 / parse / network
// error, so a transient failure can never render owner controls to a non-owner.
describe('fetchOwnership', () => {
  it('normalizes an owner payload (coerces booleans, defaults whiteLabel to null)', async () => {
    const fetchImpl = (async () =>
      resLike({ owned: true, claimed: true, canWhiteLabel: true, listed: false, indexable: true, whiteLabel: { brandName: 'Acme', logoPath: null } })) as unknown as typeof fetch;
    expect(await fetchOwnership('s', fetchImpl)).toEqual({
      owned: true, claimed: true, canWhiteLabel: true, listed: false, indexable: true, whiteLabel: { brandName: 'Acme', logoPath: null },
    });
  });

  it('returns {owned:false} for the anon/non-owner payload', async () => {
    const fetchImpl = (async () => resLike({ owned: false })) as unknown as typeof fetch;
    expect(await fetchOwnership('s', fetchImpl)).toEqual({ owned: false });
  });

  it('fails closed to {owned:false} on a non-200 response', async () => {
    const fetchImpl = (async () => resLike({ owned: true, canWhiteLabel: true }, false)) as unknown as typeof fetch;
    expect(await fetchOwnership('s', fetchImpl)).toEqual({ owned: false });
  });

  it('fails closed to {owned:false} on a network/parse error', async () => {
    const throwing = (async () => { throw new Error('network'); }) as unknown as typeof fetch;
    expect(await fetchOwnership('s', throwing)).toEqual({ owned: false });
  });

  it('percent-encodes the slug into the probe URL (i18n-safe)', async () => {
    let calledUrl = '';
    const fetchImpl = (async (url: string) => { calledUrl = url; return resLike({ owned: false }); }) as unknown as typeof fetch;
    await fetchOwnership('career-এক', fetchImpl);
    expect(calledUrl).toBe('/api/reports/career-%E0%A6%8F%E0%A6%95/mine');
  });
});
