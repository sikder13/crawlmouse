// @vitest-environment jsdom
/**
 * Does `posthog.set_config({ disable_surveys: true })`, the consent banner's decline (CC-41 D8,
 * rulings Q10), take away a survey that is already on the page? Run against the real posthog-js and
 * its surveys extension, with PostHog's network answered here: one popover survey that matches
 * everyone is served, shown, and then the decline's call is made.
 *
 * The answer this test pins is the one measured: the survey shown before the call is still on the
 * page after it. A visitor who declines therefore keeps a survey already open until they dismiss it
 * or leave the page; the next page load starts PostHog with surveys off after a decline, in any region
 * (`surveysOffAtStart`, lib/consent.ts, used by instrumentation-client.ts), so none is loaded then.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const SURVEY = {
  id: '0190a000-0000-7000-8000-000000000001',
  name: '[cm] probe',
  type: 'popover',
  questions: [{ id: 'q1', type: 'open', question: 'Anything?' }],
  conditions: null,
  appearance: null,
  start_date: '2026-01-01T00:00:00Z',
  end_date: null,
  current_iteration: null,
  current_iteration_start_date: null,
  linked_flag_key: null,
  targeting_flag_key: null,
  internal_targeting_flag_key: null,
};

function answerFor(url: string): unknown {
  if (url.includes('/flags')) return { featureFlags: {}, featureFlagPayloads: {}, surveys: true };
  if (url.includes('/api/surveys')) return { surveys: [SURVEY] };
  if (url.includes('/config')) return { surveys: true, sessionRecording: false };
  return { status: 1 };
}

/** The shown survey's host element, when its question is on the page. */
const shown = () => {
  const host = document.querySelector(`[class*="PostHogSurvey"]`);
  const text = host?.shadowRoot?.textContent ?? host?.textContent ?? '';
  return text.includes('Anything?') ? host : null;
};

async function until(check: () => boolean, ms = 4000): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (check()) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return check();
}

let posthog: typeof import('posthog-js').default;

beforeAll(async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input instanceof Request ? input.url : input);
      return new Response(JSON.stringify(answerFor(url)), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }),
  );
  // The extension registers itself on window.__PosthogExtensions__, as the lazily loaded script does.
  // @ts-expect-error posthog-js ships no types for its surveys bundle, which is a side-effect script.
  await import('posthog-js/dist/surveys');
  posthog = (await import('posthog-js')).default;
  posthog.init('phc_probe', {
    api_host: 'https://probe.invalid',
    persistence: 'memory',
    disable_surveys: false,
    capture_pageview: false,
    autocapture: false,
    disable_session_recording: true,
  });
});

afterAll(() => {
  vi.unstubAllGlobals();
});

describe('disable_surveys set after a survey is shown (Q10)', () => {
  it('a survey served to everyone is shown first (the harness is live)', async () => {
    posthog.surveys.onRemoteConfig({ surveys: true } as never);
    expect(await until(() => shown() !== null)).toBe(true);
  }, 10_000);

  it('the decline’s set_config leaves the shown survey on the page', async () => {
    posthog.set_config({ disable_surveys: true });
    await new Promise((r) => setTimeout(r, 1500));
    expect(shown()).not.toBeNull();
  }, 10_000);
});
