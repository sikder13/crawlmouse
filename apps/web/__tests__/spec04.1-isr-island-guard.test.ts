import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// SPEC 04.1 §0/§8 — regression lock for the two load-bearing invariants of this phase (both are review
// lenses, §12.4):
//  (1) ISR integrity / V-cache — the /r/ page stays statically cached (revalidate=300) with NO server-side
//      session read, and the owner UI is a CLIENT island, so the cached HTML is owner-agnostic (U10).
//  (2) The client cannot widen a server gate — this phase adds NO write surface (the probe is GET-only)
//      and does not remove any of the four gated write routes' server-side gates.
// FAILS LOUD (ENOENT) if any pinned file is renamed.
const read = (rel: string) => readFileSync(resolve(__dirname, '..', rel), 'utf8');

describe('SPEC 04.1 — ISR integrity + no-widened-gate guard', () => {
  it('the /r/ page stays ISR (revalidate=300) and reads no session server-side', () => {
    const page = read('app/r/[slug]/page.tsx');
    expect(page).toContain('export const revalidate = 300');
    // Owner controls are a client island; the report page must NOT read the session (that would force it
    // dynamic and bake session data into the cached HTML — a SPEC 04 §8 regression).
    expect(page).not.toContain('supabaseServer');
    expect(page).not.toContain('auth.getUser');
    expect(page).not.toMatch(/from 'next\/headers'/); // no cookies()/headers() session read
    // The island is mounted with the PUBLIC claimed flag (a public fact, not session-derived).
    expect(page).toContain('ReportOwnerIsland');
    expect(page).toContain('reportClaimed={claimed}');
  });

  it('the owner island + its controls are client components', () => {
    for (const f of [
      'components/report/owner/ReportOwnerIsland.tsx',
      'components/report/owner/OwnerPanel.tsx',
      'components/report/owner/ClaimControl.tsx',
    ]) {
      expect(read(f).trimStart().startsWith("'use client'")).toBe(true);
    }
  });

  it('the ownership probe is READ-ONLY (GET), force-dynamic + no-store', () => {
    const route = read('app/api/reports/[slug]/mine/route.ts');
    expect(route).toContain("export const dynamic = 'force-dynamic'");
    expect(route).toContain('no-store');
    expect(route).toContain('export async function GET');
    // No write verbs — the probe adds zero write surface.
    expect(route).not.toContain('export async function POST');
    expect(route).not.toContain('export async function PUT');
    expect(route).not.toContain('export async function DELETE');
  });

  it('the four gated write routes still enforce their server-side gates (no gate removed)', () => {
    const claim = read('app/api/reports/[slug]/claim/route.ts');
    const visibility = read('app/api/reports/[slug]/visibility/route.ts');
    const whiteLabel = read('app/api/reports/[slug]/white-label/route.ts');
    const logo = read('app/api/reports/[slug]/logo/route.ts');
    // Ownership gate on every mutating route (re-derived from domain verification, never client-asserted).
    for (const r of [claim, visibility, whiteLabel, logo]) expect(r).toContain('isDomainVerifiedForUser');
    // Paid-entitlement gate on the two Pro-only routes.
    for (const r of [whiteLabel, logo]) expect(r).toContain('entitlementFor');
    // Auth (401) on every mutating route.
    for (const r of [claim, visibility, whiteLabel, logo]) expect(r).toContain('status: 401');
  });
});
