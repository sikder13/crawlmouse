import { describe, it, expect } from 'vitest';
import { viewStateFrom } from './owner-controls-logic';

// SPEC 04.1 §2 — the island view derives from the probe (R2) AND the report's PUBLIC claimed state (so
// the claim CTA never appears on someone else's already-claimed report, and the SSR stays owner-agnostic
// — reportClaimed is a public fact, not session data, U10):
//  - verified owner        → ownerControls (claimed) / finishClaim (not yet claimed)
//  - non-owner, unclaimed  → claimCta (the conversion hook)
//  - non-owner, claimed    → hidden (it already has an owner)
//  - pre-hydration (null)  → loading (unclaimed → claim entry) / hidden (claimed → nothing)
describe('viewStateFrom', () => {
  it('null probe on an UNCLAIMED report → loading (renders the claim entry)', () => {
    expect(viewStateFrom(null, false)).toBe('loading');
  });

  it('null probe on a CLAIMED report → hidden (no claim CTA over someone else’s report)', () => {
    expect(viewStateFrom(null, true)).toBe('hidden');
  });

  it('non-owner on an unclaimed report → claimCta', () => {
    expect(viewStateFrom({ owned: false }, false)).toBe('claimCta');
  });

  it('non-owner on a claimed report → hidden', () => {
    expect(viewStateFrom({ owned: false }, true)).toBe('hidden');
  });

  it('verified owner, report not yet claimed → finishClaim', () => {
    expect(viewStateFrom({ owned: true, claimed: false, canWhiteLabel: true }, false)).toBe('finishClaim');
  });

  it('verified owner of a claimed report → ownerControls (regardless of the public flag)', () => {
    expect(viewStateFrom({ owned: true, claimed: true, canWhiteLabel: false }, true)).toBe('ownerControls');
  });
});
