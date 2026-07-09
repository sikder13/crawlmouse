import { describe, it, expect, vi, beforeEach } from 'vitest';

// SPEC 04.1 §2 (U1) — the read-only ownership probe. The ISR /r/ page is session-unaware, so the owner
// client island asks this endpoint "do I own this report + what's my entitlement?" It mirrors the
// claim/white-label gate chain (readReportRow → isDomainVerifiedForUser → entitlementFor) but is
// READ-ONLY, no-store, and DENY-BY-DEFAULT: anon / non-owner get exactly `{owned:false}` (no leak of
// listed/indexable/whiteLabel or any session-derived state). Entitlement is the REAL entitlementFor,
// recomputed from the user's own pro_until — never trusted from the client.

const FUTURE = new Date(Date.now() + 86_400_000).toISOString();
const PAST = new Date(Date.now() - 86_400_000).toISOString();

let user: { id: string } | null = { id: 'u-1' };
let reportRow: Record<string, unknown> | null = null;
let owns = true;
let proUntil: string | null = FUTURE;

vi.mock('@/lib/supabase/server', () => ({
  supabaseServer: () => Promise.resolve({ auth: { getUser: () => Promise.resolve({ data: { user } }) } }),
}));
vi.mock('@/lib/reports', () => ({ readReportRow: () => Promise.resolve(reportRow) }));
vi.mock('@/lib/report-ownership', () => ({ isDomainVerifiedForUser: () => Promise.resolve(owns) }));
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: (table: string) => {
      if (table === 'users') {
        return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: { pro_until: proUntil }, error: null }) }) }) };
      }
      return {};
    },
  }),
}));

import { GET } from './route';

const SLUG = 'slug-xyz';
const call = (slug = SLUG) =>
  GET(new Request(`http://localhost/api/reports/${slug}/mine`), { params: Promise.resolve({ slug }) });

beforeEach(() => {
  user = { id: 'u-1' };
  reportRow = { domain: 'ex.com', grade: 'C', hidden_at: null, takedown_requested_at: null, claimed_at: '2026-01-01T00:00:00Z', listed: true, indexable: true, white_label: null };
  owns = true;
  proUntil = FUTURE;
});

describe('GET /api/reports/[slug]/mine — ownership probe (U1)', () => {
  it('anon → {owned:false}, no-store, and never leaks report internals', async () => {
    user = null;
    const res = await call();
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toContain('no-store');
    expect(await res.json()).toEqual({ owned: false });
  });

  it('404 when the report is missing or gone (hidden/takedown)', async () => {
    reportRow = null;
    expect((await call()).status).toBe(404);
    reportRow = { domain: 'ex.com', grade: 'C', hidden_at: '2026-07-08T00:00:00Z' };
    expect((await call()).status).toBe(404);
  });

  it('signed-in NON-owner → {owned:false} (deny-by-default)', async () => {
    owns = false;
    expect(await (await call()).json()).toEqual({ owned: false });
  });

  it('verified PRO owner → full owner payload with canWhiteLabel true', async () => {
    const res = await call();
    expect(res.headers.get('cache-control')).toContain('no-store');
    expect(await res.json()).toEqual({
      owned: true, claimed: true, canWhiteLabel: true, listed: true, indexable: true, whiteLabel: null,
    });
  });

  it('verified FREE owner → canWhiteLabel false (drives the locked white-label upsell)', async () => {
    proUntil = PAST;
    expect(await (await call()).json()).toMatchObject({ owned: true, canWhiteLabel: false });
    proUntil = null;
    expect(await (await call()).json()).toMatchObject({ owned: true, canWhiteLabel: false });
  });

  it('reflects the report visibility + white-label state so the toggles initialize correctly', async () => {
    reportRow = { domain: 'ex.com', grade: 'B', hidden_at: null, takedown_requested_at: null, claimed_at: 'x', listed: false, indexable: false, white_label: { brandName: 'Acme', logoPath: null } };
    expect(await (await call()).json()).toEqual({
      owned: true, claimed: true, canWhiteLabel: true, listed: false, indexable: false, whiteLabel: { brandName: 'Acme', logoPath: null },
    });
  });
});
