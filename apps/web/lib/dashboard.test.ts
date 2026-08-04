import { describe, it, expect } from 'vitest';
import { computeMonitoringDelta, buildFixChecklist, loadDashboardSites, type FixRecord } from './dashboard';

describe('computeMonitoringDelta', () => {
  const cur = { id: 'a2', grade: 'B', score: 80, completedAt: '2026-06-29T00:00:00Z' };
  const prev = { id: 'a1', grade: 'C-', score: 70, completedAt: '2026-06-28T00:00:00Z' };

  it('first audit (no previous) → null deltas, empty resolved/new', () => {
    const d = computeMonitoringDelta(cur, null, ['orphan:X'], []);
    expect(d).toEqual({
      previousAuditId: null, currentAuditId: 'a2', scoreDelta: null,
      gradeFrom: null, gradeTo: 'B', resolvedFixIds: [], newFixIds: [], ranAt: cur.completedAt,
    });
  });

  it('diffs latest vs previous by fix_id (resolved = gone, new = appeared)', () => {
    const d = computeMonitoringDelta(cur, prev, ['orphan:X', 'deep:Y'], ['orphan:X', 'deep:Z']);
    expect(d.scoreDelta).toBe(10);
    expect(d.gradeFrom).toBe('C-');
    expect(d.gradeTo).toBe('B');
    expect(d.resolvedFixIds).toEqual(['deep:Z']); // in prev, gone now
    expect(d.newFixIds).toEqual(['deep:Y']); // appeared now
    expect(d.previousAuditId).toBe('a1');
  });
});

describe('buildFixChecklist', () => {
  const f = (fixId: string, marginalDelta: number, category = 'orphan'): FixRecord => ({ fixId, category, targetTitle: fixId, targetUrl: `u/${fixId}`, marginalDelta });

  it('open (current) + resolved (gone since prev); doneCount = resolved; ordered by impact', () => {
    const current = [f('orphan:X', 5), f('deep:Y', 3, 'deep_page')];
    const previous = [f('orphan:X', 5), f('deep:Z', 2, 'deep_page')];
    const { items, doneCount } = buildFixChecklist(current, previous);
    expect(items).toHaveLength(3);
    expect(doneCount).toBe(1);
    // open first by impact desc, then resolved
    expect(items.map((i) => [i.fixId, i.resolved])).toEqual([
      ['orphan:X', false], ['deep:Y', false], ['deep:Z', true],
    ]);
    expect(items[0]!.label).toBe('Orphan page: orphan:X');
    expect(items[2]!.label).toBe('Buried page: deep:Z');
  });

  it('first audit (no previous) → all open, doneCount 0', () => {
    const { items, doneCount } = buildFixChecklist([f('orphan:X', 5)], []);
    expect(doneCount).toBe(0);
    expect(items.every((i) => !i.resolved)).toBe(true);
  });
});

// ── loader (Pro gating + service-role fixes read, free columns only) ──
const AUDITS = [
  { id: 'a2', url: 'https://a.com/', grade: 'B', score: 80, confidence: 'high', completed_at: '2026-06-29T00:00:00Z', previous_audit_id: 'a1' },
  { id: 'b1', url: 'https://b.com/', grade: 'A', score: 92, confidence: 'medium', completed_at: '2026-06-29T00:00:00Z', previous_audit_id: null },
  { id: 'a1', url: 'https://a.com/', grade: 'C-', score: 70, confidence: 'high', completed_at: '2026-06-28T00:00:00Z', previous_audit_id: null },
];
const FIXES = [
  { audit_id: 'a2', fix_id: 'orphan:X', category: 'orphan', target_title: 'X', target_url: 'u/x', marginal_delta: 5 },
  { audit_id: 'a2', fix_id: 'deep:Y', category: 'deep_page', target_title: 'Y', target_url: 'u/y', marginal_delta: 3 },
  { audit_id: 'a1', fix_id: 'orphan:X', category: 'orphan', target_title: 'X', target_url: 'u/x', marginal_delta: 5 },
  { audit_id: 'a1', fix_id: 'deep:Z', category: 'deep_page', target_title: 'Z', target_url: 'u/z', marginal_delta: 2 },
];

function makeSbUser() {
  return {
    from() {
      const chain: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'or', 'order']) chain[m] = () => chain;
      chain.limit = () => Promise.resolve({ data: AUDITS, error: null });
      return chain;
    },
  };
}
function makeAdmin(capture: { selectArg?: string; inIds?: unknown[] }) {
  return {
    from() {
      return {
        select(arg: string) {
          capture.selectArg = arg;
          return {
            in(_col: string, ids: unknown[]) {
              capture.inIds = ids;
              return Promise.resolve({ data: FIXES, error: null });
            },
          };
        },
      };
    },
  };
}

