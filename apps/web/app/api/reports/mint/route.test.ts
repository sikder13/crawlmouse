import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// SPEC 04 §3 (V4) — frictionless mint. Auth is OPTIONAL: possession of a COMPLETED audit's capability
// UUID is the permission (no 401, no 403 verification_required). Turnstile on-demand + per-IP (anon) /
// per-user (authed) caps. Writes report_snapshot + minted_by; idempotent per audit. Deploy-order-safe:
// if the visibility/snapshot columns don't exist yet (pre-Runbook-B) the whole mint is 503 (so open
// minting can never ship WITHOUT the noindex-by-default guardrail the columns provide).

let user: { id: string } | null = null;
let ip = '9.9.9.9';
let capAllowed = true;
let turnstileOk = true;
let auditRow: Record<string, unknown> | null = { id: 'aud-1', user_id: null, url: 'https://ex.com', status: 'completed', grade: 'C' };
let existingReport: { slug: string } | null = null;
let insertError: { code?: string; message?: string } | null = null;
const rlCalls: string[] = [];
const insertMock = vi.fn();

vi.mock('@/lib/client-ip', () => ({ getClientIp: () => ip }));
vi.mock('@/lib/supabase/server', () => ({ supabaseServer: () => Promise.resolve({ auth: { getUser: () => Promise.resolve({ data: { user } }) } }) }));
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: (key: string) => { rlCalls.push(key); return Promise.resolve({ allowed: capAllowed, remaining: 0, resetAt: new Date() }); },
}));
vi.mock('@/lib/turnstile', () => ({ verifyTurnstileToken: () => Promise.resolve(turnstileOk) }));
vi.mock('@/lib/mint-snapshot', () => ({ buildMintSnapshot: () => Promise.resolve({ version: 1, domain: 'ex.com', grade: 'C' }) }));
vi.mock('@/lib/slug', () => ({ newReportSlug: () => 'slug-xyz' }));
vi.mock('@/lib/domain', () => ({ normalizeDomain: () => 'ex.com' }));
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () => Promise.resolve(table === 'audits' ? { data: auditRow } : { data: existingReport }),
        }),
      }),
      insert: (payload: Record<string, unknown>) => { insertMock(payload); return Promise.resolve({ error: insertError }); },
    }),
  }),
}));

import { POST } from './route';

const AUD = '123e4567-e89b-12d3-a456-426614174000';
const req = (body: unknown) => new Request('http://localhost/api/reports/mint', { method: 'POST', body: JSON.stringify(body) });

beforeEach(() => {
  user = null; ip = '9.9.9.9'; capAllowed = true; turnstileOk = true;
  auditRow = { id: AUD, user_id: null, url: 'https://ex.com', status: 'completed', grade: 'C', score: '63', cms_detected: 'wp', page_count: 10, confidence: 'high', coverage_pct: '0.9', confidence_band: null, projected_score: null, projected_grade: null };
  existingReport = null; insertError = null; rlCalls.length = 0; insertMock.mockClear();
});

describe('POST /api/reports/mint — auth-optional (V4)', () => {
  it('ANON mint with a completed-audit capability succeeds, no auth (writes snapshot, minted_by null)', async () => {
    const res = await POST(req({ auditId: AUD }));
    expect(res.status).toBe(200);
    expect((await res.json()).slug).toBe('slug-xyz');
    expect(rlCalls.some((k) => k === 'mint:ip:9.9.9.9')).toBe(true); // anon → per-IP cap
    const payload = insertMock.mock.calls[0]![0] as Record<string, unknown>;
    expect(payload.report_snapshot).toMatchObject({ version: 1 });
    expect(payload.minted_by).toBeNull();
  });

  it('AUTHED mint sets minted_by to the user and uses the per-user cap', async () => {
    user = { id: 'u-1' };
    const res = await POST(req({ auditId: AUD }));
    expect(res.status).toBe(200);
    expect(rlCalls.some((k) => k === 'mint:u-1')).toBe(true);
    expect((insertMock.mock.calls[0]![0] as Record<string, unknown>).minted_by).toBe('u-1');
  });

  it('does NOT require domain verification (no 403 verification_required)', async () => {
    user = { id: 'u-1' }; // authed but unverified domain
    const res = await POST(req({ auditId: AUD }));
    expect(res.status).toBe(200);
  });

  it('404 for a missing audit; 400 for a not-completed audit', async () => {
    auditRow = null;
    expect((await POST(req({ auditId: AUD }))).status).toBe(404);
    auditRow = { id: AUD, url: 'https://ex.com', status: 'crawling', grade: null };
    expect((await POST(req({ auditId: AUD }))).status).toBe(400);
  });

  it('idempotent — an existing report for the audit returns its slug without re-inserting', async () => {
    existingReport = { slug: 'already' };
    const res = await POST(req({ auditId: AUD }));
    expect(res.status).toBe(200);
    expect((await res.json()).slug).toBe('already');
    expect(insertMock).not.toHaveBeenCalled();
  });

  it('Turnstile on-demand: cap exhausted + no token → 429 captcha_required; + valid token → passes', async () => {
    capAllowed = false;
    const blocked = await POST(req({ auditId: AUD }));
    expect(blocked.status).toBe(429);
    expect((await blocked.json()).error).toBe('captcha_required');
    expect(insertMock).not.toHaveBeenCalled();

    capAllowed = false; turnstileOk = true;
    const passed = await POST(req({ auditId: AUD, turnstileToken: 'tok' }));
    expect(passed.status).toBe(200);
  });

  it('cap exhausted + bad token → 429, no insert', async () => {
    capAllowed = false; turnstileOk = false;
    const res = await POST(req({ auditId: AUD, turnstileToken: 'spent' }));
    expect(res.status).toBe(429);
    expect(insertMock).not.toHaveBeenCalled();
  });

  it('deploy-order: an undefined-column insert error → 503 fail-soft (PostgREST PGRST204 AND Postgres 42703)', async () => {
    // A write body with a missing column returns PGRST204 from PostgREST (NOT 42703) — both must 503,
    // never fall through to a legacy insert that would create an UNGUARDED (indexable) report.
    insertError = { code: 'PGRST204', message: "Could not find the 'report_snapshot' column of 'public_reports' in the schema cache" };
    expect((await POST(req({ auditId: AUD }))).status).toBe(503);
    insertError = { code: '42703' };
    expect((await POST(req({ auditId: AUD }))).status).toBe(503);
  });

  it('rejects a non-UUID auditId with 400 before any work', async () => {
    const res = await POST(req({ auditId: 'nope' }));
    expect(res.status).toBe(400);
    expect(rlCalls.length).toBe(0);
  });

  it('selects the projection/confidence columns the snapshot needs (a silent drop would break V7)', () => {
    const src = readFileSync(resolve(__dirname, 'route.ts'), 'utf8');
    for (const c of ['confidence', 'coverage_pct', 'confidence_band', 'projected_score', 'projected_grade', 'page_count']) {
      expect(src).toContain(c);
    }
  });
});
