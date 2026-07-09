import { describe, it, expect } from 'vitest';
import { viewStateFrom } from './owner-controls-logic';

// SPEC 04.1 §2 — the owner island's view state derives ENTIRELY from the probe (R2). Pre-hydration the
// probe is null → 'loading' (rendered owner-agnostic, U10). Non-owner → the claim CTA. A verified owner
// whose report isn't claimed yet → 'finishClaim' (one-tap POST /claim on return from verification).
// A verified owner of a claimed report → the full owner controls.
describe('viewStateFrom', () => {
  it('null probe (pre-hydration) → loading', () => {
    expect(viewStateFrom(null)).toBe('loading');
  });

  it('anon / non-owner → claimCta', () => {
    expect(viewStateFrom({ owned: false })).toBe('claimCta');
  });

  it('verified owner, report not yet claimed → finishClaim', () => {
    expect(viewStateFrom({ owned: true, claimed: false, canWhiteLabel: true })).toBe('finishClaim');
  });

  it('verified owner of a claimed report → ownerControls', () => {
    expect(viewStateFrom({ owned: true, claimed: true, canWhiteLabel: false })).toBe('ownerControls');
  });
});
