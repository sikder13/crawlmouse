import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_SINKS,
  REFUSALS_PER_MINUTE,
  REFUSAL_SAMPLE_RATE,
  reportRefusal,
  type Refusal,
  type RefusalSinks,
} from '../../lib/security/refusal-event';

const sentry = vi.hoisted(() => ({
  captureMessage: vi.fn(),
  startNewTrace: (fn: () => unknown) => fn(),
  withScope: (fn: (scope: { addEventProcessor: () => void }) => void) =>
    fn({ addEventProcessor: () => {} }),
}));
vi.mock('@sentry/nextjs', () => sentry);

const REFUSAL: Refusal = {
  reason: 'cross_site',
  route: 'audits/[id]/cancel',
  class: 'public',
  method: 'POST',
  status: 403,
};

// Each test starts in a minute of its own, so the per-minute allowance starts fresh.
let minute = 1_000_000;
const freshMinute = () => (minute += 2) * 60_000;

function sinks(random: number, rate = REFUSAL_SAMPLE_RATE, at = freshMinute()) {
  const sent: string[] = [];
  const s: RefusalSinks = {
    sentry: () => sent.push('sentry'),
    posthog: async () => {
      sent.push('posthog');
    },
    random: () => random,
    rate,
    now: () => at,
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

describe('security.refused is capped per instance per minute', () => {
  it(`sends at most ${REFUSALS_PER_MINUTE} in one minute, and again in the next`, async () => {
    const at = freshMinute();
    const { s, sent } = sinks(0, 1, at);
    for (let i = 0; i < REFUSALS_PER_MINUTE + 5; i++) await reportRefusal(REFUSAL, s);
    expect(sent.filter((x) => x === 'sentry')).toHaveLength(REFUSALS_PER_MINUTE);
    const next = sinks(0, 1, at + 60_000);
    await reportRefusal(REFUSAL, next.s);
    expect(next.sent).toEqual(['sentry', 'posthog']);
  });

  it('a draw outside the sample does not spend the allowance', async () => {
    const at = freshMinute();
    for (let i = 0; i < REFUSALS_PER_MINUTE * 2; i++)
      await reportRefusal(REFUSAL, sinks(0.5, 0.1, at).s);
    const { s, sent } = sinks(0, 1, at);
    await reportRefusal(REFUSAL, s);
    expect(sent).toEqual(['sentry', 'posthog']);
  });
});

describe('what each sink receives', () => {
  const always = () => ({ random: () => 0, rate: 1, now: freshMinute });

  it('Sentry: one warning named security.refused, the fields as tags', async () => {
    const fetchSpy = vi.fn(async () => new Response(null));
    vi.stubGlobal('fetch', fetchSpy);
    await reportRefusal(REFUSAL, { ...DEFAULT_SINKS, ...always() });
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
    await reportRefusal(REFUSAL, { ...DEFAULT_SINKS, ...always() });
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
    await reportRefusal(REFUSAL, { ...DEFAULT_SINKS, ...always() });
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.stubEnv('NEXT_PUBLIC_POSTHOG_KEY', 'test-project-key');
    await expect(
      reportRefusal(REFUSAL, { ...DEFAULT_SINKS, ...always() }),
    ).resolves.toBeUndefined();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
