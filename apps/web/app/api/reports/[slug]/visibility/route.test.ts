import { describe, it, expect, vi, beforeEach } from 'vitest';

// SPEC 04 §8 — owner visibility toggle. A claimed report's owner may opt out of listed/indexable. Same
// server-side ownership gate as claim (authed + domain-verified), re-checked on EVERY write (never
// client-asserted). Only listed/indexable are writable here; claimed_at/snapshot/white_label are not
// touched. Service-role write; deploy-order-safe (PGRST204/42703 → 503). Only a CLAIMED report can be
// toggled (409 otherwise).

let user: { id: string } | null = { id: 'u-1' };
let rlAllowed = true;
let reportRow: Record<string, unknown> | null = null;
let owns = true;
let updateResult: { data: unknown; error: unknown } = { data: { slug: 'slug-xyz', listed: false, indexable: false }, error: null };

const rlCalls: string[] = [];
const updateMock = vi.fn();
const purgeMock = vi.fn();
const revalidateMock = vi.fn();
const fromTables: string[] = [];

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
      return {
        update: (payload: unknown) => {
          updateMock(payload);
          return { eq: () => ({ not: () => ({ select: () => ({ maybeSingle: () => Promise.resolve(updateResult) }) }) }) };
        },
      };
    },
  }),
}));

import { POST } from './route';

const SLUG = 'slug-xyz';
const call = (body: unknown, slug = SLUG) =>
  POST(new Request(`http://localhost/api/reports/${slug}/visibility`, { method: 'POST', body: JSON.stringify(body) }), { params: Promise.resolve({ slug }) });

beforeEach(() => {
  user = { id: 'u-1' };
  rlAllowed = true;
  reportRow = { domain: 'ex.com', grade: 'C', hidden_at: null, takedown_requested_at: null, claimed_at: '2026-01-01T00:00:00Z' };
  owns = true;
  updateResult = { data: { slug: SLUG, listed: false, indexable: false }, error: null };
  rlCalls.length = 0; fromTables.length = 0;
  updateMock.mockClear(); purgeMock.mockClear(); revalidateMock.mockClear();
});

describe('POST /api/reports/[slug]/visibility (§8)', () => {
  it('401 when unauthenticated', async () => {
    user = null;
    expect((await call({ listed: false })).status).toBe(401);
    expect(updateMock).not.toHaveBeenCalled();
  });

  it('400 when neither listed nor indexable is provided (nothing to change)', async () => {
    expect((await call({})).status).toBe(400);
    expect(updateMock).not.toHaveBeenCalled();
  });

  it('400 for a non-boolean field', async () => {
    expect((await call({ listed: 'yes' })).status).toBe(400);
  });

  it('404 when the report is missing or gone', async () => {
    reportRow = null;
    expect((await call({ indexable: false })).status).toBe(404);
    reportRow = { domain: 'ex.com', grade: 'C', hidden_at: '2026-07-08T00:00:00Z', takedown_requested_at: null, claimed_at: '2026-01-01T00:00:00Z' };
    expect((await call({ indexable: false })).status).toBe(404);
    expect(updateMock).not.toHaveBeenCalled();
  });

  it('403 when the caller has not verified the report domain — no write', async () => {
    owns = false;
    expect((await call({ indexable: false })).status).toBe(403);
    expect(updateMock).not.toHaveBeenCalled();
  });

  it('409 when the report is not yet claimed (guarded update matched 0 rows)', async () => {
    updateResult = { data: null, error: null };
    const res = await call({ indexable: false });
    expect(res.status).toBe(409);
  });

  it('200 opt out of indexing: writes ONLY indexable (not listed / claimed_at), purges + revalidates sitemap', async () => {
    updateResult = { data: { slug: SLUG, listed: true, indexable: false }, error: null };
    const res = await call({ indexable: false });
    expect(res.status).toBe(200);
    const payload = updateMock.mock.calls[0]![0] as Record<string, unknown>;
    expect(payload).toEqual({ indexable: false }); // listed absent, claimed_at never touched
    expect(purgeMock).toHaveBeenCalledWith(SLUG);
    expect(revalidateMock).toHaveBeenCalledWith('/sitemap.xml');
    expect((await res.json())).toMatchObject({ ok: true, indexable: false });
  });

  it('200 opt out of listing: writes ONLY listed', async () => {
    updateResult = { data: { slug: SLUG, listed: false, indexable: true }, error: null };
    const res = await call({ listed: false });
    expect(res.status).toBe(200);
    expect(updateMock.mock.calls[0]![0]).toEqual({ listed: false });
  });

  it('200 set both at once', async () => {
    const res = await call({ listed: false, indexable: false });
    expect(res.status).toBe(200);
    expect(updateMock.mock.calls[0]![0]).toEqual({ listed: false, indexable: false });
  });

  it('503 deploy-order fail-soft on an undefined-column error (PGRST204 AND 42703)', async () => {
    updateResult = { data: null, error: { code: 'PGRST204', message: "Could not find the 'indexable' column of 'public_reports' in the schema cache" } };
    expect((await call({ indexable: false })).status).toBe(503);
    updateResult = { data: null, error: { code: '42703' } };
    expect((await call({ indexable: false })).status).toBe(503);
  });

  it('500 on a transient write error', async () => {
    updateResult = { data: null, error: { code: 'XX000', message: 'boom' } };
    expect((await call({ indexable: false })).status).toBe(500);
  });

  it('429 when the per-user rate cap is exhausted', async () => {
    rlAllowed = false;
    const res = await call({ indexable: false });
    expect(res.status).toBe(429);
    expect(rlCalls.some((k) => k.startsWith('report-visibility:'))).toBe(true);
    expect(updateMock).not.toHaveBeenCalled();
  });
});