describe('loadDashboardSites', () => {
  it('groups by URL (latest audit per site), computes the FREE delta, and reads fixes via service role', async () => {
    const capture: { selectArg?: string; inIds?: unknown[] } = {};
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sites = await loadDashboardSites(makeSbUser() as any, makeAdmin(capture) as any, true);
    expect(sites.map((s) => s.siteUrl).sort()).toEqual(['https://a.com/', 'https://b.com/']);
    const a = sites.find((s) => s.siteUrl === 'https://a.com/')!;
    expect(a.latestAuditId).toBe('a2'); // latest, not a1
    expect(a.delta!.scoreDelta).toBe(10);
    expect(a.delta!.resolvedFixIds).toEqual(['deep:Z']);
    expect(a.history.map((h) => h.auditId)).toEqual(['a1', 'a2']); // prev → current
    // fixes read scoped to the user's own audit ids; the gated cure columns are NEVER selected
    expect(new Set(capture.inIds)).toEqual(new Set(['a2', 'a1', 'b1']));
    expect(capture.selectArg).not.toContain('suggested_links');
    expect(capture.selectArg).not.toContain('action_packet_body');
  });

  it('GATES the fixChecklist to Pro: free owner gets delta but null checklist', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const free = await loadDashboardSites(makeSbUser() as any, makeAdmin({}) as any, false);
    const a = free.find((s) => s.siteUrl === 'https://a.com/')!;
    expect(a.fixChecklist).toBeNull();
    expect(a.fixChecklistDoneCount).toBeNull();
    expect(a.delta!.resolvedFixIds).toEqual(['deep:Z']); // delta is FREE — still present

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pro = await loadDashboardSites(makeSbUser() as any, makeAdmin({}) as any, true);
    const ap = pro.find((s) => s.siteUrl === 'https://a.com/')!;
    expect(ap.fixChecklist).toHaveLength(3);
    expect(ap.fixChecklistDoneCount).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SPEC 5.1a Stage 4 — SURFACE 13 of 13: THE DASHBOARD.
//
// The dashboard is where a refusal was most dangerous, because it is the only surface that shows a
// site over TIME. Before this change the loader coerced a withheld verdict with
// `grade: a.grade ?? ''` and `score: asNumber(a.score) ?? 0`, so a refused re-audit did not merely
// look blank — it looked like a COLLAPSE. A site sitting at B+/81.39 that we then declined to grade
// rendered as 0, drew a sparkline diving to the floor, and computed `scoreDelta = 0 - 81.39`, so the
// owner was told "Down 81 points since your last visit — worth a look".
//
// Every part of that is fabricated. We did not measure a decline; we measured nothing and said so.
//
// The boundary here is the DashboardSite[] the server hands the client, so these assert on its
// serialized form.
// ─────────────────────────────────────────────────────────────────────────────

const REFUSED_AUDITS = [
  // The dangerous shape: a graded audit followed by a refused re-audit of the SAME url.
  { id: 'r2', url: 'https://a.com/', grade: null, score: null, confidence: 'low', completed_at: '2026-08-04T00:00:00Z', previous_audit_id: 'r1' },
  { id: 'r1', url: 'https://a.com/', grade: 'B+', score: 81.39, confidence: 'high', completed_at: '2026-08-03T00:00:00Z', previous_audit_id: null },
];

function makeSbUserWith(rows: unknown[]) {
  return {
    from() {
      const chain: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'or', 'order']) chain[m] = () => chain;
      chain.limit = () => Promise.resolve({ data: rows, error: null });
      return chain;
    },
  };
}

describe('SURFACE 13 — the dashboard never turns a withheld verdict into a collapse', () => {
  it('carries NULL for a refused audit, never 0 and never an empty-string grade', async () => {
    const sites = await loadDashboardSites(
      makeSbUserWith(REFUSED_AUDITS) as never,
      makeAdmin({}) as never,
      true,
    );
    const site = sites[0]!;
    expect(site.currentScore).toBeNull();
    expect(site.currentGrade).toBeNull();
    // 0 renders as F on the gauge, and '' renders as a blank verdict rather than an absent one.
    expect(site.currentScore).not.toBe(0);
    expect(site.currentGrade).not.toBe('');
  });

  it('THE FABRICATED COLLAPSE: reports NO score delta from a graded audit to a refused one', async () => {
    const sites = await loadDashboardSites(
      makeSbUserWith(REFUSED_AUDITS) as never,
      makeAdmin({}) as never,
      true,
    );
    const delta = sites[0]!.delta!;
    // The coercion computed 0 - 81.39 = -81.39 and rendered "Down 81 points since your last visit".
    expect(delta.scoreDelta).toBeNull();
    expect(delta.scoreDelta).not.toBe(-81.39);
    expect(delta.gradeFrom).toBe('B+');
    expect(delta.gradeTo).toBeNull();
  });

  it('keeps the refused point out of the sparkline as NULL, not as a dive to the floor', async () => {
    const sites = await loadDashboardSites(
      makeSbUserWith(REFUSED_AUDITS) as never,
      makeAdmin({}) as never,
      true,
    );
    const history = sites[0]!.history;
    expect(history.map((h) => h.auditId)).toEqual(['r1', 'r2']);
    expect(history[0]!.score).toBe(81.39);
    expect(history[1]!.score).toBeNull();
    expect(history[1]!.grade).toBeNull();
  });

  it('the serialized payload for a refused site carries no letter and no number', async () => {
    const sites = await loadDashboardSites(
      makeSbUserWith([REFUSED_AUDITS[0]]) as never,
      makeAdmin({}) as never,
      true,
    );
    const serialized = JSON.stringify({
      currentGrade: sites[0]!.currentGrade,
      currentScore: sites[0]!.currentScore,
      gradeTo: sites[0]!.delta?.gradeTo ?? null,
    });
    expect(serialized).toBe('{"currentGrade":null,"currentScore":null,"gradeTo":null}');
    expect(serialized).not.toMatch(/\d/);
  });

  it('still reports a real delta between two graded audits — the negative control', async () => {
    // Without this the assertions above would also pass on a loader that nulled everything.
    const sites = await loadDashboardSites(makeSbUser() as never, makeAdmin({}) as never, true);
    const a = sites.find((s) => s.siteUrl === 'https://a.com/')!;
    expect(a.currentGrade).toBe('B');
    expect(a.currentScore).toBe(80);
    expect(a.delta!.scoreDelta).toBe(10);
  });
});
