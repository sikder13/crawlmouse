/**
 * `report_minted {kind: 'v2'}` and the consent gate, as the mint route wires them (CC-29 review r1,
 * Tier B TB-B1). The route hands the request's `Cookie` header to `supabaseMintDeps`, whose
 * `reportMinted` sends through the real `captureServerEvent` to a stubbed fetch, so what reaches
 * PostHog is read where it leaves. `serverCaptureAllowed(null)` allows, so a route that dropped the
 * header would send for a visitor who declined: the declined cases below are the ones that catch it.
 * Only the service-role reads and the insert are stand-ins (the mint's own order is `mint.test.ts`'s).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fixture } from '@/lib/v2/fixtures';
import { buildPublicSnapshot } from '@/lib/v2/reports/build-snapshot';
import { FIRST_AUDIT } from '@/lib/v2/view/segment/test-helpers';

vi.mock('@/lib/client-ip', () => ({ getClientIp: () => '9.9.9.9' }));
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: async () => ({ allowed: true, remaining: 1, resetAt: new Date() }),
}));
// Turnstile is not reached (the cap allows); the module is `server-only`, which vitest cannot load.
vi.mock('@/lib/turnstile', () => ({ verifyTurnstileToken: async () => true }));
vi.mock('@/lib/supabase/server', () => ({
  supabaseServer: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'u-1' } } }) },
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: { site_id: 'site-1', status: 'finished' },
            error: null,
          }),
        }),
      }),
    }),
    rpc: async () => ({ data: true, error: null }),
  }),
}));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({}) }));
vi.mock('@/lib/v2/reports/mint-deps', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/v2/reports/mint-deps')>();
  const snapshot = buildPublicSnapshot(
    fixture('bad-site'),
    FIRST_AUDIT['bad-site'],
    '2026-11-12T18:00:00.000Z',
  );
  return {
    supabaseMintDeps: (...args: Parameters<typeof real.supabaseMintDeps>) => ({
      ...real.supabaseMintDeps(...args),
      slugForCheck: async () => null,
      snapshotOf: async () => ({ snapshot, accountId: 'acct-1' }),
      insert: async () => ({ error: null }),
    }),
  };
});

const { POST } = await import('./route');

const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
const mint = (cookie: string) =>
  POST(
    new Request('https://crawlmouse.com/api/reports/mint', {
      method: 'POST',
      headers: { cookie },
      body: JSON.stringify({ checkId: '123e4567-e89b-12d3-a456-426614174001' }),
    }),
  );
const sent = () =>
  (fetchMock.mock.calls as unknown as [string, RequestInit][]).map(([, init]) =>
    JSON.parse(String(init.body)),
  );

beforeEach(() => {
  vi.stubEnv('V2_CHECKS_PUBLIC', '1');
  vi.stubEnv('NEXT_PUBLIC_POSTHOG_KEY', 'phc_test');
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockClear();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('POST /api/reports/mint {checkId}: report_minted through the consent gate', () => {
  it('sends nothing when the visitor declined, or their region needs consent they have not given', async () => {
    for (const cookie of ['cm_consent=denied', 'cm_consent_required=1']) {
      const res = await mint(cookie);
      expect(res.status).toBe(200);
      expect((await res.json()).alreadyPublic).toBe(false);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends one report_minted {kind: v2}, keyed by the account, when the visitor granted', async () => {
    expect((await mint('cm_consent=granted')).status).toBe(200);
    expect(sent()).toHaveLength(1);
    expect(sent()[0]).toMatchObject({
      event: 'report_minted',
      distinct_id: 'account:acct-1',
      properties: { kind: 'v2' },
    });
  });
});
