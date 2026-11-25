// @vitest-environment jsdom
/**
 * F-216, against the real posthog-js. The PostHog project's heatmap setting reaches the browser in
 * its remote config, and with heatmaps on the SDK loads its dead-click add-on whatever
 * `capture_dead_clicks` says. Heatmaps are keyed by page address, which can hold a check id.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@sentry/nextjs', () => ({
  init: () => undefined,
  captureRouterTransitionStart: () => undefined,
}));

const KEY = ['phc', 'heatmaptest'].join('_');

async function load() {
  vi.resetModules();
  vi.doMock('posthog-js', async (original) => {
    const real = await original<typeof import('posthog-js')>();
    return { ...real, default: new real.PostHog() };
  });
  document.cookie = 'cm_consent_required=0; Path=/';
  window.history.replaceState(null, '', '/pricing');
  await import('../instrumentation-client');
  return (await import('posthog-js')).default;
}

const addOnScripts = () =>
  [...document.querySelectorAll('script')].filter((s) => s.src.includes('dead-clicks'));

beforeEach(() => {
  for (const s of addOnScripts()) s.remove();
  localStorage.clear();
  sessionStorage.clear();
  vi.stubEnv('NEXT_PUBLIC_POSTHOG_KEY', KEY);
  vi.stubGlobal(
    'fetch',
    async () =>
      new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }),
  );
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('with heatmaps switched on in the PostHog project', () => {
  it('the browser does not start them', async () => {
    const posthog = await load();
    posthog.heatmaps!.onRemoteConfig({ heatmaps: true } as never);
    expect(posthog.heatmaps!.isEnabled).toBe(false);
  });

  it('the dead-click add-on is not loaded', async () => {
    const posthog = await load();
    posthog.heatmaps!.onRemoteConfig({ heatmaps: true } as never);
    expect(addOnScripts()).toEqual([]);
  });

  it('a value the project stored on an earlier visit does not start them either', async () => {
    const first = await load();
    first.heatmaps!.onRemoteConfig({ heatmaps: true } as never);
    const again = await load();
    expect(again.heatmaps!.isEnabled).toBe(false);
    expect(addOnScripts()).toEqual([]);
  });
});
