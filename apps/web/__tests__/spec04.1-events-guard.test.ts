import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// SPEC 04.1 §7 — the four viral-loop owner events were defined in SPEC 04 but never fired (no UI POSTed
// to their routes). This phase's controls ARE that UI, so they must now fire — from a real track() call,
// using the exact analytics-events.ts names (a typo would also fail typecheck against FunnelEvent). This
// guard pins the wiring so a future refactor can't silently un-fire them. FAILS LOUD (ENOENT) on rename.
const read = (rel: string) => readFileSync(resolve(__dirname, '..', rel), 'utf8');
// track(...) with the event literal in the SAME call (not merely in a comment); tolerant of a ternary.
const fires = (src: string, event: string) => new RegExp(`track\\([^)]*'${event}'`).test(src);

describe('SPEC 04.1 §7 — the four viral-loop owner events now fire from the new UI', () => {
  it('report_claimed fires on a successful claim', () => {
    expect(fires(read('components/report/owner/ClaimControl.tsx'), 'report_claimed')).toBe(true);
  });

  it('whitelabel_enabled fires on the OFF→ON white-label transition', () => {
    expect(fires(read('components/report/owner/WhiteLabelControls.tsx'), 'whitelabel_enabled')).toBe(true);
  });

  it('the visibility toggle fires the edge-mapped leaderboard_opt_in / report_hidden; the keep-public prompt opts in', () => {
    // The listed toggle fires track(visibilityEvent(next)) — the edge→event mapping is unit-tested in
    // owner-controls-logic.test.ts (both edges), which the guard cannot verify from source text alone.
    expect(read('components/report/owner/VisibilityControls.tsx')).toMatch(/track\(\s*visibilityEvent\(/);
    const logic = read('components/report/owner/owner-controls-logic.ts');
    expect(logic).toContain("'leaderboard_opt_in'");
    expect(logic).toContain("'report_hidden'");
    expect(fires(read('components/report/owner/WhiteLabelVisibilityPrompt.tsx'), 'leaderboard_opt_in')).toBe(true);
  });

  it('all four names are declared in the funnel (no ad-hoc event schema)', () => {
    const events = read('lib/analytics-events.ts');
    for (const e of ['report_claimed', 'whitelabel_enabled', 'leaderboard_opt_in', 'report_hidden']) {
      expect(events).toContain(`'${e}'`);
    }
  });
});
