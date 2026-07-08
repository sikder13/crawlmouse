import { describe, it, expect, vi, beforeEach } from 'vitest';

// SPEC 04 §9 (V14) — claim a public report. AUTHED + reuse the EXISTING domain-verification: a user may
// claim a report only if they hold a verified domain_verifications row for the report's domain. Claim
// sets claimed_at + listed + indexable (owner can opt out later via the visibility route) and links the
// owner to the domain (embed_badges upsert). It writes ONLY public_reports/embed_badges — never the
// audits table — so it composes with, and never replaces, the anon-audit claim-on-signup flow
// (auth/claim, which writes audits.user_id). Service-role write; deploy-order-safe (PGRST204/42703 →
// 503, like mint/hide).

let user: { id: string } | null = { id: 'u-1' };
let ip = '9.9.9.9';
let rlAllowed = true;
let reportRow: Record<string, unknown> | null = null;
let owns = true;
let updateResult: { data: unknown; error: unknown } = { data: { slug: 'slug-xyz' }, error: null };
let upsertError: unknown = null;

const rlCalls: string[] = [];
const updateMock = vi.fn();
const upsertMock = vi.fn();
const purgeMock = vi.fn();
const ownershipArgs: Array<[string, string]> = [];
const fromTables: string[] = [];

vi.mock('@/lib/client-ip', () => ({ getClientIp: () => ip }));
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
  isDomainVerifiedForUser: (_sb: unknown, uid: string, domain: string) => { ownershipArgs.push([uid, domain]); return Promise.resolve(owns); },
}));
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: (table: string) => {
      fromTables.push(table);
      if (table === 'embed_badges') {
        return { upsert: (payload: unknown, opts: unknown) => { upsertMock(payload, opts); return upsertError ? Promise.reject(upsertError) : Promise.resolve({ error: null }); } };
      }
      return {
        update: (payload: unknown) => {
          updateMock(payload);
          return { eq: () => ({ is: () => ({ select: () => ({ maybeSingle: () => Promise.resolve(updateResult) }) }) }) };
        },
      };
    },
  }),
}));

import { POST } from './route';

const SLUG = 'slug-xyz';
const call = (slug = SLUG) => POST(new Request(`http://localhost/api/reports/${slug}/claim`, { method: 'POST' }), { params: Promise.resolve({ slug }) });

beforeEach(() => {
  user = { id: 'u-1' };
  ip = '9.9.9.9';
  rlAllowed = true;
  reportRow = { domain: 'ex.com', grade: 'C', hidden_at: null, takedown_requested_at: null, claimed_at: null };
  owns = true;
  updateResult = { data: { slug: SLUG }, error: null };
  upsertError = null;
  rlCalls.length = 0; ownershipArgs.length = 0; fromTables.length = 0;
  updateMock.mockClear(); upsertMock.mockClear(); purgeMock.mockClear();
});

describe('POST /api/reports/[slug]/claim (V14)', () => {
  it('401 when unauthenticated — no read, no write', async () => {
    user = null;
    const res = await call();
    expect(res.status).toBe(401);
    expect(updateMock).not.toHaveBeenCalled();
  });

  it('404 when the report does not exist', async () => {
    reportRow = null;
    expect((await call()).status).toBe(404);
    expect(updateMock).not.toHaveBeenCalled();
  });

  it('404 when the report is gone (hidden/taken-down/ungradeable) — cannot claim it', async () => {
    reportRow = { domain: 'ex.com', grade: 'C', hidden_at: '2026-07-08T00:00:00Z', takedown_requested_at: null, claimed_at: null };
    expect((await call()).status).toBe(404);
    expect(updateMock).not.toHaveBeenCalled();
  });

  it('403 verification_required when the user has NOT verified the report domain — no write', async () => {
    owns = false;
    const res = await call();
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe('verification_required');
    expect(ownershipArgs).toContainEqual(['u-1', 'ex.com']); // ownership checked against the report's domain
    expect(updateMock).not.toHaveBeenCalled();
  });

  it('200 fresh claim: sets claimed_at + listed + indexable, links the owner, purges caches', async () => {
    const res = await call();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, slug: SLUG, alreadyClaimed: false });
    const payload = updateMock.mock.calls[0]![0] as Record<string, unknown>;
    expect(payload.claimed_at).toEqual(expect.any(String));
    expect(payload.listed).toBe(true);
    expect(payload.indexable).toBe(true);
    expect(upsertMock).toHaveBeenCalledWith({ user_id: 'u-1', domain: 'ex.com' }, { onConflict: 'user_id,domain' });
    expect(purgeMock).toHaveBeenCalledWith(SLUG);
  });

  it('200 idempotent when already claimed (0 rows updated) — still links the owner + purges', async () => {
    updateResult = { data: null, error: null };
    const res = await call();
    expect(res.status).toBe(200);
    expect((await res.json())).toMatchObject({ ok: true, alreadyClaimed: true });
    expect(upsertMock).toHaveBeenCalled();
    expect(purgeMock).toHaveBeenCalledWith(SLUG);
  });

  it('503 deploy-order fail-soft on an undefined-column write error (PGRST204 AND 42703) — no badge link', async () => {
    updateResult = { data: null, error: { code: 'PGRST204', message: "Could not find the 'claimed_at' column of 'public_reports' in the schema cache" } };
    expect((await call()).status).toBe(503);
    updateResult = { data: null, error: { code: '42703' } };
    expect((await call()).status).toBe(503);
    expect(upsertMock).not.toHaveBeenCalled();
    expect(purgeMock).not.toHaveBeenCalled();
  });

  it('500 on a transient (non-undefined-column) write error', async () => {
    updateResult = { data: null, error: { code: 'XX000', message: 'boom' } };
    expect((await call()).status).toBe(500);
  });

  it('the embed_badges owner link is best-effort — a failed upsert does NOT fail the claim (still 200)', async () => {
    upsertError = new Error('network');
    const res = await call();
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
  });

  it('429 when the per-user rate cap is exhausted — no read/write', async () => {
    rlAllowed = false;
    const res = await call();
    expect(res.status).toBe(429);
    expect(rlCalls.some((k) => k === 'claim:u-1')).toBe(true);
    expect(updateMock).not.toHaveBeenCalled();
  });

  it('composes with anon-audit claim: it NEVER writes the audits table (only public_reports + embed_badges)', async () => {
    await call();
    expect(fromTables).toContain('public_reports');
    expect(fromTables).toContain('embed_badges');
    expect(fromTables).not.toContain('audits');
  });
});
