import { describe, it, expect } from 'vitest';
import { shouldSendEvent, AUTOCAPTURE_SAMPLE_RATE } from './analytics-sampling';
import { FUNNEL_EVENTS } from './analytics-events';

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

  // PostHog person-properties events ride the funnel allow-list too; pin them so a refactor of
  // ALWAYS_KEEP can't silently start sampling identity payloads.
  it('always keeps $identify and $set', () => {
    expect(shouldSendEvent('$identify', 0.999)).toBe(true);
    expect(shouldSendEvent('$set', 0.999)).toBe(true);
  });
});

describe('FUNNEL_EVENTS list-drift lock', () => {
  it('has exactly the 32 funnel events (7 launch + 9 conversion-spine + 10 SPEC 04 viral loop + 6 SPEC 05 AI) with no duplicates', () => {
    expect(FUNNEL_EVENTS.length).toBe(32);
    expect(new Set(FUNNEL_EVENTS).size).toBe(32);
    // the SPEC 02 conversion-spine cohort is present (snake_case, distinct from the kebab launch ones)
    for (const e of ['grade_revealed', 'gap_viewed', 'free_fix_viewed', 'action_packet_copied', 'wall_viewed', 'upgrade_clicked', 'checkout_started', 'reaudit_clicked', 'delta_viewed']) {
      expect(FUNNEL_EVENTS).toContain(e);
    }
    // the SPEC 04 viral-loop cohort is present
    for (const e of ['report_minted', 'report_claimed', 'report_hidden', 'whitelabel_enabled', 'report_pdf_printed', 'share_completed', 'compare_viewed', 'leaderboard_opt_in', 'activity_feed_first_event', 'referral_landing']) {
      expect(FUNNEL_EVENTS).toContain(e);
    }
    // SPEC 05 AI/agent-readiness cohort (§14)
    for (const e of ['ai_score_revealed', 'ai_homepage_view_opened', 'ai_whataisees_opened', 'ai_packet_copied', 'llms_txt_generated', 'ai_finding_expanded']) {
      expect(FUNNEL_EVENTS).toContain(e);
    }
  });

  it('keeps every funnel event regardless of the sample roll (all in ALWAYS_KEEP)', () => {
    // The worst-case roll (just under 1) must never drop a funnel event — proves each member is in
    // the allow-list, so the cost-control sampler can never silently discard launch funnel data.
    for (const event of FUNNEL_EVENTS) {
      expect(shouldSendEvent(event, 0.999)).toBe(true);
    }
  });
});
