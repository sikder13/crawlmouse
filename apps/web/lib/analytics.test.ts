import { describe, it, expect, vi, beforeEach } from 'vitest';

const { capture } = vi.hoisted(() => ({ capture: vi.fn() }));
vi.mock('posthog-js', () => ({ default: { capture } }));

// Force the "browser" branch of the `typeof window` guard inside track/trackRaw.
vi.stubGlobal('window', {});

import { track, trackRaw, beforeSendSampler } from './analytics';

beforeEach(() => capture.mockClear());

describe('track', () => {
  it('forwards a typed funnel event to posthog.capture with the exact name + props', () => {
    track('audit-submitted', { domain: 'example.com' });
    expect(capture).toHaveBeenCalledTimes(1);
    expect(capture).toHaveBeenCalledWith('audit-submitted', { domain: 'example.com' });
  });

  it('forwards a no-prop funnel event', () => {
    track('email-captured', {});
    expect(capture).toHaveBeenCalledWith('email-captured', {});
  });
});

describe('trackRaw', () => {
  it('forwards an arbitrary event name (escape hatch)', () => {
    trackRaw('some-custom-event', { a: 1 });
    expect(capture).toHaveBeenCalledWith('some-custom-event', { a: 1 });
  });
});

describe('beforeSendSampler', () => {
  it('passes null through unchanged', () => {
    expect(beforeSendSampler(null)).toBeNull();
  });

  it('keeps a funnel event regardless of the internal sample roll', () => {
    const cr = { event: 'audit-submitted' } as Parameters<typeof beforeSendSampler>[0];
    expect(beforeSendSampler(cr)).toBe(cr);
  });
});
