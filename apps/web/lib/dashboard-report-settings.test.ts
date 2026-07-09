import { describe, it, expect } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { loadReportSettingsForSites } from './dashboard-report-settings';

// SPEC 04.1 §3 (dashboard) — map the owner's sites to their CLAIMED report's settings. Ownership is
// re-derived from domain_verifications (no claimed_by), and only claimed, non-hidden reports for a
// VERIFIED domain surface. Never selects minted_by. Kept apps/web-local (packages/types untouched).

// A chainable, awaitable Supabase stub: every query method returns the same object, which resolves to
// {data,error} when awaited. `from(table)` picks the table's rows.
function mockAdmin(verifs: { domain: string }[], reports: Record<string, unknown>[], errorFor?: string): SupabaseClient {
  return {
    from: (table: string) => {
      const err = errorFor === table ? { code: '42703' } : null;
      const data = table === 'domain_verifications' ? verifs : reports;
      const result = Promise.resolve({ data: err ? null : data, error: err });
      const c: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'in', 'not', 'is']) c[m] = () => c;
      (c as { then: unknown }).then = (res: (v: unknown) => void, rej: (e: unknown) => void) => result.then(res, rej);
      return c;
    },
  } as unknown as SupabaseClient;
}

const REPORT = (domain: string, over: Record<string, unknown> = {}) => ({
  slug: `slug-${domain}`, domain, listed: true, indexable: true, white_label: null, claimed_at: 'x', hidden_at: null, ...over,
});

describe('loadReportSettingsForSites', () => {
  it('maps a verified domain with a claimed report to its site (Pro → canWhiteLabel true)', async () => {
    const admin = mockAdmin([{ domain: 'example.com' }], [REPORT('example.com', { listed: false, white_label: { brandName: 'Acme', logoPath: null } })]);
    const out = await loadReportSettingsForSites(admin, 'u-1', ['https://example.com/'], true);
    expect(out.get('https://example.com/')).toEqual({
      slug: 'slug-example.com', claimed: true, listed: false, indexable: true,
      whiteLabel: { brandName: 'Acme', logoPath: null }, canWhiteLabel: true,
    });
  });

  it('free owner → canWhiteLabel false', async () => {
    const admin = mockAdmin([{ domain: 'example.com' }], [REPORT('example.com')]);
    const out = await loadReportSettingsForSites(admin, 'u-1', ['https://example.com/'], false);
    expect(out.get('https://example.com/')?.canWhiteLabel).toBe(false);
  });

  it('matches www/non-www via normalizeDomain', async () => {
    const admin = mockAdmin([{ domain: 'example.com' }], [REPORT('example.com')]);
    const out = await loadReportSettingsForSites(admin, 'u-1', ['https://www.example.com/'], true);
    expect(out.get('https://www.example.com/')?.slug).toBe('slug-example.com');
  });

  it('omits sites whose domain is not verified, and verified sites with no claimed report', async () => {
    const admin = mockAdmin([{ domain: 'example.com' }], []); // verified but no report
    const out = await loadReportSettingsForSites(admin, 'u-1', ['https://example.com/', 'https://other.com/'], true);
    expect(out.size).toBe(0);
  });

  it('returns empty when the user has no verified domains (no report query needed)', async () => {
    const admin = mockAdmin([], [REPORT('example.com')]);
    const out = await loadReportSettingsForSites(admin, 'u-1', ['https://example.com/'], true);
    expect(out.size).toBe(0);
  });

  it('fails soft to empty on a deploy-order (undefined-column) error — never breaks the dashboard', async () => {
    const admin = mockAdmin([{ domain: 'example.com' }], [REPORT('example.com')], 'public_reports');
    const out = await loadReportSettingsForSites(admin, 'u-1', ['https://example.com/'], true);
    expect(out.size).toBe(0);
  });
});
