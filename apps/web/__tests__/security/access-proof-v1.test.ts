/**
 * Proofs for the access matrix's v1 rows whose gate no other test removes (CC-37 D1): each case
 * runs the route or page's own export against a small in-memory stand-in for the two Supabase
 * clients, and fails when the row's check is taken out of the code. The stand-in applies the
 * filters a query asks for, so a query that drops its `user_id` filter reads another person's row.
 */
import Stripe from 'stripe';
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Row = Record<string, unknown>;
interface Query {
  table: string;
  op: 'select' | 'insert' | 'upsert' | 'update';
  filters: Array<[column: string, value: unknown]>;
  payload?: Row;
}

/** A Supabase client over `tables` that records each query in `log`. */
function fakeClient(
  tables: Record<string, Row[]>,
  log: Query[],
  user: { id: string } | null = null,
) {
  const from = (table: string) => {
    const q: Query = { table, op: 'select', filters: [] };
    log.push(q);
    const rows = () =>
      (tables[table] ?? []).filter((r) =>
        q.filters.every(([c, v]) => (Array.isArray(v) ? v.includes(r[c]) : (r[c] ?? null) === v)),
      );
    const done = () => {
      if (q.op === 'select') return { data: rows(), error: null };
      if (q.op === 'update') return { data: null, error: null };
      return { data: { id: 'new-row', ...q.payload }, error: null };
    };
    const b = {
      select: () => b,
      eq: (c: string, v: unknown) => (q.filters.push([c, v]), b),
      is: (c: string, v: unknown) => (q.filters.push([c, v]), b),
      in: (c: string, v: unknown[]) => (q.filters.push([c, v]), b),
      order: () => b,
      limit: () => b,
      insert: (p: Row) => ((q.op = 'insert'), (q.payload = p), b),
      upsert: (p: Row) => ((q.op = 'upsert'), (q.payload = p), b),
      update: (p: Row) => ((q.op = 'update'), (q.payload = p), b),
      maybeSingle: async () => {
        const r = done();
        return { data: Array.isArray(r.data) ? (r.data[0] ?? null) : r.data, error: null };
      },
      single: async () => {
        const r = done();
        return { data: Array.isArray(r.data) ? (r.data[0] ?? null) : r.data, error: null };
      },
      then: (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) =>
        Promise.resolve(done()).then(ok, bad),
    };
    return b;
  };
  return { from, auth: { getUser: async () => ({ data: { user } }) } };
}

const h = vi.hoisted(() => ({
  tables: {} as Record<string, Record<string, unknown>[]>,
  user: null as { id: string } | null,
  /** Queries through the session client. */
  session: [] as Query[],
  /** Queries through the service-role client. */
  admin: [] as Query[],
  admins: 0,
  fetched: [] as string[],
  dnsChecked: 0,
  portal: [] as string[],
  applied: [] as string[],
  dashboard: [] as unknown[][],
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({
  supabaseServer: async () => fakeClient(h.tables, h.session, h.user),
}));
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => {
    h.admins += 1;
    return fakeClient(h.tables, h.admin);
  },
}));
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: async () => ({ allowed: true, remaining: 1, resetAt: new Date(0) }),
}));
vi.mock('@/lib/supabase/fetch-all', () => ({
  fetchAll: async (_c: unknown, table: string) => (h.fetched.push(table), []),
}));
vi.mock('@/lib/verification', () => ({
  checkDnsTxtRecord: async () => ((h.dnsChecked += 1), false),
  checkMetaTag: async () => ((h.dnsChecked += 1), false),
}));
vi.mock('@/lib/stripe', async () => {
  const { default: StripeSdk } = await import('stripe');
  const real = new StripeSdk(['sk', 'test', 'proof'].join('_'));
  return {
    stripe: {
      webhooks: real.webhooks,
      billingPortal: {
        sessions: {
          create: async ({ customer }: { customer: string }) => (
            h.portal.push(customer),
            { url: `https://billing.stripe.example/${customer}` }
          ),
        },
      },
    },
  };
});
vi.mock('@/lib/billing/apply-stripe-event', () => ({
  applyStripeEvent: async (_db: unknown, event: { id: string }) => {
    h.applied.push(event.id);
  },
}));
vi.mock('@sentry/nextjs', () => ({ captureMessage: () => undefined }));
vi.mock('@/lib/dashboard', () => ({
  loadDashboardSites: async (...args: unknown[]) => (h.dashboard.push(['sites', ...args]), []),
}));
vi.mock('@/lib/dashboard-report-settings', () => ({
  loadReportSettingsForSites: async (...args: unknown[]) => (
    h.dashboard.push(['settings', ...args.slice(1)]),
    new Map()
  ),
}));
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw Object.assign(new Error('redirect'), { digest: `NEXT_REDIRECT;${to}` });
  },
  notFound: () => {
    throw Object.assign(new Error('not found'), { digest: 'NEXT_HTTP_ERROR_FALLBACK;404' });
  },
}));

