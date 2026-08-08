import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => {}, refresh: () => {} }) }));
vi.mock('@/lib/analytics', () => ({ trackRaw: () => {}, track: () => {} }));

import { loadDashboardSites } from './dashboard';
import { SiteCard } from '@/components/dashboard/SiteCard';

/**
 * THE LOADER → CARD SEAM FOR `hasPredecessor` — gate 7, an open coverage gap.
 *
 * `SiteCard.test.tsx` drives the card with `hasPredecessor` set BY HAND, and `dashboard.test.ts`
 * drives the loader without ever asserting the field. Between them the one line that PRODUCES it was
 * unpinned, and it was measured: `const hasPredecessor = false` left 1517/1517 green while making
 * every card on the dashboard read "First audit — re-audit later"; inverting it was green too.
 *
 * That is the field the whole B6-1 fix rests on. B6-1's point is that EXISTING and LOADED are
 * different questions — `previous_audit_id` answers the first, `delta.previousAuditId` only the
 * second — and the card needs both to choose between three outcomes. A test that hands the card a
 * hand-written value cannot see the loader answering the wrong question.
 *
 * So this file spans the seam: real rows in, `loadDashboardSites` runs, and the card is rendered from
 * what the loader actually returned. All three states are covered, including the middle one, which is
 * the state gates 4, 5 and 6 each collapsed in turn.
 */

// b-latest's predecessor is `b-old`, which is NOT in the returned window — the "exists but was not
// loaded" state (expired, not completed, or past the 200-row limit).
const AUDITS = [
  { id: 'a2', url: 'https://a.com/', grade: 'B', score: 80, confidence: 'high', completed_at: '2026-07-01T00:00:00Z', previous_audit_id: 'a1' },
  { id: 'a1', url: 'https://a.com/', grade: 'C', score: 70, confidence: 'high', completed_at: '2026-06-01T00:00:00Z', previous_audit_id: null },
  { id: 'c1', url: 'https://c.com/', grade: 'A', score: 92, confidence: 'high', completed_at: '2026-07-02T00:00:00Z', previous_audit_id: null },
  { id: 'b-latest', url: 'https://b.com/', grade: 'B', score: 81, confidence: 'high', completed_at: '2026-07-03T00:00:00Z', previous_audit_id: 'b-old' },
];

const sbUser = () => ({
  from() {
    const chain: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'or', 'order']) chain[m] = () => chain;
    chain.limit = () => Promise.resolve({ data: AUDITS, error: null });
    return chain;
  },
});
const admin = () => ({
  from: () => ({ select: () => ({ in: () => Promise.resolve({ data: [], error: null }) }) }),
});

const load = () => loadDashboardSites(sbUser() as never, admin() as never, false);
const cardFor = (sites: Awaited<ReturnType<typeof load>>, url: string) => {
  const site = sites.find((s) => s.siteUrl === url);
  if (!site) throw new Error(`no site for ${url}`);
  return { site, html: renderToStaticMarkup(<SiteCard site={site} />) };
};

const FIRST_AUDIT = 'First audit — re-audit later';

describe('hasPredecessor, from the loader through to the rendered card', () => {
  it('NO predecessor → the loader says false and the card says "First audit"', async () => {
    const { site, html } = cardFor(await load(), 'https://c.com/');
    expect(site.hasPredecessor).toBe(false);
    expect(html).toContain(FIRST_AUDIT);
  });

  it('predecessor EXISTS and was LOADED → the loader says true and the card shows the delta badge', async () => {
    const { site, html } = cardFor(await load(), 'https://a.com/');
    expect(site.hasPredecessor).toBe(true);
    expect(site.delta?.previousAuditId).toBe('a1');
    expect(html).not.toContain(FIRST_AUDIT);
    expect(html).toContain('→'); // the C → B badge
  });

  it('predecessor EXISTS but was NOT loaded → true, no delta, and the card says NOTHING', async () => {
    // The state between the two gates, and the one the field exists to distinguish. "First audit" is
    // false here and a badge would invent a reading, so silence is the only honest output.
    const { site, html } = cardFor(await load(), 'https://b.com/');
    expect(site.hasPredecessor).toBe(true);
    expect(site.delta?.previousAuditId ?? null).toBeNull();
    expect(html).not.toContain(FIRST_AUDIT);
    expect(html).not.toContain('→');
  });

  it('the three states are DISTINCT — a constant cannot satisfy them', async () => {
    // Anti-vacuity, stated as the property rather than left implicit across three cases: any
    // implementation returning one constant fails at least one of these, in both directions.
    const sites = await load();
    const flags = ['https://c.com/', 'https://a.com/', 'https://b.com/'].map(
      (u) => sites.find((s) => s.siteUrl === u)!.hasPredecessor,
    );
    expect(flags).toEqual([false, true, true]);
    // …and `hasPredecessor` is NOT merely a restatement of whether the delta loaded: b.com has one
    // true and the other null, which is precisely why two gates are needed instead of one.
    const b = sites.find((s) => s.siteUrl === 'https://b.com/')!;
    expect(b.hasPredecessor).not.toBe(b.delta?.previousAuditId != null);
  });
});
