import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => {}, refresh: () => {} }) }));
vi.mock('@/lib/analytics', () => ({ trackRaw: () => {}, track: () => {} }));

import { SiteCard } from './SiteCard';
import { firstRunSite, freeOwnerSite, proOwnerSite, proRegressedSite } from './__fixtures__/dashboard';
import type { SiteReportSettings } from '@/lib/dashboard-report-settings';
import { computeMonitoringDelta } from '@/lib/dashboard';

const PRO_SETTINGS: SiteReportSettings = { slug: 'slug-abc', claimed: true, listed: true, indexable: true, whiteLabel: null, canWhiteLabel: true };

describe('SiteCard', () => {
  it('pro owner, improved: compact gauge + warm delta + sparkline/span + open loop + re-audit', () => {
    const html = renderToStaticMarkup(<SiteCard site={proOwnerSite} />);
    expect(html).toContain('yourshop.com');
    expect(html).toContain('aria-label="Grade B, 81 out of 100"'); // compact gauge (cross-surface object)
    expect(html).toContain('▲');
    expect(html).toContain('Your fixes are working'); // warm, feels-known copy
    expect(html).toContain('up 12 points');
    expect(html).toContain('<polyline'); // grade-over-time sparkline
    expect(html).toContain('over 25 days'); // time anchor
    expect(html).toContain('4 of 7 fixes done'); // Pro-owner fix checklist
    expect(html).toContain('3 to go');
    expect(html).toContain('Re-audit');
  });

  // SPEC 04.2 FIX 3 — a non-ASCII audited site URL decodes for display on the dashboard (never raw "%e0…").
  it('decodes a non-ASCII audited site URL for display', () => {
    const enc = 'https://shop.example/%e0%a6%ac%e0%a6%be';
    const html = renderToStaticMarkup(<SiteCard site={{ ...proOwnerSite, siteUrl: enc }} />);
    expect(html).toContain(decodeURIComponent(enc));
    expect(html).not.toContain('%e0%a6');
  });

  it('pro owner, regressed: downward delta with a supportive nudge', () => {
    const html = renderToStaticMarkup(<SiteCard site={proRegressedSite} />);
    expect(html).toContain('▼');
    expect(html).toContain('worth a look');
    expect(html).toContain('1 of 6 fixes done');
  });

  it('free signed-in owner: grade + delta shown, but the fix checklist is Pro-gated (upgrade path)', () => {
    const html = renderToStaticMarkup(<SiteCard site={freeOwnerSite} />);
    expect(html).toContain('blog.example');
    expect(html).toContain('Your fixes are working'); // delta is FREE — still shown to the owner
    expect(html).not.toContain('fixes done'); // the checklist itself is gated
    expect(html).toContain('Track which fixes are done with'); // the upsell copy
    expect(html).toContain('Pro');
  });

  it('first audit: no delta, first-audit hint', () => {
    const html = renderToStaticMarkup(<SiteCard site={firstRunSite} />);
    expect(html).toContain('First audit');
    expect(html).not.toContain('since your last visit');
  });

  it('shows when the site was last audited (personalization payoff) with an absolute UTC hover title', () => {
    const html = renderToStaticMarkup(<SiteCard site={proOwnerSite} />);
    // The label is always present for a valid timestamp; the exact relative value is time-dependent and
    // unit-tested in dashboard-logic. The hover title is the deterministic absolute (UTC) timestamp.
    expect(html).toContain('Audited ');
    expect(html).toContain('title="Jun 26, 2026'); // latest history point ranAt 2026-06-26T09:00Z
  });

  it('first-audit card still shows a last-audited time (history present even with no delta)', () => {
    const html = renderToStaticMarkup(<SiteCard site={firstRunSite} />);
    expect(html).toContain('Audited ');
  });
});

