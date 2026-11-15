import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CAPTURE_TIMEOUT_MS,
  captureServerEvent,
  posthogSend,
  type CaptureBody,
} from './analytics-server';
import type { InternalLookup } from './v2/ops/internal-marker';

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

describe('the internal marker (CC-33 D1)', () => {
  const INTERNAL = 'a0000000-0000-4000-8000-000000000001';
  const NORMAL = 'a0000000-0000-4000-8000-000000000002';
  const lookup = () => vi.fn<InternalLookup>(async (s) => s.id === INTERNAL);

  it('an event about an internal account carries internal: true', async () => {
    const r = recorder();
    const look = lookup();
    await captureServerEvent(null, { ...EVENT, distinctId: `account:${INTERNAL}` }, r.send, look);
    expect(r.sent[0]!.properties).toEqual({
      trigger: 'manual',
      internal: true,
      $process_person_profile: false,
      $geoip_disable: true,
    });
    expect(look).toHaveBeenCalledWith({ kind: 'account', id: INTERNAL });
  });

  it('so does one whose caller names the internal account, whatever its distinct id', async () => {
    const r = recorder();
    await captureServerEvent(null, { ...EVENT, accountId: INTERNAL }, r.send, lookup());
    expect(r.sent[0]!.properties.internal).toBe(true);
  });

  it('an event about a normal account is sent as before', async () => {
    const r = recorder();
    await captureServerEvent(null, { ...EVENT, distinctId: `account:${NORMAL}` }, r.send, lookup());
    expect(r.sent[0]!.properties).not.toHaveProperty('internal');
  });

  it('an event that names no account is sent as before, with nothing looked up', async () => {
    const r = recorder();
    const look = lookup();
    await captureServerEvent(null, EVENT, r.send, look);
    expect(r.sent[0]!.properties).not.toHaveProperty('internal');
    expect(look).not.toHaveBeenCalled();
  });

  it('a caller cannot set internal itself', async () => {
    const r = recorder();
    await captureServerEvent(null, { ...EVENT, properties: { internal: true } }, r.send, lookup());
    expect(r.sent[0]!.properties).not.toHaveProperty('internal');
  });

  it('nothing is looked up for an event consent stops', async () => {
    const r = recorder();
    const look = lookup();
    await captureServerEvent('cm_consent=denied', { ...EVENT, accountId: INTERNAL }, r.send, look);
    expect(r.sent).toEqual([]);
    expect(look).not.toHaveBeenCalled();
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

  it('waits CAPTURE_TIMEOUT_MS (2 s) for PostHog: a send that does not settle is aborted and dropped', async () => {
    vi.stubEnv('NEXT_PUBLIC_POSTHOG_KEY', 'phc_test');
    const bound = new AbortController();
    const asked: number[] = [];
    vi.spyOn(AbortSignal, 'timeout').mockImplementation((ms) => {
      asked.push(ms);
      return bound.signal;
    });
    // PostHog accepts the connection and never answers: the fetch settles only when it is aborted.
    vi.stubGlobal(
      'fetch',
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    );
    const logged: unknown[][] = [];
    vi.spyOn(console, 'error').mockImplementation((...args) => void logged.push(args));

    let settled = false;
    const capture = captureServerEvent(null, EVENT).then(() => {
      settled = true;
    });
    await new Promise((r) => setTimeout(r, 20));
    expect([settled, asked]).toEqual([false, [CAPTURE_TIMEOUT_MS]]);
    expect(CAPTURE_TIMEOUT_MS).toBe(2000);

    bound.abort();
    await capture;
    expect(logged).toEqual([['analytics: server capture of check_started failed']]);
  });
});
