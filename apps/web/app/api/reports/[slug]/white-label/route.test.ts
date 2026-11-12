import { describe, it, expect, vi, beforeEach } from 'vitest';

// SPEC 04 §5 (V9) — white-label toggle. A CLAIMED report owned by a PAID (Pro/agency) user swaps the
// Crawlmouse wordmark for the owner's own brand. Gated SERVER-SIDE on EVERY write: authed + paid
// (the REAL entitlementFor(...).canWhiteLabel — ties this route to the D1 flip) + domain-verified
// ownership + a claimed report. Enabling DEFAULTS the report to unlisted+noindex (client deliverable,
// §5). Service-role write; deploy-order-safe (PGRST204/42703 → 503). Snapshot columns are never
// touched. The admin mock RECORDS the update chain so the gate predicates AND the write payload are
// value-pinned — a same-arity column swap must fail here, not slip through.

const FUTURE = new Date(Date.now() + 86_400_000).toISOString();
const PAST = new Date(Date.now() - 86_400_000).toISOString();

let user: { id: string } | null = { id: 'u-1' };
let rlAllowed = true;
let proUntil: string | null = FUTURE;
let reportRow: Record<string, unknown> | null = null;
let owns = true;
let updateResult: { data: unknown; error: unknown } = { data: { slug: 'slug-xyz', white_label: null, listed: false, indexable: false }, error: null };

const rlCalls: string[] = [];
const updateMock = vi.fn();
const purgeMock = vi.fn();
const revalidateMock = vi.fn();
const fromTables: string[] = [];
type Filter = [string, ...unknown[]];
const updateFilters: Filter[] = [];

vi.mock('@/lib/supabase/server', () => ({
  supabaseServer: () => Promise.resolve({ auth: { getUser: () => Promise.resolve({ data: { user } }) } }),
}));
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: (key: string) => { rlCalls.push(key); return Promise.resolve({ allowed: rlAllowed, remaining: 0, resetAt: new Date() }); },
}));
vi.mock('@/lib/reports', () => ({
  readReportRow: () => Promise.resolve(reportRow),
  purgePublicReport: (s: string) => purgeMock(s),
}));
vi.mock('@/lib/report-ownership', () => ({
  isDomainVerifiedForUser: () => Promise.resolve(owns),
}));
vi.mock('next/cache', () => ({ revalidatePath: (p: string) => revalidateMock(p) }));
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: (table: string) => {
      fromTables.push(table);
      if (table === 'users') {
        // The Pro-gate read: users.select('pro_until').eq('id', user.id).maybeSingle()
        return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: { pro_until: proUntil }, error: null }) }) }) };
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const chain: any = {
        update: (payload: unknown) => { updateMock(payload); return chain; },
        eq: (...a: unknown[]) => { updateFilters.push(['eq', ...a]); return chain; },
        not: (...a: unknown[]) => { updateFilters.push(['not', ...a]); return chain; },
        select: (...a: unknown[]) => { updateFilters.push(['select', ...a]); return chain; },
        maybeSingle: () => Promise.resolve(updateResult),
      };
      return chain;
    },
  }),
}));

import { POST } from './route';

const SLUG = 'slug-xyz';
const call = (body: unknown, slug = SLUG) =>
  POST(new Request(`http://localhost/api/reports/${slug}/white-label`, { method: 'POST', body: JSON.stringify(body) }), { params: Promise.resolve({ slug }) });

beforeEach(() => {
  user = { id: 'u-1' };
  rlAllowed = true;
  proUntil = FUTURE;
  reportRow = { domain: 'ex.com', grade: 'C', hidden_at: null, takedown_requested_at: null, claimed_at: '2026-01-01T00:00:00Z' };
  owns = true;
  updateResult = { data: { slug: SLUG, white_label: { brandName: 'Acme', logoPath: null }, listed: false, indexable: false }, error: null };
  rlCalls.length = 0; fromTables.length = 0; updateFilters.length = 0;
  updateMock.mockClear(); purgeMock.mockClear(); revalidateMock.mockClear();
});