import { GET as exportAudit } from '@/app/api/audits/[id]/export/route';
import { POST as verifyCheck } from '@/app/api/verify/check/[id]/route';
import { POST as verifyStart } from '@/app/api/verify/start/route';
import { GET as billing } from '@/app/billing/route';
import { POST as takedown } from '@/app/api/takedown/route';
import { POST as stripeWebhook } from '@/app/api/webhooks/stripe/route';
import DashboardPage from '@/app/dashboard/page';
import ComparePage from '@/app/compare/[a]/[b]/page';
import VerifyPage from '@/app/verify/[id]/page';

const ME = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const AUDIT = '33333333-3333-4333-8333-333333333333';
const VERIFICATION = '44444444-4444-4444-8444-444444444444';
const FAR = '2999-01-01T00:00:00.000Z';

const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  new Request(`https://crawlmouse.com${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
const params = <T>(p: T) => ({ params: Promise.resolve(p) });
const digestOf = (p: Promise<unknown>) =>
  p.then(
    () => 'rendered',
    (e: { digest?: string }) => e.digest ?? Promise.reject(e),
  );

beforeEach(() => {
  h.tables = {};
  h.user = null;
  h.session.length = 0;
  h.admin.length = 0;
  h.admins = 0;
  h.fetched.length = 0;
  h.dnsChecked = 0;
  h.portal.length = 0;
  h.applied.length = 0;
  h.dashboard.length = 0;
  vi.unstubAllEnvs();
});

describe('api/audits/[id]/export', () => {
  beforeEach(() => {
    h.tables.users = [
      { id: ME, pro_until: FAR },
      { id: OTHER, pro_until: FAR },
    ];
  });

  it('export: another person’s audit is a 404, and its rows are not read', async () => {
    h.tables.audits = [{ id: AUDIT, user_id: OTHER, confidence: null }];
    h.user = { id: ME };
    const res = await exportAudit(new Request('https://crawlmouse.com/x'), params({ id: AUDIT }));
    expect(res.status).toBe(404);
    expect(h.fetched).toEqual([]);
  });

  it('export: the owner’s own audit is exported (the case above is refused for its owner alone)', async () => {
    h.tables.audits = [{ id: AUDIT, user_id: ME, confidence: null }];
    h.user = { id: ME };
    const res = await exportAudit(new Request('https://crawlmouse.com/x'), params({ id: AUDIT }));
    expect(res.status).toBe(200);
    expect(h.fetched).toEqual(['pages', 'findings']);
  });
});

describe('api/verify/check/[id] and the verify page', () => {
  beforeEach(() => {
    h.tables.domain_verifications = [
      {
        id: VERIFICATION,
        user_id: OTHER,
        domain: 'client.example',
        method: 'dns_txt',
        verification_token: ['cm', 'verify', 'other'].join('-'),
        verified_at: null,
      },
    ];
  });

  it('verify/check: another person’s verification is a 404, and nothing is fetched', async () => {
    h.user = { id: ME };
    const res = await verifyCheck(post('/api/verify/check/x', {}), params({ id: VERIFICATION }));
    expect(res.status).toBe(404);
    expect(h.dnsChecked).toBe(0);
  });

  it('verify/check: its owner’s check reaches the DNS lookup', async () => {
    h.user = { id: OTHER };
    const res = await verifyCheck(post('/api/verify/check/x', {}), params({ id: VERIFICATION }));
    expect(await res.json()).toEqual({ verified: false });
    expect(h.dnsChecked).toBe(1);
  });

  it('verify page: another person’s verification is a 404', async () => {
    h.user = { id: ME };
    const page = VerifyPage({
      params: Promise.resolve({ id: VERIFICATION }),
      searchParams: Promise.resolve({}),
    });
    expect(await digestOf(page)).toMatch(/404/);
    h.user = { id: OTHER };
    expect(
      await digestOf(
        VerifyPage({
          params: Promise.resolve({ id: VERIFICATION }),
          searchParams: Promise.resolve({}),
        }),
      ),
    ).toBe('rendered');
  });
});

describe('api/verify/start', () => {
  it('verify/start: reads and writes the verification keyed by the caller’s user id', async () => {
    const theirs = ['cm', 'verify', 'theirs'].join('-');
    h.tables.domain_verifications = [
      {
        id: VERIFICATION,
        user_id: OTHER,
        domain: 'client.example',
        verification_token: theirs,
        verified_at: FAR,
      },
    ];
    h.user = { id: ME };
    const res = await verifyStart(
      post('/api/verify/start', { domain: 'client.example', method: 'dns_txt' }),
    );
    const body = (await res.json()) as { token: string; verified: boolean };
    expect(body.verified).toBe(false);
    expect(body.token).not.toBe(theirs);
    const write = h.admin.find((q) => q.op === 'upsert');
    expect(write?.payload).toMatchObject({ user_id: ME, domain: 'client.example' });
  });
});

describe('billing', () => {
  it('billing: the portal opens for the customer on the caller’s own users row', async () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://crawlmouse.com');
    h.tables.users = [
      { id: OTHER, stripe_customer_id: 'cus_other' },
      { id: ME, stripe_customer_id: 'cus_mine' },
    ];
    h.user = { id: ME };
    const res = await billing(new Request('https://crawlmouse.com/billing'));
    expect(res.status).toBe(303);
    expect(h.portal).toEqual(['cus_mine']);
  });
});

describe('api/takedown', () => {
  const form = {
    domain: 'client.example',
    requesterEmail: ['owner', 'client.example'].join('@'),
    reason: 'This report is about my site and I want it removed.',
  };

  it('takedown: stores a request against the report and answers no report data', async () => {
    h.tables.public_reports = [
      { slug: 'client-example-x1', domain: 'client.example', takedown_requested_at: null },
    ];
    const res = await takedown(post('/api/takedown', form));
    expect(await res.json()).toEqual({ ok: true });
    const insert = h.admin.find((q) => q.op === 'insert');
    expect(insert).toMatchObject({
      table: 'takedown_requests',
      payload: { public_report_slug: 'client-example-x1' },
    });
  });

  it('takedown: a domain with no report is a 404, and nothing is stored', async () => {
    h.tables.public_reports = [
      { slug: 'elsewhere-x1', domain: 'elsewhere.example', takedown_requested_at: null },
    ];
    const res = await takedown(post('/api/takedown', form));
    expect(res.status).toBe(404);
    expect(h.admin.some((q) => q.op === 'insert')).toBe(false);
  });
});

describe('api/webhooks/stripe', () => {
  const secret = ['whsec', 'proof', 'secret'].join('_');
  const payload = JSON.stringify({
    id: 'evt_proof',
    object: 'event',
    type: 'invoice.paid',
    data: { object: {} },
  });
  const signed = (s: string) =>
    new Stripe(['sk', 'test', 'proof'].join('_')).webhooks.generateTestHeaderString({
      payload,
      secret: s,
    });

  it('stripe webhook: a bad signature is 400, and no event is applied', async () => {
    vi.stubEnv('STRIPE_WEBHOOK_SECRET', secret);
    const other = ['whsec', 'not', 'ours'].join('_');
    const res = await stripeWebhook(
      post('/api/webhooks/stripe', payload, { 'stripe-signature': signed(other) }),
    );
    expect(res.status).toBe(400);
    expect(h.applied).toEqual([]);
    expect(h.admins).toBe(0);
  });

  it('stripe webhook: a signed event is applied once', async () => {
    vi.stubEnv('STRIPE_WEBHOOK_SECRET', secret);
    const res = await stripeWebhook(
      post('/api/webhooks/stripe', payload, { 'stripe-signature': signed(secret) }),
    );
    expect(res.status).toBe(200);
    expect(h.applied).toEqual(['evt_proof']);
  });
});

describe('the v1 dashboard and compare pages', () => {
  it('dashboard: reads the sites and report settings of the signed-in user alone', async () => {
    h.tables.users = [{ id: ME, pro_until: null }];
    h.user = { id: ME };
    expect(await digestOf(DashboardPage({ searchParams: Promise.resolve({}) }))).toBe('rendered');
    const settings = h.dashboard.find(([what]) => what === 'settings');
    expect(settings?.[1]).toBe(ME);
    h.user = null;
    h.dashboard.length = 0;
    expect(await digestOf(DashboardPage({ searchParams: Promise.resolve({}) }))).toMatch(/\/login/);
    expect(h.dashboard).toEqual([]);
  });

  it('compare: an id that is not a UUID is a 404 before any read', async () => {
    for (const [a, b] of [
      ['not-a-uuid', AUDIT],
      [AUDIT, AUDIT],
    ]) {
      expect(await digestOf(ComparePage({ params: Promise.resolve({ a: a!, b: b! }) }))).toMatch(
        /404/,
      );
    }
    expect(h.admins).toBe(0);
  });
});