// U6 — the dashboard is the durable home for report branding + visibility. A claimed, owned site exposes
// the SAME controls as the /r/ island (via OwnerControls); an unclaimed/unowned site does not.
describe('SiteCard — report settings (U6)', () => {
  it('a claimed report owned by a Pro user exposes report-branding + visibility settings', () => {
    const html = renderToStaticMarkup(<SiteCard site={proOwnerSite} reportSettings={PRO_SETTINGS} />);
    expect(html).toContain('Report settings');
    expect(html).toContain('Your branding'); // white-label control (editable for Pro)
    expect(html).toContain('name="brandName"');
    expect(html).toMatch(/listed on leaderboards/i); // visibility controls
  });

  it('without report settings (unclaimed / not owned) → no branding area', () => {
    const html = renderToStaticMarkup(<SiteCard site={proOwnerSite} />);
    expect(html).not.toContain('Report settings');
    expect(html).not.toContain('Your branding');
  });

  it('a claimed report owned by a FREE user shows the LOCKED white-label upsell + visibility', () => {
    const html = renderToStaticMarkup(<SiteCard site={proOwnerSite} reportSettings={{ ...PRO_SETTINGS, canWhiteLabel: false }} />);
    expect(html).toContain('Report settings');
    expect(html).toMatch(/upgrade to pro/i);
    expect(html).not.toContain('name="brandName"'); // locked — no editable input for a free owner
    expect(html).toMatch(/listed on leaderboards/i); // visibility is not Pro-gated
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GATE 4 / B1 — "No grade → C" on a site that has only ever been audited once.
//
// `ebadb63` changed this fallback from '—' to 'No grade'. In SPEC 5.1a's vocabulary NO_GRADE_LABEL
// means exactly one thing: WE DECLINED TO PUBLISH A VERDICT. But `gradeFrom` is null in TWO cases and
// only one of them is a refusal — `computeMonitoringDelta(current, null, …)` returns `gradeFrom: null`
// when there is NO PREVIOUS AUDIT AT ALL, and `loadDashboardSites` assigns that object
// unconditionally, so `DashboardSite.delta` is never null in production.
//
// Measured on production the day it was found: 20 dashboard cards, 19 with `previous_audit_id IS
// NULL` and a non-null grade → 19 of 20 rendered "No grade → <letter> ■", telling almost every user
// we had refused them last time, with the flat no-change glyph beside it.
//
// AND THE CORRECT COPY WAS UNREACHABLE. "First audit — re-audit later" was gated on `site.delta`
// being falsy, a shape the loader cannot produce; the only thing that ever reached it was a fixture.
// The old test passed green on that fixture — a component test proving a state the product never
// enters, which is the same class as the gate-3 defect, reproduced inside the fix for gate 3.
//
// So this builds the delta with THE LOADER'S OWN FUNCTION rather than by hand.
// ─────────────────────────────────────────────────────────────────────────────
describe('B1 — a first-ever audit is not a withheld verdict', () => {
  const loaderShapedFirstAudit = () => ({
    ...firstRunSite,
    // The loader sets this from the ROW: `cur.previous_audit_id != null`. A genuine first audit has
    // none, so it is false — the only state in which "First audit" is a true sentence.
    hasPredecessor: false,
    // Exactly what loadDashboardSites assigns: computeMonitoringDelta with previous = null.
    delta: computeMonitoringDelta(
      { id: 'aud-current', grade: 'C', score: 68, completedAt: '2026-06-25T00:00:00.000Z' },
      null,
      [],
      [],
    ),
  });

  it('the loader really does emit a non-null delta for a first audit — the fixture is not the point', () => {
    // Anti-vacuity: if this were ever null the whole defect would be unreachable and the assertions
    // below would prove nothing.
    const delta = loaderShapedFirstAudit().delta;
    expect(delta).not.toBeNull();
    expect(delta!.previousAuditId).toBeNull();
    expect(delta!.gradeFrom).toBeNull();
  });

  it('renders the first-audit hint, not a delta badge', () => {
    const html = renderToStaticMarkup(<SiteCard site={loaderShapedFirstAudit()} />);
    expect(html).toContain('First audit');
  });

  it('never claims we withheld a verdict we were never asked for', () => {
    const html = renderToStaticMarkup(<SiteCard site={loaderShapedFirstAudit()} />);
    // The exact string 19 of 20 live cards rendered.
    expect(html).not.toContain('No grade →');
    // ...and no arrow glyph either: there is no movement to report.
    for (const arrow of ['▲', '▼', '■']) expect(html).not.toContain(arrow);
  });

  it('still shows the delta badge when there IS a previous audit — the negative control', () => {
    const html = renderToStaticMarkup(<SiteCard site={proOwnerSite} />);
    expect(html).toContain('▲');
  });

  it('still says "No grade" when the PREVIOUS audit was genuinely refused', () => {
    // The case the label was introduced for, and which must survive the fix: a real prior audit whose
    // verdict we withheld. previousAuditId is set; gradeFrom is null because that audit had no letter.
    const refusedPrevious = {
      ...proOwnerSite,
      delta: {
        ...computeMonitoringDelta(
          { id: 'aud-current', grade: 'C', score: 68, completedAt: '2026-06-25T00:00:00.000Z' },
          { id: 'aud-prev', grade: null, score: null, completedAt: '2026-06-01T00:00:00.000Z' },
          [],
          [],
        ),
      },
    };
    expect(refusedPrevious.delta.previousAuditId).toBe('aud-prev');
    const html = renderToStaticMarkup(<SiteCard site={refusedPrevious} />);
    expect(html).toContain('No grade');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GATE 4 / W7c — "Holding steady since your last visit", about a run we never measured.
//
// `computeMonitoringDelta` correctly returns `scoreDelta: null` when either side has no verdict, and
// `deltaSentence` correctly returns nothing for null. Only those two PURE halves were pinned. The
// RENDERER — the site the commit message itself names as the defect ("SiteCard re-coerced it with
// ?? 0") — had no behavioural test at all, and `SiteCard.test.tsx` contained no refusal fixture:
// no `currentGrade: null`, no `scoreDelta: null`, no `gradeFrom: null`. So re-fabricating the
// sentence through a ternary — a KNOWN EVASION the guard documents — left the suite green.
//
// It is the mirror of the "Down 81 points since your last visit" fabrication, sign flipped, and it
// lands on the recovery moment: the payoff for a re-audit reads as nothing happened.
// ─────────────────────────────────────────────────────────────────────────────
describe('W7c — an unmeasured comparison produces NO sentence, by any route', () => {
  const previousWasRefused = () => ({
    ...proOwnerSite,
    delta: computeMonitoringDelta(
      { id: 'aud-current', grade: 'C', score: 68, completedAt: '2026-06-25T00:00:00.000Z' },
      { id: 'aud-prev', grade: null, score: null, completedAt: '2026-06-01T00:00:00.000Z' },
      [],
      [],
    ),
  });

  it('the loader really yields a null scoreDelta here — otherwise this proves nothing', () => {
    const d = previousWasRefused().delta;
    expect(d.scoreDelta).toBeNull();
    expect(d.previousAuditId).toBe('aud-prev');
  });

  it('renders no change sentence at all — not "Holding steady", not a direction', () => {
    const html = renderToStaticMarkup(<SiteCard site={previousWasRefused()} />);
    expect(html).not.toContain('Holding steady');
    expect(html).not.toContain('since your last visit');
    expect(html).not.toContain('worth a look');
    expect(html).not.toContain('Your fixes are working');
  });

  it('a MEASURED zero still says "Holding steady" — the sentence is withheld, not deleted', () => {
    // The distinction the whole finding rests on: absent is not the same as zero. A real
    // no-change comparison is information and must survive.
    const measuredZero = {
      ...proOwnerSite,
      delta: computeMonitoringDelta(
        { id: 'aud-current', grade: 'B', score: 81, completedAt: '2026-06-25T00:00:00.000Z' },
        { id: 'aud-prev', grade: 'B', score: 81, completedAt: '2026-06-01T00:00:00.000Z' },
        [],
        [],
      ),
    };
    expect(measuredZero.delta.scoreDelta).toBe(0);
    expect(renderToStaticMarkup(<SiteCard site={measuredZero} />)).toContain('Holding steady');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GATE 5 / R1-NB6 — the B1 fix made the first-audit branch reachable, and this is the one state that
// reaches it WRONGLY. `loadDashboardSites` resolves `prev` from a loaded window, so a predecessor
// that expired, never completed, or fell past the row limit yields `previousAuditId: null` on a site
// the owner has audited many times — which then reads "First audit — re-audit later to watch it
// change." Existing is a different question from loaded, and only the row can answer it.
// ─────────────────────────────────────────────────────────────────────────────
describe('R1-NB6 — a predecessor outside the loaded window is not a first audit', () => {
  const outsideWindow = {
    ...firstRunSite,
    // Exactly what the loader emits when `previous_audit_id` is set but `byId` cannot resolve it.
    hasPredecessor: true,
    delta: computeMonitoringDelta(
      { id: 'aud-current', grade: 'C', score: 68, completedAt: '2026-06-25T00:00:00.000Z' },
      null,
      [],
      [],
    ),
  };

  it('renders NOTHING about the comparison — asserted on what it DOES say, not only what it does not', () => {
    // Gate 6 / B6-1: the first version of this test asserted only `not.toContain('First audit')` and
    // never asked what the card said instead. It said "No grade → C ■" — gate 4 / B1's exact output,
    // produced by the fix for gate 5's finding about gate 4's B1. So this asserts the positive.
    expect(outsideWindow.delta.previousAuditId).toBeNull(); // the ambiguous signal
    const html = renderToStaticMarkup(<SiteCard site={outsideWindow} />);
    expect(html).not.toContain('First audit');
    expect(html).not.toContain('No grade →');
    expect(html).not.toContain('No grade');
    for (const arrow of ['▲', '▼', '■']) expect(html).not.toContain(arrow);
    expect(html).not.toContain('since your last visit');
    expect(html).not.toContain('Holding steady');
    // The card still renders — the silence is about the COMPARISON, not the site.
    expect(html).toContain('newsite.example');
    expect(html).toContain('aria-label="Grade C');
  });

  it('still renders the badge when the predecessor WAS loaded but was itself refused', () => {
    // The case NO_GRADE_LABEL exists for, and the reason `gradeFrom != null` would be the wrong gate:
    // a loaded predecessor with a withheld verdict has a null gradeFrom and a REAL previousAuditId.
    const refusedPredecessor = {
      ...outsideWindow,
      hasPredecessor: true,
      delta: computeMonitoringDelta(
        { id: 'aud-current', grade: 'C', score: 68, completedAt: '2026-06-25T00:00:00.000Z' },
        { id: 'aud-prev', grade: null, score: null, completedAt: '2026-06-01T00:00:00.000Z' },
        [],
        [],
      ),
    };
    expect(refusedPredecessor.delta.previousAuditId).toBe('aud-prev');
    expect(refusedPredecessor.delta.gradeFrom).toBeNull();
    expect(renderToStaticMarkup(<SiteCard site={refusedPredecessor} />)).toContain('No grade');
  });

  it('still shows the first-audit hint when there genuinely is no predecessor', () => {
    const genuine = { ...outsideWindow, hasPredecessor: false };
    expect(renderToStaticMarkup(<SiteCard site={genuine} />)).toContain('First audit');
  });

  it('an older payload with no flag renders neutral, never an invented comparison', () => {
    // Absent `hasPredecessor` means UNKNOWN. Neither claim is available, so neither is made.
    const legacy = { ...outsideWindow, hasPredecessor: undefined };
    const html = renderToStaticMarkup(<SiteCard site={legacy} />);
    expect(html).not.toContain('First audit');
    expect(html).not.toContain('No grade');
  });
});
