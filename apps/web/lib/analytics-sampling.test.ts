import { describe, it, expect } from 'vitest';
import { shouldSendEvent, AUTOCAPTURE_SAMPLE_RATE } from './analytics-sampling';

describe('shouldSendEvent', () => {
  it('always keeps named funnel events regardless of the sample roll', () => {
    expect(shouldSendEvent('audit-submitted', 0.999)).toBe(true);
    expect(shouldSendEvent('pro-upgrade', 0.999)).toBe(true);
    expect(shouldSendEvent('$pageview', 0.999)).toBe(true);
  });

  it('samples high-volume autocapture/pageleave at the configured rate (boundary)', () => {
    expect(shouldSendEvent('$autocapture', 0.05)).toBe(true); // under 0.10 → kept
    expect(shouldSendEvent('$autocapture', 0.5)).toBe(false); // over 0.10 → dropped
    expect(shouldSendEvent('$pageleave', 0.5)).toBe(false);
    // Exactly at the rate is dropped (strict `<`), so the boundary is deterministic.
    expect(shouldSendEvent('$autocapture', AUTOCAPTURE_SAMPLE_RATE)).toBe(false);
    expect(shouldSendEvent('$autocapture', AUTOCAPTURE_SAMPLE_RATE - 0.0001)).toBe(true);
  });

  it('keeps unknown custom events (only the explicit noisy set is sampled)', () => {
    expect(shouldSendEvent('some-custom-event', 0.999)).toBe(true);
  });
});
