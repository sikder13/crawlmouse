import { describe, it, expect } from 'vitest';
import { FUNNEL_EVENTS } from './analytics-events';
import { shouldSendEvent } from './analytics-sampling';

// SPEC 04 §13 — the viral-loop observability event set is part of the ONE funnel. Adding them to
// FUNNEL_EVENTS both types `track()` for them and (via analytics-sampling's ALWAYS_KEEP spread) keeps
// them from ever being dropped by the cost-control sampler.
const SPEC04_EVENTS = [
  'report_minted',
  'report_claimed',
  'report_hidden',
  'whitelabel_enabled',
  'report_pdf_printed',
  'share_completed',
  'compare_viewed',
  'leaderboard_opt_in',
  'activity_feed_first_event',
  'referral_landing',
] as const;

describe('SPEC 04 §13 funnel events', () => {
  it('are all registered in FUNNEL_EVENTS', () => {
    for (const e of SPEC04_EVENTS) expect(FUNNEL_EVENTS).toContain(e);
  });

  it('are always kept by the cost-control sampler (never dropped)', () => {
    for (const e of SPEC04_EVENTS) expect(shouldSendEvent(e, 0.999)).toBe(true);
  });

  it('reuses the existing email-captured event for the wait valve (no duplicate funnel event)', () => {
    expect(FUNNEL_EVENTS).toContain('email-captured');
    expect(FUNNEL_EVENTS).not.toContain('wait_email_captured');
  });
});