describe('POST /api/reports/[slug]/white-label (§5, V9)', () => {
  it('401 when unauthenticated', async () => {
    user = null;
    expect((await call({ enabled: true, brandName: 'Acme' })).status).toBe(401);
    expect(updateMock).not.toHaveBeenCalled();
  });

  it('400 on an invalid body (missing brandName when enabling; empty; >60; no discriminator)', async () => {
    expect((await call({ enabled: true })).status).toBe(400);
    expect((await call({ enabled: true, brandName: '   ' })).status).toBe(400); // empty after trim
    expect((await call({ enabled: true, brandName: 'x'.repeat(61) })).status).toBe(400);
    expect((await call({})).status).toBe(400);
    expect(updateMock).not.toHaveBeenCalled();
  });

  it('402 when the caller is not a paying (Pro) user — no write (ties to the canWhiteLabel flip)', async () => {
    proUntil = PAST; // expired → free → canWhiteLabel false
    const res = await call({ enabled: true, brandName: 'Acme' });
    expect(res.status).toBe(402);
    expect(updateMock).not.toHaveBeenCalled();
    proUntil = null; // no pro_until → free
    expect((await call({ enabled: true, brandName: 'Acme' })).status).toBe(402);
  });

  it('404 when the report is missing or gone (hidden/takedown)', async () => {
    reportRow = null;
    expect((await call({ enabled: true, brandName: 'Acme' })).status).toBe(404);
    reportRow = { domain: 'ex.com', grade: 'C', hidden_at: '2026-07-08T00:00:00Z', takedown_requested_at: null, claimed_at: 'x' };
    expect((await call({ enabled: true, brandName: 'Acme' })).status).toBe(404);
    expect(updateMock).not.toHaveBeenCalled();
  });

  it('403 when the caller has not verified the report domain — no write', async () => {
    owns = false;
    expect((await call({ enabled: true, brandName: 'Acme' })).status).toBe(403);
    expect(updateMock).not.toHaveBeenCalled();
  });

  it('400 when logoPath is not scoped to this report (cross-report / traversal / encoded / extra-slash)', async () => {
    for (const logoPath of [
      'other-slug/logo.png', // cross-report
      '../secrets/x.png', // literal traversal
      `${SLUG}/%2e%2e/x.png`, // URL-encoded traversal (a bare `..` check would miss this)
      `${SLUG}/..\\x.png`, // backslash traversal
      `${SLUG}/a/b.png`, // extra path segment
      `${SLUG}/`, // empty filename
    ]) {
      expect((await call({ enabled: true, brandName: 'Acme', logoPath })).status).toBe(400);
    }
    expect(updateMock).not.toHaveBeenCalled();
  });

  it('409 when the report is not yet claimed (guarded update matched 0 rows), gated on claimed_at', async () => {
    updateResult = { data: null, error: null };
    const res = await call({ enabled: true, brandName: 'Acme' });
    expect(res.status).toBe(409);
    // the "only a claimed report can be white-labeled" predicate is value-pinned
    expect(updateFilters).toContainEqual(['not', 'claimed_at', 'is', null]);
  });

  it('200 enable (text-only): writes white_label + DEFAULTS listed/indexable false (§5); purges + revalidates sitemap', async () => {
    const res = await call({ enabled: true, brandName: '  Acme Agency  ' }); // trimmed at the boundary
    expect(res.status).toBe(200);
    const payload = updateMock.mock.calls[0]![0] as Record<string, unknown>;
    // white-label defaults the report to unlisted + noindex (client deliverable, §5); snapshot untouched
    expect(payload).toEqual({ white_label: { brandName: 'Acme Agency', logoPath: null }, listed: false, indexable: false });
    expect(updateFilters).toContainEqual(['eq', 'slug', SLUG]);
    expect(updateFilters).toContainEqual(['not', 'claimed_at', 'is', null]);
    expect(purgeMock).toHaveBeenCalledWith(SLUG);
    expect(revalidateMock).toHaveBeenCalledWith('/sitemap.xml');
    expect(await res.json()).toMatchObject({ ok: true });
  });

  it('200 enable with a slug-scoped logo path', async () => {
    const res = await call({ enabled: true, brandName: 'Acme', logoPath: `${SLUG}/logo.png` });
    expect(res.status).toBe(200);
    expect(updateMock.mock.calls[0]![0]).toEqual({ white_label: { brandName: 'Acme', logoPath: `${SLUG}/logo.png` }, listed: false, indexable: false });
  });

  it('200 re-enable (already white-labeled: a brand/logo EDIT) preserves listed/indexable — no visibility reset', async () => {
    // The report is ALREADY white-labeled (and the owner may have deliberately re-listed it). Editing
    // the brand must NOT silently force it back to unlisted+noindex — the §5 default is the OFF→ON
    // transition only.
    reportRow = { domain: 'ex.com', grade: 'C', hidden_at: null, takedown_requested_at: null, claimed_at: '2026-01-01T00:00:00Z', white_label: { brandName: 'Old Brand', logoPath: null } };
    const res = await call({ enabled: true, brandName: 'New Brand' });
    expect(res.status).toBe(200);
    expect(updateMock.mock.calls[0]![0]).toEqual({ white_label: { brandName: 'New Brand', logoPath: null } }); // listed/indexable untouched
  });

  it('200 disable: clears white_label (null) WITHOUT touching listed/indexable', async () => {
    updateResult = { data: { slug: SLUG, white_label: null, listed: true, indexable: true }, error: null };
    const res = await call({ enabled: false });
    expect(res.status).toBe(200);
    expect(updateMock.mock.calls[0]![0]).toEqual({ white_label: null });
  });

  it('503 deploy-order fail-soft on an undefined-column error (PGRST204 AND 42703)', async () => {
    updateResult = { data: null, error: { code: 'PGRST204', message: "Could not find the 'white_label' column of 'public_reports' in the schema cache" } };
    expect((await call({ enabled: true, brandName: 'Acme' })).status).toBe(503);
    updateResult = { data: null, error: { code: '42703' } };
    expect((await call({ enabled: true, brandName: 'Acme' })).status).toBe(503);
  });

  it('500 on a transient write error', async () => {
    updateResult = { data: null, error: { code: 'XX000', message: 'boom' } };
    expect((await call({ enabled: true, brandName: 'Acme' })).status).toBe(500);
  });

  it('429 when the per-user rate cap is exhausted', async () => {
    rlAllowed = false;
    const res = await call({ enabled: true, brandName: 'Acme' });
    expect(res.status).toBe(429);
    expect(rlCalls.some((k) => k.startsWith('report-white-label:'))).toBe(true);
    expect(updateMock).not.toHaveBeenCalled();
  });
});
