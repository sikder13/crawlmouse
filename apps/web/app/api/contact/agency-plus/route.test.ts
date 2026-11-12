/**
 * POST /api/contact/agency-plus (CC-29 D2): validation, the per-IP limit, Turnstile and the event,
 * through the handler with its dependencies injected; then the route's own wiring, with the modules
 * it calls replaced.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { contactAgencyPlus, type ContactDeps } from './_lib/contact';

const ID = 'c0000000-0000-4000-8000-000000000001';

function deps(over: Partial<ContactDeps> = {}) {
  const calls = {
    rateLimit: [] as [string][],
    verify: [] as [string, string | undefined][],
    insert: [] as unknown[],
    send: [] as unknown[],
  };
  const d: ContactDeps = {
    ip: '203.0.113.7',
    rateLimit: async (...args) => {
      calls.rateLimit.push(args);
      return { allowed: true };
    },
    turnstileEnforced: true,
    verifyTurnstile: async (...args) => {
      calls.verify.push(args);
      return args[0] === 'good-token';
    },
    insert: async (row) => {
      calls.insert.push(row);
      return ID;
    },
    send: async (event) => {
      calls.send.push(event);
    },
    ...over,
  };
  return { d, calls };
}

const request = (body: unknown, raw?: string) =>
  new Request('https://crawlmouse.com/api/contact/agency-plus', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: raw ?? JSON.stringify(body),
  });

const GOOD = { email: 'ops@summit.agency', sites: 60, note: 'SSO?', turnstileToken: 'good-token' };

describe('contactAgencyPlus', () => {
  it('stores the request and names the row, never the address, in the event', async () => {
    const { d, calls } = deps();
    const res = await contactAgencyPlus(GOOD, d);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(calls.insert).toEqual([{ email: 'ops@summit.agency', sites: 60, note: 'SSO?' }]);
    expect(calls.send).toEqual([
      {
        id: `email.requested:agency_plus_contact:${ID}`,
        name: 'email.requested',
        data: { template: 'agency_plus_contact', contactId: ID },
      },
    ]);
    expect(JSON.stringify(calls.send)).not.toContain('summit.agency');
  });

  it('an empty note is stored as none', async () => {
    const { d, calls } = deps();
    await contactAgencyPlus({ ...GOOD, note: '   ' }, d);
    expect(calls.insert).toEqual([{ email: 'ops@summit.agency', sites: 60, note: null }]);
  });

  it.each([
    ['no email', { ...GOOD, email: undefined }],
    ['not an email', { ...GOOD, email: 'not-an-email' }],
    ['a long email', { ...GOOD, email: `${'a'.repeat(320)}@x.co` }],
    ['no sites', { ...GOOD, sites: undefined }],
    ['sites as text', { ...GOOD, sites: '60' }],
    ['zero sites', { ...GOOD, sites: 0 }],
    ['fractional sites', { ...GOOD, sites: 1.5 }],
    ['too many sites', { ...GOOD, sites: 100_001 }],
    ['a long note', { ...GOOD, note: 'x'.repeat(2001) }],
    ['an unknown field', { ...GOOD, admin: true }],
    ['an array', [GOOD]],
  ])('refuses %s with 400 and stores nothing', async (_n, body) => {
    const { d, calls } = deps();
    const res = await contactAgencyPlus(body, d);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid' });
    expect(calls.insert).toEqual([]);
    expect(calls.send).toEqual([]);
  });

  it('refuses a body that was not JSON', async () => {
    const { d, calls } = deps();
    expect((await contactAgencyPlus(null, d)).status).toBe(400);
    expect(calls.insert).toEqual([]);
  });

  it('counts each address in a daily bucket and refuses past it with 429', async () => {
    const { d, calls } = deps({ rateLimit: async () => ({ allowed: false }) });
    const res = await contactAgencyPlus(GOOD, d);
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: 'rate_limited' });
    expect(calls.verify).toEqual([]);
    expect(calls.insert).toEqual([]);

    const ok = deps();
    await contactAgencyPlus(GOOD, ok.d);
    expect(ok.calls.rateLimit).toEqual([['contact:ip:203.0.113.7']]);
  });

  it('with no client address, no per-IP bucket is counted', async () => {
    const { d, calls } = deps({ ip: 'unknown' });
    expect((await contactAgencyPlus(GOOD, d)).status).toBe(200);
    expect(calls.rateLimit).toEqual([]);
    expect(calls.verify).toEqual([['good-token', undefined]]);
  });

  it.each([
    ['no token', { ...GOOD, turnstileToken: undefined }],
    ['a failing token', { ...GOOD, turnstileToken: 'bad-token' }],
  ])('Turnstile enforced: %s is refused with 400 and nothing stored', async (_n, body) => {
    const { d, calls } = deps();
    const res = await contactAgencyPlus(body, d);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'captcha_failed' });
    expect(calls.insert).toEqual([]);
    expect(calls.send).toEqual([]);
  });

  it('a passing token is verified with the client address', async () => {
    const { d, calls } = deps();
    await contactAgencyPlus(GOOD, d);
    expect(calls.verify).toEqual([['good-token', '203.0.113.7']]);
  });

  it('Turnstile not enforced: no token is asked for', async () => {
    const { d, calls } = deps({ turnstileEnforced: false });
    const res = await contactAgencyPlus({ ...GOOD, turnstileToken: undefined }, d);
    expect(res.status).toBe(200);
    expect(calls.verify).toEqual([]);
  });
});

// ─── the route's wiring ──────────────────────────────────────────────────────────────────────────

const r = vi.hoisted(() => ({
  inserted: [] as unknown[],
  sent: [] as unknown[],
  buckets: [] as string[],
}));

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: (table: string) => ({
      insert: (row: unknown) => {
        r.inserted.push([table, row]);
        return { select: () => ({ single: async () => ({ data: { id: ID }, error: null }) }) };
      },
    }),
  }),
}));
vi.mock('@/lib/inngest', () => ({
  inngest: { send: async (e: unknown) => r.sent.push(e) },
}));
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: async (key: string) => {
    r.buckets.push(key);
    return { allowed: true };
  },
}));
vi.mock('@/lib/turnstile', () => ({
  verifyTurnstileToken: async (token: string) => token === 'good-token',
}));

describe('POST /api/contact/agency-plus', () => {
  beforeEach(() => {
    r.inserted = [];
    r.sent = [];
    r.buckets = [];
  });
  afterEach(() => vi.unstubAllEnvs());

  it('is a 404 with V2_BILLING unset', async () => {
    vi.stubEnv('V2_BILLING', '');
    const { POST } = await import('./route');
    expect((await POST(request(GOOD))).status).toBe(404);
    expect(r.inserted).toEqual([]);
    expect(r.buckets).toEqual([]);
  });

  it('a body that is not JSON is a 400', async () => {
    vi.stubEnv('V2_BILLING', '1');
    const { POST } = await import('./route');
    expect((await POST(request(null, 'email=a'))).status).toBe(400);
    expect(r.inserted).toEqual([]);
  });

  it('with the flag on, stores the row in contact_requests and sends the event', async () => {
    vi.stubEnv('V2_BILLING', '1');
    vi.stubEnv('TURNSTILE_SECRET_KEY', 'set');
    const { POST } = await import('./route');
    const req = new Request('https://crawlmouse.com/api/contact/agency-plus', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': '198.51.100.4' },
      body: JSON.stringify(GOOD),
    });
    expect((await POST(req)).status).toBe(200);
    expect(r.inserted).toEqual([
      ['contact_requests', { email: 'ops@summit.agency', sites: 60, note: 'SSO?' }],
    ]);
    expect(r.sent).toEqual([
      {
        id: `email.requested:agency_plus_contact:${ID}`,
        name: 'email.requested',
        data: { template: 'agency_plus_contact', contactId: ID },
      },
    ]);
  });
});
