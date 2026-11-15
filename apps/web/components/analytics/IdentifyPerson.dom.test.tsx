// @vitest-environment jsdom
/** IdentifyPerson (CC-41 D1): identifies on mount and on the consent grant, never while opted out. */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CONSENT_GRANTED_EVENT } from '@/lib/consent';
import type { PersonTraits } from '@/lib/analytics/person';

const ph = vi.hoisted(() => ({
  __loaded: true,
  optedOut: false,
  identify: vi.fn(),
  reset: vi.fn(),
}));

vi.mock('posthog-js', () => ({
  default: {
    get __loaded() {
      return ph.__loaded;
    },
    has_opted_out_capturing: () => ph.optedOut,
    get_distinct_id: () => 'anon',
    get_property: () => 'anonymous',
    identify: ph.identify,
    reset: ph.reset,
  },
}));

const { IdentifyPerson } = await import('./IdentifyPerson');

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const traits: PersonTraits = {
  userId: 'u1',
  set: {
    account_id: 'a1',
    plan: 'free',
    internal: false,
    checks_finished: 0,
    account_age_days: 0,
    trial_day: null,
  },
};

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  ph.__loaded = true;
  ph.optedOut = false;
  ph.identify.mockClear();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  document.cookie = 'cm_ft=; Max-Age=0; Path=/';
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe('IdentifyPerson', () => {
  it('identifies the user on mount, with the cm_ft fields set once, and renders nothing', () => {
    document.cookie = `cm_ft=${encodeURIComponent(
      JSON.stringify({ utm_source: 'blog', first_seen_at: '2026-11-15T15:04:05Z' }),
    )}; Path=/`;
    act(() => root.render(<IdentifyPerson traits={traits} />));
    expect(ph.identify.mock.calls).toEqual([
      ['u1', traits.set, { ft_utm_source: 'blog', ft_first_seen_at: '2026-11-15T15:04:05Z' }],
    ]);
    expect(host.innerHTML).toBe('');
  });

  it('while opted out it identifies nothing, and does once consent is granted', () => {
    ph.optedOut = true;
    act(() => root.render(<IdentifyPerson traits={traits} />));
    expect(ph.identify).not.toHaveBeenCalled();
    ph.optedOut = false;
    act(() => void window.dispatchEvent(new Event(CONSENT_GRANTED_EVENT)));
    expect(ph.identify).toHaveBeenCalledTimes(1);
  });

  it('does nothing when PostHog has not started', () => {
    ph.__loaded = false;
    act(() => root.render(<IdentifyPerson traits={traits} />));
    act(() => void window.dispatchEvent(new Event(CONSENT_GRANTED_EVENT)));
    expect(ph.identify).not.toHaveBeenCalled();
  });

  it('stops listening for the grant once unmounted', () => {
    act(() => root.render(<IdentifyPerson traits={traits} />));
    act(() => root.render(<></>));
    act(() => void window.dispatchEvent(new Event(CONSENT_GRANTED_EVENT)));
    expect(ph.identify).toHaveBeenCalledTimes(1);
  });
});
