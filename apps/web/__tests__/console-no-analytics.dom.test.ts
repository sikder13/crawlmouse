// @vitest-environment jsdom
/**
 * No client analytics on the support console (owner ruling, CC-33 rulings-3 R3a): the browser's
 * PostHog is not started on a page under /internal. instrumentation-client.ts runs at import, so each
 * case loads it afresh at a path, with posthog-js and Sentry replaced, and reads whether
 * `posthog.init` ran.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ init: vi.fn() }));

vi.mock('posthog-js', () => ({
  default: {
    init: h.init,
    has_opted_out_capturing: () => false,
    startSessionRecording: () => undefined,
  },
}));
vi.mock('@sentry/nextjs', () => ({
  init: () => undefined,
  captureRouterTransitionStart: () => undefined,
}));

async function startsAt(path: string): Promise<boolean> {
  vi.resetModules();
  h.init.mockClear();
  vi.stubEnv('NEXT_PUBLIC_POSTHOG_KEY', ['phc', 'test'].join('_'));
  window.history.replaceState(null, '', path);
  await import('../instrumentation-client');
  return h.init.mock.calls.length > 0;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('client analytics and the support console', () => {
  it.each([
    '/internal',
    '/internal/',
    '/internal?accounts=a0000000-0000-4000-8000-000000000001',
    '/internal/accounts/a0000000-0000-4000-8000-000000000001',
    '/internal/accounts/a0000000-0000-4000-8000-000000000001?done=link_sent',
  ])('PostHog is not started at %s', async (path) => {
    expect(await startsAt(path)).toBe(false);
  });

  it.each(['/', '/pricing', '/internals', '/internal-tools', '/help/internal'])(
    'PostHog is started at %s',
    async (path) => {
      expect(await startsAt(path)).toBe(true);
    },
  );
});
