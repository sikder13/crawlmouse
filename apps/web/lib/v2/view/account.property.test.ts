/**
 * viewAt and the dashboard's reconciliation over every moment a viewer can ask about: each record's
 * own timestamp, a millisecond either side of it, and points between. Real records re-read at
 * different moments, not invented ones, so every dataset is one the contract accepts; the counts at
 * the end show each edge the plan names was reached.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { FixtureDatasetSchema, instant, type FixtureDataset } from '@crawlmouse/types/v2';
import { CLEAN_VIEWER } from '../../../app/(v2-preview)/v2-preview/_preview/accounts';
import { fixture } from '../fixtures';
import { firstRunNow, viewAt, type Viewer } from './account';
import { dashboardView } from './dashboard';

const CASES: { name: string; d: FixtureDataset; viewer: Omit<Viewer, 'now'> }[] = [
  {
    name: 'bad-site',
    d: fixture('bad-site'),
    viewer: { accountId: 'a0000000-0000-4000-8000-000000000001' },
  },
  {
    name: 'challenged-site',
    d: fixture('challenged-site'),
    viewer: { accountId: 'a0000000-0000-4000-8000-0000000000c9' },
  },
  { name: 'clean-site', d: fixture('clean-site'), viewer: CLEAN_VIEWER },
];

/** Every timestamp in a dataset's records, so the moments include each record's own edge. */
function stamps(d: FixtureDataset): number[] {
  const out = new Set<number>();
  JSON.stringify(d, (_k, v) => {
    if (typeof v === 'string' && /^\d{4}-\d\d-\d\dT[\d:.]+Z$/.test(v)) out.add(instant(v));
    return v;
  });
  return [...out];
}

/** The moments to try for one case: each stamp and a millisecond either side, from the account's start. */
function moments(c: (typeof CASES)[number]) {
  const start = instant(firstRunNow(c.d, c.viewer));
  const end = instant(c.d.as_of);
  const edges = stamps(c.d)
    .flatMap((t) => [t - 1, t, t + 1])
    .filter((t) => t >= start && t <= end);
  return fc.oneof(fc.constantFrom(...edges), fc.integer({ min: start, max: end }));
}

/** The health mean worked from the raw dataset, without the view model's helpers. */
function rawHealth(d: FixtureDataset, accountId: string, adopt: readonly string[], now: number) {
  const values: number[] = [];
  let withheld = 0;
  for (const s of d.sites) {
    if (s.account_id !== accountId && !adopt.includes(s.id)) continue;
    if (instant(s.created_at) > now) continue;
    const latest = d.checks
      .filter((c) => c.site_id === s.id && c.finished_at && instant(c.finished_at) <= now)
      .filter((c) => c.status === 'finished' || c.status === 'partial')
      .sort((a, b) => instant(b.finished_at!) - instant(a.finished_at!))[0];
    if (!latest) continue;
    const seo = latest.technical_seo?.score ?? null;
    const ai = latest.ai_readability;
    if (ai?.withheld) withheld++;
    if (seo === null || !ai || ai.withheld || ai.total === null) continue;
    values.push(seo, ai.total);
  }
  return {
    value: values.length
      ? String(Math.round(values.reduce((a, b) => a + b, 0) / values.length))
      : null,
    withheld,
  };
}

describe.each(CASES)('viewAt and the dashboard, $name, at any moment', (c) => {
  const seen = { emptyWindow: 0, rows: 0, atCheckFinish: 0, inFlight: 0, withheld: 0 };
  const finishes = new Set(
    c.d.checks.flatMap((ch) => (ch.finished_at ? [instant(ch.finished_at)] : [])),
  );

  it('never shows a record from after now, stays a valid dataset, and reconciles its counts', () => {
    fc.assert(
      fc.property(moments(c), (t) => {
        const now = new Date(t).toISOString();
        const viewer = { ...c.viewer, now };
        const v = viewAt(c.d, viewer);
        FixtureDatasetSchema.parse(v.d);
        const after = (ts: string | null) => ts !== null && instant(ts) > t;
        expect(v.d.checks.filter((ch) => after(ch.finished_at) || ch.finished_at === null)).toEqual(
          [],
        );
        expect(v.d.changes.filter((ch) => after(ch.detected_at))).toEqual([]);
        expect(v.d.fix_events.filter((e) => after(e.at))).toEqual([]);
        expect(v.d.sites.filter((s) => after(s.created_at))).toEqual([]);

        const dash = dashboardView(c.d, viewer);
        const cells = dash.sites.rows.reduce((n, r) => n + r.since.opened + r.since.resolved, 0);
        expect(cells).toBe(dash.changed.length);
        if (dash.strip) {
          expect(dash.strip.opened.count + dash.strip.resolved.count).toBe(dash.changed.length);
          const truth = rawHealth(c.d, c.viewer.accountId, c.viewer.adopt ?? [], t);
          expect(dash.strip.health.value).toBe(truth.value ?? '—');
          if (truth.withheld > 0) {
            expect(dash.strip.health.excluded).toMatch(
              new RegExp(`^${truth.withheld} sites? excluded: AI readability withheld`),
            );
            seen.withheld++;
          } else {
            expect(dash.strip.health.excluded ?? '').not.toMatch(/withheld/);
          }
        }
        if (dash.changed.length) seen.rows++;
        else seen.emptyWindow++;
        if (finishes.has(t)) seen.atCheckFinish++;
        if (v.inFlight.length) seen.inFlight++;
      }),
      { numRuns: 300 },
    );
  });

  it('reached the edges it is meant to', () => {
    expect(seen.emptyWindow).toBeGreaterThan(0);
    expect(seen.atCheckFinish).toBeGreaterThan(0);
    if (c.name === 'bad-site') {
      expect(seen.rows).toBeGreaterThan(0);
      expect(seen.inFlight).toBeGreaterThan(0);
    }
    if (c.name === 'challenged-site') expect(seen.withheld).toBeGreaterThan(0);
  });
});
