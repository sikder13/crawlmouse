import { afterEach, describe, expect, it, vi } from 'vitest';
import { captureServerEvent, posthogSend, type CaptureBody } from './analytics-server';

function recorder() {
  const sent: CaptureBody[] = [];
  return { sent, send: async (body: CaptureBody) => void sent.push(body) };
}

const EVENT = {
  event: 'check_started',
  distinctId: 'check:abc',
  properties: { trigger: 'manual' },
} as const;

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('captureServerEvent', () => {
  it('sends the event with no person profile and no GeoIP lookup', async () => {
    const r = recorder();
    await captureServerEvent(null, EVENT, r.send);
    expect(r.sent).toEqual([
      {
        event: 'check_started',
        distinct_id: 'check:abc',
        properties: { trigger: 'manual', $process_person_profile: false, $geoip_disable: true },
      },
    ]);
  });

  it('does not let a caller switch the person profile or the GeoIP lookup back on', async () => {
    const r = recorder();
    await captureServerEvent(
      null,
      { ...EVENT, properties: { $process_person_profile: true, $geoip_disable: false } },
      r.send,
    );
    expect(r.sent[0]!.properties).toEqual({
      $process_person_profile: false,
      $geoip_disable: true,
    });
  });

  it('puts nothing of the cookie header in what it sends', async () => {
    const r = recorder();
    await captureServerEvent('session=secret-value; cm_consent=granted', EVENT, r.send);
    expect(JSON.stringify(r.sent)).not.toContain('secret-value');
    expect(r.sent).toHaveLength(1);
  });

  it.each([
    ['cm_consent=denied', 0],
    ['cm_consent_required=1', 0],
    ['cm_consent_required=1; cm_consent=granted', 1],
    ['cm_consent_required=0', 1],
  ])('with the cookie %s it sends %i event(s)', async (cookie, n) => {
    const r = recorder();
    await captureServerEvent(cookie, EVENT, r.send);
    expect(r.sent).toHaveLength(n);
  });

  it('swallows a send error and logs the event name without the payload', async () => {
    const logged: unknown[][] = [];
    vi.spyOn(console, 'error').mockImplementation((...args) => void logged.push(args));
    const failing = async () => {
      throw new Error('boom with check:abc inside');
    };
    await expect(captureServerEvent(null, EVENT, failing)).resolves.toBeUndefined();
    expect(logged).toEqual([['analytics: server capture of check_started failed']]);
  });
});

describe('posthogSend', () => {
  const body: CaptureBody = { event: 'check_started', distinct_id: 'check:abc', properties: {} };

  it('sends nothing without a project key', async () => {
    vi.stubEnv('NEXT_PUBLIC_POSTHOG_KEY', '');
    const fetched = vi.fn();
    vi.stubGlobal('fetch', fetched);
    await posthogSend(body);
    expect(fetched).not.toHaveBeenCalled();
  });

  it('posts the body with the project key, and throws on a refusal', async () => {
    vi.stubEnv('NEXT_PUBLIC_POSTHOG_KEY', 'phc_test');
    const fetched = vi.fn(async () => new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', fetched);
    await posthogSend(body);
    const [url, init] = fetched.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://us.i.posthog.com/i/v0/e/');
    expect(JSON.parse(String(init.body))).toEqual({ api_key: 'phc_test', ...body });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 500 })),
    );
    await expect(posthogSend(body)).rejects.toThrow('capture answered 500');
  });
});
