import { describe, it, expect } from 'vitest';
import {
  FRONTIER_ROUND_BUDGET_MS,
  NAVIGATION_TIMEOUT_SECS,
  FRONTIER_BATCH_SIZE,
  NO_EVIDENCE_COMPONENT_CEILING,
} from './constants.js';

// ─────────────────────────────────────────────────────────────────────────────
// CROSS-CONSTANT INVARIANTS.
//
// These pin RELATIONSHIPS BETWEEN constants, not their values. A constant can be tuned freely; a
// relationship that another mechanism silently depends on cannot, and the failure mode when one is
// broken is invisible — nothing throws, a number just quietly becomes less true.
//
// Each invariant here exists because breaking it cost something real, and each is stated as the
// consequence rather than as the comparison.
// ─────────────────────────────────────────────────────────────────────────────

describe('cross-constant invariants', () => {
  it('gives a stalled request time to be RECORDED before its round is cut', () => {
    // THE COLLISION THIS EXISTS TO PREVENT, measured on info.cern.ch: with the round budget set equal
    // to the navigation timeout (both 30s), the two clocks raced and the round clock won. A stalled URL
    // was torn down at exactly the moment it would otherwise have timed out and been recorded as a
    // failed fetch, so the crawl-health block rate collapsed from 14% to 0% — the crawl reported a
    // cleaner host than it had actually found.
    //
    // That matters beyond cosmetics: the refusal gate reads `fetchedOk` and the block rate to decide
    // whether we know enough to assert a grade at all. A block rate that understates host deadness
    // feeds a refusal gate that under-refuses.
    //
    // So the round budget must be STRICTLY GREATER than one navigation timeout. This is a constraint,
    // not a coincidence: if `NAVIGATION_TIMEOUT_SECS` is ever raised, this test must break the build
    // rather than let recorded-dead-fetch honesty silently disappear again.
    expect(FRONTIER_ROUND_BUDGET_MS).toBeGreaterThan(NAVIGATION_TIMEOUT_SECS * 1000);
  });

  it('lets a healthy round of the full batch size finish well inside its budget', () => {
    // The round clock is meant to cut PATHOLOGICAL rounds, never healthy ones. A measured healthy round
    // of 23 pages on a genuinely slow 1990s server took 7.2s, so a full batch has to fit inside the
    // round budget with real headroom or the clock would start truncating ordinary crawls — which would
    // strand a batch per round and shrink every sample.
    //
    // Pinned as a floor of 1s per page across the batch, which is ~4x slower than the slowest healthy
    // round actually observed.
    const slowestHealthyRoundMs = FRONTIER_BATCH_SIZE * 1000;
    expect(FRONTIER_ROUND_BUDGET_MS).toBeGreaterThanOrEqual(slowestHealthyRoundMs);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// M8 — the absence-of-evidence ceiling, pinned to its VALUE.
// A gate reviewer moved it from 0.5 to 0.89 and all 826 engine tests stayed green: the only
// assertion was `< NEAR_MAXIMUM (0.9)`, which pins it to within 0.4 of itself. The ceiling is the
// number that stops a component scoring full marks precisely because there was nothing to measure,
// so "somewhere below 0.9" is not a specification.
// ─────────────────────────────────────────────────────────────────────────────
describe('the absence-of-evidence ceiling is pinned to its value, not to a range', () => {
  it('is exactly 0.5 — a HALF, chosen so an unmeasured component cannot read as a good one', () => {
    expect(NO_EVIDENCE_COMPONENT_CEILING).toBe(0.5);
  });

  it('sits below the midpoint of the scale, which is the property that makes it a ceiling', () => {
    // Stated as a property too, so a deliberate future change has to break BOTH the value and the
    // reasoning rather than sliding past a loose bound.
    expect(NO_EVIDENCE_COMPONENT_CEILING).toBeGreaterThan(0);
    expect(NO_EVIDENCE_COMPONENT_CEILING).toBeLessThanOrEqual(0.5);
  });
});
