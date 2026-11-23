import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CAPTURE_TIMEOUT_MS,
  browserDistinctId,
  distinctIdFor,
  visitorDistinctId,
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

  it('posts to POSTHOG_CAPTURE_URL when it is set outside production (the walk’s capture stub)', async () => {
    vi.stubEnv('NEXT_PUBLIC_POSTHOG_KEY', 'phc_test');
    vi.stubEnv('POSTHOG_CAPTURE_URL', 'http://127.0.0.1:54438/ph/i/v0/e/');
    for (const env of ['preview', 'development', '']) {
      vi.stubEnv('VERCEL_ENV', env);
      const fetched = vi.fn(async () => new Response(null, { status: 200 }));
      vi.stubGlobal('fetch', fetched);
      await posthogSend(body);
      const [url] = fetched.mock.calls[0] as unknown as [string];
      expect(url, `VERCEL_ENV=${env || '(empty)'}`).toBe('http://127.0.0.1:54438/ph/i/v0/e/');
    }
  });

  it('ignores POSTHOG_CAPTURE_URL in production: it sends to PostHog only', async () => {
    vi.stubEnv('NEXT_PUBLIC_POSTHOG_KEY', 'phc_test');
    vi.stubEnv('POSTHOG_CAPTURE_URL', 'http://127.0.0.1:54438/ph/i/v0/e/');
    vi.stubEnv('VERCEL_ENV', 'production');
    const fetched = vi.fn(async () => new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', fetched);
    await posthogSend(body);
    const [url] = fetched.mock.calls[0] as unknown as [string];
    expect(url).toBe('https://us.i.posthog.com/i/v0/e/');
  });

  it('an empty POSTHOG_CAPTURE_URL is unset', async () => {
    vi.stubEnv('NEXT_PUBLIC_POSTHOG_KEY', 'phc_test');
    vi.stubEnv('POSTHOG_CAPTURE_URL', '');
    vi.stubEnv('VERCEL_ENV', 'preview');
    const fetched = vi.fn(async () => new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', fetched);
    await posthogSend(body);
    const [url] = fetched.mock.calls[0] as unknown as [string];
    expect(url).toBe('https://us.i.posthog.com/i/v0/e/');
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

describe('account_id (CC-41 D1)', () => {
  const ACCOUNT = 'a0000000-0000-4000-8000-000000000003';

  it('an event with an accountId carries it as account_id', async () => {
    const r = recorder();
    await captureServerEvent(null, { ...EVENT, accountId: ACCOUNT }, r.send, async () => false);
    expect(r.sent[0]!.properties).toEqual({
      trigger: 'manual',
      account_id: ACCOUNT,
      $process_person_profile: false,
      $geoip_disable: true,
    });
  });

  it("a caller's own account_id is dropped, with or without an accountId", async () => {
    const r = recorder();
    const own = { ...EVENT, properties: { account_id: 'forged' } };
    await captureServerEvent(null, own, r.send, async () => false);
    await captureServerEvent(null, { ...own, accountId: ACCOUNT }, r.send, async () => false);
    expect(r.sent.map((b) => b.properties.account_id)).toEqual([undefined, ACCOUNT]);
    expect(r.sent[0]!.properties).not.toHaveProperty('account_id');
  });
});

describe('browserDistinctId (CC-41 D1)', () => {
  const KEY = 'phc_testkey';
  const cookieOf = (value: unknown) =>
    `ph_${KEY}_posthog=${encodeURIComponent(JSON.stringify(value))}`;

  it('reads distinct_id from the PostHog cookie of this project', () => {
    vi.stubEnv('NEXT_PUBLIC_POSTHOG_KEY', KEY);
    const id = '019a1b2c-3d4e-7f00-8000-0000000000aa';
    expect(browserDistinctId(`a=1; ${cookieOf({ distinct_id: id, $sesid: [1] })}; b=2`)).toBe(id);
  });

  it('reads nothing when consent stops the server capture', () => {
    vi.stubEnv('NEXT_PUBLIC_POSTHOG_KEY', KEY);
    const ok = cookieOf({ distinct_id: 'abc' });
    expect(browserDistinctId(ok)).toBe('abc');
    expect(browserDistinctId(`${ok}; cm_consent=denied`)).toBeNull();
    expect(browserDistinctId(`${ok}; cm_consent_required=1`)).toBeNull();
    expect(browserDistinctId(`${ok}; cm_consent_required=1; cm_consent=granted`)).toBe('abc');
  });

  it('reads nothing without a project key, or from another project', () => {
    vi.stubEnv('NEXT_PUBLIC_POSTHOG_KEY', '');
    expect(browserDistinctId(cookieOf({ distinct_id: 'abc' }))).toBeNull();
    vi.stubEnv('NEXT_PUBLIC_POSTHOG_KEY', 'phc_other');
    expect(browserDistinctId(cookieOf({ distinct_id: 'abc' }))).toBeNull();
  });

  it.each([
    ['no header', null],
    ['no cookie', 'a=1'],
    ['not JSON', `ph_${KEY}_posthog=%7Bnot-json`],
    ['bad encoding', `ph_${KEY}_posthog=%E0%A4%A`],
    ['no distinct_id', cookieOf({ other: 'abc' })],
    ['a number', cookieOf({ distinct_id: 42 })],
    ['empty', cookieOf({ distinct_id: '' })],
    ['201 characters', cookieOf({ distinct_id: 'a'.repeat(201) })],
    ['a space', cookieOf({ distinct_id: 'a b' })],
    ['a quote', cookieOf({ distinct_id: 'a"b' })],
    ['a slash', cookieOf({ distinct_id: 'a/b' })],
    ['markup', cookieOf({ distinct_id: '<script>' })],
    ['a newline', cookieOf({ distinct_id: 'a\nb' })],
    ['unicode', cookieOf({ distinct_id: 'ä' })],
    ['an array', cookieOf([{ distinct_id: 'abc' }])],
  ])('reads nothing from %s', (_name, header) => {
    vi.stubEnv('NEXT_PUBLIC_POSTHOG_KEY', KEY);
    expect(browserDistinctId(header)).toBeNull();
  });

  it('accepts 200 characters of the allowed class', () => {
    vi.stubEnv('NEXT_PUBLIC_POSTHOG_KEY', KEY);
    const id = `${'A-z0.9_:@'.repeat(22)}ab`;
    expect(id).toHaveLength(200);
    expect(browserDistinctId(cookieOf({ distinct_id: id }))).toBe(id);
  });
});

describe('distinct ids by who the event is about (CC-41 D1)', () => {
  const ACCOUNT = 'a0000000-0000-4000-8000-000000000004';
  const USER = 'b0000000-0000-4000-8000-000000000004';

  it('a human’s own action is keyed by their users.id; a system event by its account', () => {
    vi.stubEnv('NEXT_PUBLIC_POSTHOG_KEY', 'phc_k');
    const cookie = `ph_phc_k_posthog=${encodeURIComponent(JSON.stringify({ distinct_id: 'dev-1' }))}`;
    expect(distinctIdFor(cookie, { accountId: ACCOUNT, userId: USER })).toBe(USER);
    expect(distinctIdFor(cookie, { accountId: ACCOUNT })).toBe(`account:${ACCOUNT}`);
    expect(distinctIdFor(cookie, { accountId: ACCOUNT, userId: null })).toBe(`account:${ACCOUNT}`);
  });

  it('a visitor event takes the user, else the browser’s id, else the account', () => {
    vi.stubEnv('NEXT_PUBLIC_POSTHOG_KEY', 'phc_k');
    const cookie = `ph_phc_k_posthog=${encodeURIComponent(JSON.stringify({ distinct_id: 'dev-1' }))}`;
    const key = { accountId: ACCOUNT, visitor: true };
    expect(distinctIdFor(cookie, { ...key, userId: USER })).toBe(USER);
    expect(distinctIdFor(cookie, key)).toBe('dev-1');
    expect(distinctIdFor('a=1', key)).toBe(`account:${ACCOUNT}`);
    expect(distinctIdFor(`${cookie}; cm_consent=denied`, key)).toBe(`account:${ACCOUNT}`);
  });

  it('a visitor is the signed-in user, else the browser’s PostHog id, else the fallback', () => {
    vi.stubEnv('NEXT_PUBLIC_POSTHOG_KEY', 'phc_k');
    const cookie = `ph_phc_k_posthog=${encodeURIComponent(JSON.stringify({ distinct_id: 'dev-1' }))}`;
    expect(visitorDistinctId(cookie, USER, 'check:r')).toBe(USER);
    expect(visitorDistinctId(cookie, null, 'check:r')).toBe('dev-1');
    expect(visitorDistinctId('a=1', null, 'check:r')).toBe('check:r');
    expect(visitorDistinctId(`${cookie}; cm_consent=denied`, null, 'check:r')).toBe('check:r');
  });
});

describe('captureServerEvent, the browser’s bot rule (F-050)', () => {
  const HEADLESS =
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/131.0.0.0 Safari/537.36';
  const CHROME =
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
  const lookup = async () => false;

  it.each([
    ['a headless browser', HEADLESS],
    [
      'an AI crawler',
      'Mozilla/5.0 AppleWebKit/537.36 (compatible; GPTBot/1.1; +https://openai.com/gptbot)',
    ],
    [
      'a search crawler',
      'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
    ],
  ])('%s sends nothing', async (_, userAgent) => {
    const send = vi.fn(async () => undefined);
    await captureServerEvent(
      null,
      { event: 'check_started', distinctId: 'd', userAgent },
      send,
      lookup,
    );
    expect(send).not.toHaveBeenCalled();
  });

  it.each([
    ['a browser', CHROME],
    ['no user agent', null],
    ['a caller that has no request', undefined],
  ])('%s is sent, and the user agent is not in the event', async (_, userAgent) => {
    const send = vi.fn(async (_b: unknown) => undefined);
    await captureServerEvent(
      null,
      { event: 'check_started', distinctId: 'd', userAgent },
      send,
      lookup,
    );
    expect(send).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(send.mock.calls[0]![0])).not.toContain('Chrome');
  });
});
