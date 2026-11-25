// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://reports.agency-example.com/s/view/0b6f6c1e-3f0a-4c55-9d2e-2a7c4f1e9b10" }
/**
 * Goal 1 row 25: on an agency's own host the browser starts no PostHog and Sentry replays no error.
 * instrumentation-client.ts runs at import, so it is loaded here with posthog-js and Sentry replaced,
 * on a page whose host is the agency's (the environment's URL), with everything else that would let
 * PostHog start in place: the key set and the region cookie saying no consent is needed.
 */
import { describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ init: vi.fn(), sentry: [] as unknown[] }));

vi.mock('posthog-js', () => ({
  default: {
    init: h.init,
    has_opted_out_capturing: () => false,
    startSessionRecording: () => undefined,
  },
}));
vi.mock('@/lib/sentry-lazy', async (original) => ({
  ...(await original<typeof import('@/lib/sentry-lazy')>()),
  configureSentry: (options: unknown) => h.sentry.push(options),
  startSentryWhenIdle: () => undefined,
}));

describe('an agency’s own host (row 25)', () => {
  it('starts no PostHog, and Sentry replays no error', async () => {
    expect(window.location.host).toBe('reports.agency-example.com');
    vi.stubEnv('NEXT_PUBLIC_POSTHOG_KEY', ['phc', 'test'].join('_'));
    document.cookie = 'cm_consent_required=0; Path=/';
    await import('../instrumentation-client');
    expect(h.init).not.toHaveBeenCalled();
    expect(h.sentry).toEqual([expect.objectContaining({ replaysOnErrorSampleRate: 0 })]);
    vi.unstubAllEnvs();
  });
});
