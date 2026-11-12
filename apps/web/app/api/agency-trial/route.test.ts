/**
 * POST /api/agency-trial (CC-29 D3). The handler with its dependencies injected: a new account opens
 * Checkout; an account whose Checkout is still open gets that URL and no second session; a used
 * trial is a 409; a private host is a 400 (with the engine's real SSRF guard); the body is strict.
 * Then the route itself, with the modules it calls replaced: 401 without a session, 404 with the flag
 * off, both before the service-role client is made.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BillingResult } from '@/lib/billing/checkout-v2';
import { admittedHost } from '@/lib/v2/account/sites';
import {
  CHECKOUT_REUSE_MS,
  startAgencyTrial,
  type AgencyTrialDeps,
  type StartedAccount,
} from './_lib/start';

const USER = { id: 'u0000000-0000-4000-8000-000000000001', email: 'me@summit.agency' };
const ACCOUNT = 'a0000000-0000-4000-8000-00000000000b';
const SITE = 's0000000-0000-4000-8000-00000000000c';
const NOW = new Date('2026-11-12T12:00:00Z');
const URL_NEW = 'https://checkout.stripe.com/c/pay/cs_new';
const URL_OPEN = 'https://checkout.stripe.com/c/pay/cs_open';

/** A guard that admits any public-looking host without DNS; private ranges use the real guard below. */
const publicGuard = async () => undefined;

function harness(over: Partial<AgencyTrialDeps> = {}, started?: StartedAccount) {
  const calls = {
    rateLimit: [] as unknown[][],
    startAccount: [] as unknown[][],
    checkout: [] as unknown[],
    stored: [] as unknown[][],
    events: [] as unknown[][],
  };
  const deps: AgencyTrialDeps = {
    rateLimit: async (...args) => {
      calls.rateLimit.push(args);
      return { allowed: true };
    },
    admit: (site) => admittedHost(site, publicGuard),
    startAccount: async (...args) => {
      calls.startAccount.push(args);
      return started ?? { outcome: 'created', accountId: ACCOUNT, siteId: SITE };
    },
    openCheckout: async () => null,
    storeCheckout: async (...args) => {
      calls.stored.push(args);
    },
    checkout: async (input): Promise<BillingResult> => {
      calls.checkout.push(input);
      return { ok: true, url: URL_NEW };
    },
    capture: async (...args) => {
      calls.events.push(args);
    },
    defer: (work) => void work(),
    now: () => NOW,
    ...over,
  };
  return { deps, calls };
}

const GOOD = {
  consent: true,
  agencyName: ' Summit Digital ',
  site: 'https://ClientSite.com/about',
  interval: 'month',
};

const json = (body: unknown) =>
  new Request('https://crawlmouse.com/api/agency-trial', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

const form = (fields: Record<string, string>) =>
  new Request('https://crawlmouse.com/api/agency-trial', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields).toString(),
  });

