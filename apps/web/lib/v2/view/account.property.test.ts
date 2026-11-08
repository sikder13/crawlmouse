/**
 * viewAt and the dashboard's reconciliation, with the moment varied and the datasets not: the three
 * contract fixtures, read at each record's own timestamp, a millisecond either side of it, and
 * points between. What varies is the moment; the records are the fixtures' own, so every dataset is
 * one the contract accepts. Each property counts the edges it reached and requires each named edge
 * at least once; edges no fixture holds (a refused Technical SEO score, a site added after the
 * previous check) are not reached here, and SPEC 26 says so.
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

/**
 * The health move and the sites on a first baseline, worked from the raw records (owner ruling
 * 2026-11-08): the earlier moment is the primary site's previous result (or, while it has one, the
 * latest previous result of any site), no earlier than the account's start; a site graded now is
 * new when it had no result then, or a `baseline` change came after then. The move is the rounded
 * mean of both grades over the other sites graded at both moments.
 */
function rawMove(
  d: FixtureDataset,
  accountId: string,
  adopt: readonly string[],
  now: number,
  start: number,
) {
  const mine = d.sites.filter(
    (s) => (s.account_id === accountId || adopt.includes(s.id)) && instant(s.created_at) <= now,
  );
  const results = (id: string, until: number) =>
    d.checks
      .filter((c) => c.site_id === id && c.finished_at && instant(c.finished_at) <= until)
      .filter((c) => c.status === 'finished' || c.status === 'partial')
      .sort((a, b) => instant(a.finished_at!) - instant(b.finished_at!));
  const pair = (id: string, until: number): [number, number] | null => {
    const c = results(id, until).at(-1);
    const seo = c?.technical_seo?.score ?? null;
    const ai = c?.ai_readability;
    return seo === null || !ai || ai.withheld || ai.total === null ? null : [seo, ai.total];
  };
  const primary = mine
    .filter((s) => s.staging_of_site_id === null)
    .sort((x, y) => instant(x.created_at) - instant(y.created_at) || x.id.localeCompare(y.id))[0];
  if (!primary) return null;
  const prev =
    results(primary.id, now).at(-2) ??
    mine
      .map((s) => results(s.id, now).at(-2))
      .filter((c) => c !== undefined)
      .sort((a, b) => instant(b.finished_at!) - instant(a.finished_at!))[0];
  if (!prev) return null;
  const at = Math.max(instant(prev.finished_at!), start);
  const graded = mine.filter((s) => pair(s.id, now) !== null).map((s) => s.id);
  const fresh = graded.filter(
    (id) =>
      results(id, at).length === 0 ||
      d.changes.some(
        (c) =>
          c.site_id === id &&
          c.kind === 'baseline' &&
          instant(c.detected_at) > at &&
          instant(c.detected_at) <= now,
      ),
  );
  const both = graded.filter(
    (id) =>
      !fresh.includes(id) &&
      instant(d.sites.find((s) => s.id === id)!.created_at) <= at &&
      pair(id, at) !== null,
  );
  const mean = (until: number) => {
    const all = both.flatMap((id) => pair(id, until)!);
    return all.length ? Math.round(all.reduce((a, b) => a + b, 0) / all.length) : null;
  };
  const a = mean(at);
  const b = mean(now);
  return {
    move: a === null || b === null ? null : b - a,
    fresh: fresh.length,
    rebased: fresh.filter((id) => results(id, at).length > 0).length,
  };
}

/** "−2 since Thu" → −2; "no change since Fri 23 Oct" → 0. */
const moveIn = (delta: string) => {
  const m = delta.match(/^(no change|[+−]\d+)/)![1]!;
  return m === 'no change' ? 0 : Number(m.replace('−', '-'));
};

describe.each(CASES)('viewAt and the dashboard, $name, at any moment', (c) => {
  const seen = {
    emptyWindow: 0,
    rows: 0,
    atCheckFinish: 0,
    inFlight: 0,
    withheld: 0,
    fresh: 0,
    rebased: 0,
  };
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
        for (const site of v.d.sites) {
          const ranks = v.d.fixes
            .filter((f) => f.site_id === site.id && f.rank !== null)
            .map((f) => f.rank);
          expect(new Set(ranks).size, `distinct ranks on ${site.host}`).toBe(ranks.length);
        }

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
          const raw = rawMove(
            c.d,
            c.viewer.accountId,
            c.viewer.adopt ?? [],
            t,
            instant(firstRunNow(c.d, c.viewer)),
          );
          if (raw?.move !== null && raw !== null && truth.value !== null) {
            expect(moveIn(dash.strip.health.delta!), `move at ${now}`).toBe(raw.move);
            expect(dash.strip.health.fresh, `new at ${now}`).toBe(
              raw.fresh ? `${raw.fresh} new` : null,
            );
            if (raw.fresh) seen.fresh++;
            if (raw.rebased) seen.rebased++;
          } else {
            expect(dash.strip.health.delta, `no move at ${now}`).toBeNull();
          }
        }
        if (dash.changed.length) seen.rows++;
        else seen.emptyWindow++;
        if (finishes.has(t)) seen.atCheckFinish++;
        if (v.inFlight.length) seen.inFlight++;
      }),
      { numRuns: 300 },
    );
    // The edges this fixture holds, each reached at least once.
    expect(seen.emptyWindow).toBeGreaterThan(0);
    expect(seen.atCheckFinish).toBeGreaterThan(0);
    if (c.name === 'bad-site') {
      expect(seen.rows).toBeGreaterThan(0);
      expect(seen.inFlight).toBeGreaterThan(0);
      // redbirdaviation.com's new baseline, and sites added after the earlier check.
      expect(seen.fresh).toBeGreaterThan(0);
      expect(seen.rebased).toBeGreaterThan(0);
    }
    if (c.name === 'challenged-site') expect(seen.withheld).toBeGreaterThan(0);
  });
});

describe.each(CASES)('viewAt alone, $name, over the account’s whole history', (c) => {
  it('stays a valid dataset with nothing from after now, from the account’s first state on', () => {
    const a = c.viewer.account ?? c.d.accounts.find((x) => x.id === c.viewer.accountId)!;
    const start = instant(a.state_history[0]!.since);
    const end = instant(c.d.as_of);
    const edges = [...a.state_history.map((h) => instant(h.since)), ...stamps(c.d)]
      .flatMap((t) => [t - 1, t, t + 1])
      .filter((t) => t >= start && t <= end);
    fc.assert(
      fc.property(
        fc.oneof(fc.constantFrom(...edges), fc.integer({ min: start, max: end })),
        (t) => {
          const v = viewAt(c.d, { ...c.viewer, now: new Date(t).toISOString() });
          FixtureDatasetSchema.parse(v.d);
          expect(v.d.checks.filter((ch) => instant(ch.finished_at!) > t)).toEqual([]);
        },
      ),
      { numRuns: 200 },
    );
  });
});
