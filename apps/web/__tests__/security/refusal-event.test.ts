import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_SINKS,
  REFUSAL_SAMPLE_RATE,
  reportRefusal,
  type Refusal,
  type RefusalSinks,
} from '../../lib/security/refusal-event';

const sentry = vi.hoisted(() => ({ captureMessage: vi.fn() }));
vi.mock('@sentry/nextjs', () => sentry);

const REFUSAL: Refusal = {
  reason: 'cross_site',
  route: 'audits/[id]/cancel',
  class: 'public',
  method: 'POST',
  status: 403,
};

function sinks(random: number, rate = REFUSAL_SAMPLE_RATE) {
  const sent: string[] = [];
  const s: RefusalSinks = {
    sentry: () => sent.push('sentry'),
    posthog: async () => {
      sent.push('posthog');
    },
    random: () => random,
    rate,
  };
  return { s, sent };
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  sentry.captureMessage.mockReset();
});

describe('security.refused is sampled', () => {
  it('a draw below the rate is sent to both sinks', async () => {
    const { s, sent } = sinks(REFUSAL_SAMPLE_RATE - 0.001);
    await reportRefusal(REFUSAL, s);
    expect(sent).toEqual(['sentry', 'posthog']);
  });

  it('a draw at or above the rate sends nothing', async () => {
    for (const draw of [REFUSAL_SAMPLE_RATE, 0.5, 0.999]) {
      const { s, sent } = sinks(draw);
      await reportRefusal(REFUSAL, s);
      expect(sent, String(draw)).toEqual([]);
    }
  });

  it('the rate is a tenth', () => {
    expect(REFUSAL_SAMPLE_RATE).toBe(0.1);
  });
});

describe('what each sink receives', () => {
  const always = { random: () => 0, rate: 1 };

  it('Sentry: one warning named security.refused, the fields as tags', async () => {
    const fetchSpy = vi.fn(async () => new Response(null));
    vi.stubGlobal('fetch', fetchSpy);
    await reportRefusal(REFUSAL, { ...DEFAULT_SINKS, ...always });
    expect(sentry.captureMessage).toHaveBeenCalledTimes(1);
    expect(sentry.captureMessage).toHaveBeenCalledWith('security.refused', {
      level: 'warning',
      tags: {
        reason: 'cross_site',
        route: 'audits/[id]/cancel',
        class: 'public',
        method: 'POST',
        status: '403',
      },
    });
  });

  it('PostHog: one capture with the project key, a fixed distinct id and no person profile', async () => {
    vi.stubEnv('NEXT_PUBLIC_POSTHOG_KEY', 'test-project-key');
    const fetchSpy = vi.fn(async () => new Response(null));
    vi.stubGlobal('fetch', fetchSpy);
    await reportRefusal(REFUSAL, { ...DEFAULT_SINKS, ...always });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://us.i.posthog.com/i/v0/e/');
    expect(JSON.parse(init.body as string)).toEqual({
      api_key: 'test-project-key',
      event: 'security.refused',
      distinct_id: 'server:security',
      properties: { ...REFUSAL, $process_person_profile: false },
    });
  });

  it('PostHog: nothing is sent without a project key, and a failed send does not throw', async () => {
    vi.stubEnv('NEXT_PUBLIC_POSTHOG_KEY', '');
    const fetchSpy = vi.fn(async () => {
      throw new Error('network');
    });
    vi.stubGlobal('fetch', fetchSpy);
    await reportRefusal(REFUSAL, { ...DEFAULT_SINKS, ...always });
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.stubEnv('NEXT_PUBLIC_POSTHOG_KEY', 'test-project-key');
    await expect(reportRefusal(REFUSAL, { ...DEFAULT_SINKS, ...always })).resolves.toBeUndefined();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
