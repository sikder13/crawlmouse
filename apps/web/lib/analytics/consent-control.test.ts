// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { onSupportConsole, resumeAnalytics, stopAnalytics } from './consent-control';

function fake(loaded: boolean) {
  const calls: unknown[][] = [];
  return {
    calls,
    posthog: {
      __loaded: loaded,
      opt_out_capturing: () => void calls.push(['opt_out']),
      opt_in_capturing: () => void calls.push(['opt_in']),
      set_config: (c: object) => void calls.push(['set_config', c]),
      conversations: { reset: () => void calls.push(['conversations_reset']) },
    } as unknown as Parameters<typeof stopAnalytics>[0] & Parameters<typeof resumeAnalytics>[0],
  };
}

beforeEach(() => {
  window.history.replaceState(null, '', '/');
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('stopAnalytics', () => {
  it('opts out before it changes the config: the SDK stops a running replay only if opted out', () => {
    const { posthog, calls } = fake(true);
    stopAnalytics(posthog);
    expect(calls).toEqual([
      ['opt_out'],
      [
        'set_config',
        {
          advanced_disable_flags: true,
          disable_external_dependency_loading: true,
          disable_surveys: true,
          disable_product_tours: true,
          disable_conversations: true,
          disable_persistence: true,
          opt_out_capturing_by_default: true,
        },
      ],
      ['conversations_reset'],
    ]);
  });

  it('before PostHog has started, calls nothing of the SDK and still clears', () => {
    const { posthog, calls } = fake(false);
    localStorage.setItem('ph_x_posthog', '{}');
    stopAnalytics(posthog);
    expect(calls).toEqual([]);
    expect(localStorage.getItem('ph_x_posthog')).toBeNull();
  });
});

describe('resumeAnalytics', () => {
  it('turns the config back on, then opts in', () => {
    const { posthog, calls } = fake(true);
    resumeAnalytics(posthog);
    expect(calls.map((c) => c[0])).toEqual(['set_config', 'opt_in']);
  });

  it('does nothing before PostHog has started, or on the support console', () => {
    const before = fake(false);
    resumeAnalytics(before.posthog);
    expect(before.calls).toEqual([]);
    window.history.replaceState(null, '', '/internal/accounts/a');
    const onConsole = fake(true);
    resumeAnalytics(onConsole.posthog);
    expect(onConsole.calls).toEqual([]);
  });
});

describe('onSupportConsole', () => {
  it.each([
    ['/internal', true],
    ['/internal/', true],
    ['/internal/accounts/a', true],
    ['/internals', false],
    ['/internal-tools', false],
    ['/help/internal', false],
    ['/', false],
  ])('%s: %s', (path, expected) => {
    expect(onSupportConsole(path)).toBe(expected);
  });
});
