import { describe, it, expect, vi, beforeEach } from 'vitest';

// next/cache is mocked so we can assert exactly which caches a takedown purges.
const { revalidateTag, revalidatePath } = vi.hoisted(() => ({
  revalidateTag: vi.fn(),
  revalidatePath: vi.fn(),
}));
vi.mock('next/cache', () => ({
  revalidateTag,
  revalidatePath,
  // unstable_cache is unused by the purge path but imported at module top; stub it so the
  // module loads under Vitest (no `@/` alias resolution needed for it).
  unstable_cache: (fn: unknown) => fn,
}));
// The admin client import is never exercised by purgePublicReport; stub it so the module's
// top-level `@/lib/supabase/admin` import doesn't blow up under Vitest.
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({}) }));

import { purgePublicReport, readReportRow, LEGACY_REPORT_COLS, EXTENDED_REPORT_COLS } from './reports';
import type { WhiteLabelConfig } from '@crawlmouse/types';

// SPEC 04 §5 — the white-label config the report render reads (null = Crawlmouse-branded default).
const WL: WhiteLabelConfig = { brandName: 'Acme Agency', logoPath: 'report-logos/s/logo.png' };

// SPEC 04 §3/§4 + deploy-order safety. `readReportRow` reads the new visibility/snapshot columns when
// they exist and falls back to the LEGACY set ONLY on Postgres 42703 (pre-Runbook-B), so every
// existing report keeps rendering before the migration is applied. `minted_by` is NEVER selected.
function fakeReportSb(behaviour: { extended?: { data?: unknown; error?: { code?: string } | null }; legacy?: { data?: unknown } }) {
  const selects: string[] = [];
  const sb = {
    from: () => ({
      select: (cols: string) => {
        selects.push(cols);
        const res = cols.includes('report_snapshot')
          ? (behaviour.extended ?? { data: null, error: null })
          : { data: behaviour.legacy?.data ?? null, error: null };
        return { eq: () => ({ maybeSingle: () => Promise.resolve(res) }) };
      },
    }),
  };
  return { sb, selects };
}
const ROW = { domain: 'ex.com', grade: 'C', score: '63.66', created_at: 't' };

describe('readReportRow (deploy-order-safe report read)', () => {
  it('reads the EXTENDED columns (report_snapshot + visibility) when they exist', async () => {
    const snap = { version: 1, grade: 'C' };
    const { sb, selects } = fakeReportSb({ extended: { data: { ...ROW, report_snapshot: snap, claimed_at: 't', indexable: true, hidden_at: null, white_label: WL }, error: null } });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const row = await readReportRow(sb as any, 's');
    expect(row?.report_snapshot).toEqual(snap);
    expect(row?.indexable).toBe(true);
    expect(row?.white_label).toEqual(WL); // SPEC 04 §5 — white-label config surfaces on the read
    expect(selects[0]).toBe(EXTENDED_REPORT_COLS);
    expect(selects.length).toBe(1);
  });

  it('falls back to the LEGACY columns on 42703 (pre-migration) — the report still renders', async () => {
    const { sb, selects } = fakeReportSb({ extended: { error: { code: '42703' } }, legacy: { data: ROW } });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const row = await readReportRow(sb as any, 's');
    expect(row?.domain).toBe('ex.com');
    expect(row?.report_snapshot).toBeUndefined();
    expect(row?.white_label).toBeUndefined(); // deploy-order-safe: absent pre-Runbook-B → Crawlmouse-branded
    expect(selects[0]).toBe(EXTENDED_REPORT_COLS);
    expect(selects[1]).toBe(LEGACY_REPORT_COLS);
  });

  it('does NOT fall back on a transient (non-42703) error — returns null, never a legacy downgrade', async () => {
    const { sb, selects } = fakeReportSb({ extended: { error: { code: '57014' } } });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const row = await readReportRow(sb as any, 's');
    expect(row).toBeNull();
    expect(selects.length).toBe(1);
  });

  it('NEVER selects minted_by in either column set; the extended set carries the render columns', () => {
    expect(EXTENDED_REPORT_COLS).not.toContain('minted_by');
    expect(LEGACY_REPORT_COLS).not.toContain('minted_by');
    for (const c of ['report_snapshot', 'claimed_at', 'listed', 'indexable', 'hidden_at', 'white_label']) expect(EXTENDED_REPORT_COLS).toContain(c);
  });
});

describe('purgePublicReport', () => {
  beforeEach(() => {
    revalidateTag.mockClear();
    revalidatePath.mockClear();
  });

  it('purges the tagged data read, the report page, AND the OG image segment', () => {
    purgePublicReport('abc123');
    // The shared data layer (getPublicReport) is tag-invalidated.
    expect(revalidateTag).toHaveBeenCalledWith('public-report:abc123');
    // The report page full-route cache.
    expect(revalidatePath).toHaveBeenCalledWith('/r/abc123');
    // The OG image is a SEPARATE route segment with its own `revalidate = 3600` full-route
    // cache — revalidatePath('/r/<slug>') does NOT cascade to it, so it must be purged
    // explicitly or the pre-takedown viral card serves for up to an hour.
    expect(revalidatePath).toHaveBeenCalledWith('/r/abc123/opengraph-image');
  });
});
