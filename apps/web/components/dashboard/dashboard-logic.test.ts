import { describe, it, expect } from 'vitest';
import {
  checklistRemaining,
  deltaArrow,
  deltaDirection,
  deltaSentence,
  absoluteTime,
  historySpanLabel,
  reauditEffects,
  reauditOutcome,
  reauditTargetId,
  relativeTime,
  sparklinePoints,
} from './dashboard-logic';

describe('dashboard-logic', () => {
  it('deltaDirection: positive up, negative down, zero flat', () => {
    expect(deltaDirection(6)).toBe('up');
    expect(deltaDirection(-4)).toBe('down');
    expect(deltaDirection(0)).toBe('flat');
  });

  it('deltaArrow maps direction to a glyph', () => {
    expect(deltaArrow('up')).toBe('▲');
    expect(deltaArrow('down')).toBe('▼');
    expect(deltaArrow('flat')).toBe('■');
  });

  it('sparklinePoints: empty → "", single → one point, multi → inverted-y points', () => {
    expect(sparklinePoints([], 100, 20)).toBe('');
    expect(sparklinePoints([100], 100, 20)).toBe('0,0.0'); // score 100 → top (y=0)
    const pts = sparklinePoints([0, 50, 100], 100, 20);
    expect(pts).toBe('0.0,20.0 50.0,10.0 100.0,0.0'); // 0→bottom, 50→middle, 100→top
  });

  it('checklistRemaining = total − done, never negative', () => {
    expect(checklistRemaining(3, 7)).toBe(4);
    expect(checklistRemaining(7, 7)).toBe(0);
    expect(checklistRemaining(9, 7)).toBe(0);
  });

  it('historySpanLabel: null under 2 points; days, then months', () => {
    expect(historySpanLabel([{ ranAt: '2026-06-01T00:00:00.000Z' }])).toBeNull();
    expect(
      historySpanLabel([{ ranAt: '2026-06-01T00:00:00.000Z' }, { ranAt: '2026-06-26T00:00:00.000Z' }]),
    ).toBe('over 25 days');
    expect(
      historySpanLabel([{ ranAt: '2026-01-01T00:00:00.000Z' }, { ranAt: '2026-04-01T00:00:00.000Z' }]),
    ).toBe('over 3 months');
  });

  it('deltaSentence: warm + feeling-known, direction-aware; rounds floats; sub-0.5 → steady', () => {
    expect(deltaSentence(12)).toContain('Your fixes are working');
    expect(deltaSentence(12)).toContain('up 12 points');
    expect(deltaSentence(-8)).toContain('worth a look');
    expect(deltaSentence(null)).toContain('Holding steady');
    // 2-decimal engine floats are rounded for display (regression-lock for the round-2 fix):
    expect(deltaSentence(12.43)).toContain('up 12 points');
    expect(deltaSentence(12.43)).not.toContain('12.43');
    expect(deltaSentence(1.4)).toContain('up 1 point'); // singular boundary
    expect(deltaSentence(-8.34)).toContain('Down 8 points');
    // sub-0.5 movement reads "Holding steady", never "up 0 points":
    expect(deltaSentence(0.3)).toContain('Holding steady');
    expect(deltaSentence(0.3)).not.toContain('up 0');
  });

  it('reauditTargetId reads ReauditResponse.newAuditId (v1.2), else null', () => {
    expect(reauditTargetId({ newAuditId: 'new-123' })).toBe('new-123');
    expect(reauditTargetId({})).toBeNull();
  });

  describe('reauditOutcome — surface non-200s instead of silently no-opping', () => {
    it('200 with a newAuditId → navigate to the new audit', () => {
      expect(reauditOutcome(true, { newAuditId: 'new-9' })).toEqual({ kind: 'navigate', auditId: 'new-9' });
    });

    it('200 without a newAuditId → a surfaced error (never a silent no-op)', () => {
      expect(reauditOutcome(true, {})).toEqual({ kind: 'error', message: 'Something went wrong' });
    });

    it('429 captcha_required → the captcha flow (mirrors the /start form)', () => {
      expect(reauditOutcome(false, { error: 'captcha_required', resetAt: 'x' })).toEqual({
        kind: 'captcha',
        message: expect.stringContaining('confirm you’re human'),
      });
    });

    it('non-200 with a human message → that message is surfaced verbatim', () => {
      expect(reauditOutcome(false, { error: 'We’re at capacity right now — please try again tomorrow.' })).toEqual({
        kind: 'error',
        message: 'We’re at capacity right now — please try again tomorrow.',
      });
    });

    it('non-200 with no usable body → a generic error, still surfaced (never silent)', () => {
      expect(reauditOutcome(false, {})).toEqual({ kind: 'error', message: 'Something went wrong' });
      expect(reauditOutcome(false, null)).toEqual({ kind: 'error', message: 'Something went wrong' });
    });
  });

  describe('reauditEffects — reset the one-time token on EVERY non-navigate outcome (no reuse loop)', () => {
    it('navigate → go to the new audit (no token reset)', () => {
      expect(reauditEffects({ kind: 'navigate', auditId: 'n1' })).toEqual({ navigateTo: 'n1' });
    });
    it('captcha → reset the token, show the widget, surface the message', () => {
      expect(reauditEffects({ kind: 'captcha', message: 'x' })).toEqual({ resetToken: true, showCaptcha: true, error: 'x' });
    });
    it('error → reset the token (a stale token is never reused) with no widget', () => {
      expect(reauditEffects({ kind: 'error', message: 'y' })).toEqual({ resetToken: true, showCaptcha: false, error: 'y' });
    });
  });

  describe('relativeTime — friendly "audited N ago", absolute date when old', () => {
    const now = new Date('2026-06-30T12:00:00.000Z');
    it('empty / unparseable → "" (so the card renders nothing rather than "Invalid Date")', () => {
      expect(relativeTime('', now)).toBe('');
      expect(relativeTime('not-a-date', now)).toBe('');
    });
    it('seconds → "just now"; a future/clock-skew time also reads "just now"', () => {
      expect(relativeTime('2026-06-30T11:59:30.000Z', now)).toBe('just now');
      expect(relativeTime('2026-06-30T12:05:00.000Z', now)).toBe('just now');
    });
    it('minutes / hours / days, singular vs plural', () => {
      expect(relativeTime('2026-06-30T11:30:00.000Z', now)).toBe('30 minutes ago');
      expect(relativeTime('2026-06-30T11:00:00.000Z', now)).toBe('1 hour ago');
      expect(relativeTime('2026-06-30T09:00:00.000Z', now)).toBe('3 hours ago');
      expect(relativeTime('2026-06-29T12:00:00.000Z', now)).toBe('1 day ago');
      expect(relativeTime('2026-06-26T12:00:00.000Z', now)).toBe('4 days ago');
    });
    it('older than a week → an absolute date (UTC, no "ago")', () => {
      expect(relativeTime('2026-06-01T09:00:00.000Z', now)).toBe('Jun 1, 2026');
    });
    it('1-minute singular, and pins the "just now" upper bound at 60s', () => {
      expect(relativeTime('2026-06-30T11:59:01.000Z', now)).toBe('just now'); // 59s
      expect(relativeTime('2026-06-30T11:59:00.000Z', now)).toBe('1 minute ago'); // 60s, singular
    });
    it('FLOORS elapsed time — never overstates (90 min reads "1 hour ago", not "2")', () => {
      expect(relativeTime('2026-06-30T10:30:00.000Z', now)).toBe('1 hour ago'); // 90 min
    });
    it('pins the 7-day relative→absolute boundary (floored: < 7 days stays relative)', () => {
      expect(relativeTime('2026-06-24T12:00:00.000Z', now)).toBe('6 days ago'); // exactly 6 days
      expect(relativeTime('2026-06-23T13:00:00.000Z', now)).toBe('6 days ago'); // 6d23h → still "6 days ago" (floor, not absolute)
      expect(relativeTime('2026-06-23T12:00:00.000Z', now)).toBe('Jun 23, 2026'); // exactly 7 days → absolute
    });
  });

  describe('absoluteTime — precise UTC timestamp for the hover title', () => {
    it('formats as a UTC datetime', () => {
      const s = absoluteTime('2026-06-26T09:00:00.000Z');
      expect(s).toContain('Jun 26, 2026');
      expect(s).toContain('UTC');
    });
    it('empty / unparseable → ""', () => {
      expect(absoluteTime('')).toBe('');
      expect(absoluteTime('nope')).toBe('');
    });
  });
});
