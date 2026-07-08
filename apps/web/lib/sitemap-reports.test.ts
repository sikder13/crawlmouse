import { describe, it, expect, vi } from 'vitest';
import { fetchIndexableReportSlugs } from './sitemap-reports';

// SPEC 04 §8 (V13) — the /r/ sitemap section lists ONLY claimed+indexable, non-hidden, non-taken-down
// reports (unclaimed mints have indexable=false → never listed; the filter IS the guardrail). The read
// is deploy-order-safe and MUST never throw: pre-Runbook-B the columns are absent → error → []; a
// transient error → [] too. A cap keeps the query bounded but truncation is logged, never silent.

type Filter = [string, ...unknown[]];
function makeSb(result: { data: unknown; error: unknown }) {
  const record: { table?: string; filters: Filter[] } = { filters: [] };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chain: any = {
    select: (...a: unknown[]) => { record.filters.push(['select', ...a]); return chain; },
    eq: (...a: unknown[]) => { record.filters.push(['eq', ...a]); return chain; },
    not: (...a: unknown[]) => { record.filters.push(['not', ...a]); return chain; },
    is: (...a: unknown[]) => { record.filters.push(['is', ...a]); return chain; },
    order: (...a: unknown[]) => { record.filters.push(['order', ...a]); return chain; },
    limit: (...a: unknown[]) => { record.filters.push(['limit', ...a]); return Promise.resolve(result); },
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb: any = { from: (t: string) => { record.table = t; return chain; } };
  return { sb, record };
}

describe('fetchIndexableReportSlugs', () => {
  it('maps claimed+indexable reports to {slug,lastModified} with the guardrail filter set', async () => {
    const { sb, record } = makeSb({
      data: [
        { slug: 'a', created_at: '2026-01-01T00:00:00Z' },
        { slug: 'b', created_at: '2026-02-01T00:00:00Z' },
      ],
      error: null,
    });
    const out = await fetchIndexableReportSlugs(sb, 100);
    expect(out).toEqual([
      { slug: 'a', lastModified: '2026-01-01T00:00:00Z' },
      { slug: 'b', lastModified: '2026-02-01T00:00:00Z' },
    ]);
    expect(record.table).toBe('public_reports');
    expect(record.filters).toContainEqual(['eq', 'indexable', true]);
    // claimed_at is explicit, not just implied by indexable — a defense-in-depth match to the
    // spec's "claimed + indexable" so no future write path that sets indexable without claiming
    // can ever advertise an unclaimed page in the sitemap.
    expect(record.filters).toContainEqual(['not', 'claimed_at', 'is', null]);
    expect(record.filters).toContainEqual(['is', 'hidden_at', null]);
    expect(record.filters).toContainEqual(['is', 'takedown_requested_at', null]);
    expect(record.filters).toContainEqual(['limit', 100]);
  });

  it('returns [] on ANY query error (pre-migration undefined column OR transient) — never throws', async () => {
    const undef = makeSb({ data: null, error: { code: '42703' } });
    expect(await fetchIndexableReportSlugs(undef.sb, 100)).toEqual([]);
    const transient = makeSb({ data: null, error: { code: 'XX000', message: 'boom' } });
    expect(await fetchIndexableReportSlugs(transient.sb, 100)).toEqual([]);
  });

  it('returns [] and never throws when the client itself throws (e.g. missing env at build)', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb: any = { from: () => { throw new Error('no service-role key'); } };
    expect(await fetchIndexableReportSlugs(sb, 100)).toEqual([]);
  });

  it('caps at the limit and warns — no silent truncation', async () => {
    const rows = Array.from({ length: 3 }, (_, i) => ({ slug: `s${i}`, created_at: '2026-01-01T00:00:00Z' }));
    const { sb } = makeSb({ data: rows, error: null });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const out = await fetchIndexableReportSlugs(sb, 3);
    expect(out).toHaveLength(3);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