describe('startAgencyTrial', () => {
  it('created: the account with the admitted host, then Checkout, its URL stored, the events sent', async () => {
    const { deps, calls } = harness();
    const res = await startAgencyTrial(json(GOOD), USER, deps);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ url: URL_NEW });
    expect(calls.startAccount).toEqual([[USER.id, 'Summit Digital', 'clientsite.com']]);
    expect(calls.checkout).toEqual([{ accountId: ACCOUNT, email: USER.email, interval: 'month' }]);
    expect(calls.stored).toEqual([[ACCOUNT, URL_NEW, NOW]]);
    expect(calls.events).toEqual([
      ['plan_chosen', ACCOUNT, { plan: 'agency', interval: 'month' }],
      [
        'trial_started',
        ACCOUNT,
        { kind: 'agency', variant: 'card_required', stage: 'checkout_opened' },
      ],
    ]);
  });

  it('a form post is answered with a 303 to Checkout', async () => {
    const { deps } = harness();
    const res = await startAgencyTrial(
      form({ consent: 'true', agencyName: 'Summit', site: 'clientsite.com', interval: 'year' }),
      USER,
      deps,
    );
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe(URL_NEW);
  });

  it('existing with a Checkout still open: the same URL, and no second agencyTrial call', async () => {
    const { deps, calls } = harness(
      {
        openCheckout: async () => ({
          url: URL_OPEN,
          at: new Date(NOW.getTime() - CHECKOUT_REUSE_MS + 1000),
        }),
      },
      { outcome: 'existing', accountId: ACCOUNT, siteId: SITE },
    );
    const res = await startAgencyTrial(json(GOOD), USER, deps);
    expect(await res.json()).toEqual({ url: URL_OPEN });
    expect(calls.checkout).toEqual([]);
    expect(calls.stored).toEqual([]);
    expect(calls.events.map((e) => e[0])).toEqual(['plan_chosen']);
  });

  it('existing with a Checkout past its life: a new one', async () => {
    const { deps, calls } = harness(
      {
        openCheckout: async () => ({
          url: URL_OPEN,
          at: new Date(NOW.getTime() - CHECKOUT_REUSE_MS),
        }),
      },
      { outcome: 'existing', accountId: ACCOUNT, siteId: SITE },
    );
    expect(await (await startAgencyTrial(json(GOOD), USER, deps)).json()).toEqual({ url: URL_NEW });
    expect(calls.checkout).toHaveLength(1);
  });

  it('a stored Checkout is reused only while CC-03’s session can still be open', () => {
    // CC-03 sets each session to expire SESSION_LIFETIME_S (31 min) after it is created.
    expect(CHECKOUT_REUSE_MS).toBe(30 * 60 * 1000);
  });

  it('trial_used: 409 with the reason, and no Checkout', async () => {
    const { deps, calls } = harness({}, { outcome: 'trial_used' });
    const res = await startAgencyTrial(json(GOOD), USER, deps);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: 'trial_used',
      reason: 'the person has used their agency trial',
    });
    expect(calls.checkout).toEqual([]);
    expect(calls.events).toEqual([]);
  });

  it('a refusal from CC-03’s agencyTrial is passed on, and nothing is stored', async () => {
    const { deps, calls } = harness({
      checkout: async () => ({ ok: false, status: 503, error: 'billing_unavailable' }),
    });
    const res = await startAgencyTrial(json(GOOD), USER, deps);
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'billing_unavailable' });
    expect(calls.stored).toEqual([]);
    expect(calls.events.map((e) => e[0])).toEqual(['plan_chosen']);
  });

  it.each([
    '10.0.0.5',
    'http://127.0.0.1/',
    '192.168.1.20',
    '169.254.169.254',
    '[::1]',
    'localhost',
  ])(
    'a private or reserved address typed as the site (%s) is refused with 400 before any account',
    async (site) => {
      const { deps, calls } = harness({ admit: (s) => admittedHost(s) });
      const res = await startAgencyTrial(json({ ...GOOD, site }), USER, deps);
      expect(res.status).toBe(400);
      expect((await res.json()).error).toMatch(/^(invalid_host|host_refused)$/);
      expect(calls.startAccount).toEqual([]);
    },
  );

  it.each([['10.0.0.5'], ['192.168.1.20'], ['169.254.169.254'], ['127.0.0.1'], ['fd00::1']])(
    'a public-looking host that resolves to %s is host_refused by the engine’s guard, before any account',
    async (address) => {
      const { validateUrlOrThrow } = await import('@crawlmouse/engine');
      const guard = (url: string) => validateUrlOrThrow(url, { resolver: async () => [address] });
      const { deps, calls } = harness({ admit: (s) => admittedHost(s, guard) });
      const res = await startAgencyTrial(
        json({ ...GOOD, site: 'intranet.clientsite.com' }),
        USER,
        deps,
      );
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: 'host_refused' });
      expect(calls.startAccount).toEqual([]);
    },
  );

  it('the same guard admits the host when it resolves to a public address', async () => {
    const { validateUrlOrThrow } = await import('@crawlmouse/engine');
    const guard = (url: string) =>
      validateUrlOrThrow(url, { resolver: async () => ['93.184.215.14'] });
    const { deps, calls } = harness({ admit: (s) => admittedHost(s, guard) });
    expect(
      (await startAgencyTrial(json({ ...GOOD, site: 'intranet.clientsite.com' }), USER, deps))
        .status,
    ).toBe(200);
    expect(calls.startAccount).toEqual([[USER.id, 'Summit Digital', 'intranet.clientsite.com']]);
  });

  it.each([
    ['consent false', { ...GOOD, consent: false }],
    ['consent as a string in JSON', { ...GOOD, consent: 'true' }],
    ['no consent', { ...GOOD, consent: undefined }],
    ['no agency name', { ...GOOD, agencyName: '   ' }],
    ['a long agency name', { ...GOOD, agencyName: 'x'.repeat(121) }],
    ['no site', { ...GOOD, site: undefined }],
    ['an unknown interval', { ...GOOD, interval: 'week' }],
    ['an unknown field', { ...GOOD, accountId: ACCOUNT }],
  ])('refuses %s with 400 before any limit, host or account', async (_n, body) => {
    const { deps, calls } = harness();
    const res = await startAgencyTrial(json(body), USER, deps);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid' });
    expect(calls.rateLimit).toEqual([]);
    expect(calls.startAccount).toEqual([]);
  });

  it('a form post with the consent box unticked is refused', async () => {
    const { deps, calls } = harness();
    const res = await startAgencyTrial(
      form({ agencyName: 'Summit', site: 'clientsite.com', interval: 'month' }),
      USER,
      deps,
    );
    expect(res.status).toBe(400);
    expect(calls.startAccount).toEqual([]);
  });

  it('counts each person in an hourly bucket and refuses past it with 429', async () => {
    const ok = harness();
    await startAgencyTrial(json(GOOD), USER, ok.deps);
    expect(ok.calls.rateLimit).toEqual([[`agency-trial:user:${USER.id}`]]);
    const { deps, calls } = harness({ rateLimit: async () => ({ allowed: false }) });
    const res = await startAgencyTrial(json(GOOD), USER, deps);
    expect(res.status).toBe(429);
    expect(calls.startAccount).toEqual([]);
  });
});

// ─── the route ───────────────────────────────────────────────────────────────────────────────────

const r = vi.hoisted(() => ({ user: null as { id: string; email: string } | null, admin: 0 }));

vi.mock('@/lib/supabase/server', () => ({
  supabaseServer: async () => ({ auth: { getUser: async () => ({ data: { user: r.user } }) } }),
}));
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => {
    r.admin += 1;
    return {};
  },
}));
vi.mock('next/server', () => ({ after: () => undefined }));
vi.mock('server-only', () => ({}));

describe('POST /api/agency-trial', () => {
  beforeEach(() => {
    r.user = null;
    r.admin = 0;
  });
  afterEach(() => vi.unstubAllEnvs());

  it('401 without a session, whatever the flag', async () => {
    vi.stubEnv('V2_BILLING', '1');
    const { POST } = await import('./route');
    const res = await POST(json(GOOD));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'auth_required' });
    expect(r.admin).toBe(0);
  });

  it('404 with V2_BILLING unset, before the service-role client', async () => {
    vi.stubEnv('V2_BILLING', '');
    r.user = USER;
    const { POST } = await import('./route');
    const res = await POST(json(GOOD));
    expect(res.status).toBe(404);
    expect(r.admin).toBe(0);
  });
});
