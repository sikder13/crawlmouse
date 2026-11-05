import { describe, expect, it, vi } from 'vitest';
import {
  BROWSER_RUN,
  browserRunClient,
  clientFromEnv,
  MAX_REPLY_BYTES,
  RENDER_TIMEOUT_MS,
  REQUEST_TIMEOUT_MS,
  RENDER_USER_AGENT,
  RENDER_VIEWPORT,
  renderRequestBody,
} from './client.js';
import { URL_RULES, wirePattern } from './policy.js';

const ACCOUNT = 'test-account';
const TOKEN = 'test-token';

function reply(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

function clientWith(fetchImpl: (url: string, init: RequestInit) => Promise<Response>) {
  const spy = vi.fn(fetchImpl);
  return { spy, client: browserRunClient({ accountId: ACCOUNT, token: TOKEN, fetch: spy }) };
}

describe('the request body', () => {
  it('is exactly the pinned render procedure on the rendered side', () => {
    expect(renderRequestBody('https://site.example/', 'rendered')).toEqual({
      url: 'https://site.example/',
      userAgent: RENDER_USER_AGENT,
      viewport: { width: 1366, height: 768 },
      gotoOptions: { waitUntil: 'networkidle0', timeout: 15_000 },
      rejectResourceTypes: ['websocket', 'eventsource', 'media'],
      rejectRequestPattern: URL_RULES.map((r) => wirePattern(r.pattern)),
    });
  });

  it('differs on the static side only by refusing scripts and turning JavaScript off', () => {
    const rendered = renderRequestBody('https://site.example/', 'rendered');
    const staticSide = renderRequestBody('https://site.example/', 'static');
    expect(staticSide.rejectResourceTypes).toEqual([...rendered.rejectResourceTypes, 'script']);
    expect(staticSide.setJavaScriptEnabled).toBe(false);
    expect('setJavaScriptEnabled' in rendered).toBe(false);
    expect({ ...staticSide, rejectResourceTypes: null, setJavaScriptEnabled: null }).toEqual({
      ...rendered,
      rejectResourceTypes: null,
      setJavaScriptEnabled: null,
    });
  });

  it('sends JavaScript off on the wire for the static side', async () => {
    const { spy, client } = clientWith(async () =>
      reply(200, { success: true, result: '<p>x</p>' }),
    );
    await client.content('https://site.example/', 'static');
    await client.content('https://site.example/', 'rendered');
    const bodies = spy.mock.calls.map(([, init]) => JSON.parse(String(init.body)));
    expect(bodies[0].setJavaScriptEnabled).toBe(false);
    expect('setJavaScriptEnabled' in bodies[1]).toBe(false);
  });

  it('pins the viewport and the wait', () => {
    expect(RENDER_VIEWPORT).toEqual({ width: 1366, height: 768 });
    expect(RENDER_TIMEOUT_MS).toBe(15_000);
  });

  it('sends each pattern as its bare source, which reads back into the same regular expression', () => {
    const sent = renderRequestBody('https://site.example/', 'rendered').rejectRequestPattern;
    expect(sent).toEqual(URL_RULES.map((r) => r.pattern.source));
    for (const p of sent) {
      expect(p.startsWith('/')).toBe(false);
      expect(new RegExp(p).source).toBe(p);
    }
  });
});

describe('a render request', () => {
  it('is posted to the account’s /content endpoint with the token as a bearer', async () => {
    const { spy, client } = clientWith(async () =>
      reply(200, { success: true, result: '<p>x</p>' }),
    );
    await client.content('https://site.example/', 'rendered');
    const [url, init] = spy.mock.calls[0]!;
    expect(url).toBe(
      `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/browser-run/content`,
    );
    expect(BROWSER_RUN.endpoint).toBe(
      'https://api.cloudflare.com/client/v4/accounts/{account_id}/browser-run/content',
    );
    expect(init.method).toBe('POST');
    expect(new Headers(init.headers).get('authorization')).toBe(`Bearer ${TOKEN}`);
    expect(new Headers(init.headers).get('content-type')).toBe('application/json');
    expect(JSON.parse(init.body as string)).toEqual(
      renderRequestBody('https://site.example/', 'rendered'),
    );
  });
});

describe('a reply', () => {
  it('gives the HTML and the browser time Browser Run reports', async () => {
    const { client } = clientWith(async () =>
      reply(200, { success: true, result: '<p>hello</p>' }, { 'x-browser-ms-used': '2345' }),
    );
    expect(await client.content('https://site.example/', 'rendered')).toEqual({
      ok: true,
      html: '<p>hello</p>',
      browserMs: 2345,
    });
  });

  it('counts a render whose browser time is not reported at the request timeout, not at zero', async () => {
    const { client } = clientWith(async () => reply(200, { success: true, result: '<p>x</p>' }));
    const r = await client.content('https://site.example/', 'rendered');
    expect(r.browserMs).toBe(REQUEST_TIMEOUT_MS);
  });

  it('is rate_limited on a 429, with Retry-After in milliseconds and no browser time', async () => {
    const { client } = clientWith(async () =>
      reply(429, { success: false }, { 'retry-after': '3' }),
    );
    expect(await client.content('https://site.example/', 'rendered')).toEqual({
      ok: false,
      reason: 'rate_limited',
      retryAfterMs: 3000,
      browserMs: 0,
    });
  });

  it.each([null, '', '  ', 'soon', '-1'])(
    'is rate_limited with no wait of its own when Retry-After is %j, so the caller backs off',
    async (header) => {
      const { client } = clientWith(async () =>
        reply(429, { success: false }, header === null ? {} : { 'retry-after': header }),
      );
      expect(await client.content('https://site.example/', 'rendered')).toMatchObject({
        reason: 'rate_limited',
        retryAfterMs: null,
      });
    },
  );

  it('is timed_out when Browser Run does not answer in time, counted at the request timeout', async () => {
    const fetchNever = (_url: string, init: RequestInit) =>
      new Promise<Response>((_resolve, reject) =>
        init.signal!.addEventListener('abort', () => reject(init.signal!.reason)),
      );
    const client = browserRunClient({
      accountId: ACCOUNT,
      token: TOKEN,
      fetch: fetchNever,
      requestTimeoutMs: 30,
    });
    expect(await client.content('https://site.example/', 'rendered')).toEqual({
      ok: false,
      reason: 'timed_out',
      retryAfterMs: null,
      browserMs: 30,
    });
  });

  it('is timed_out when the reply body stops arriving', async () => {
    const fetchTrickle = async (_url: string, init: RequestInit) => {
      const body = new ReadableStream<Uint8Array>({
        start(c) {
          c.enqueue(new TextEncoder().encode('{"success":true,"result":"'));
          init.signal!.addEventListener('abort', () => c.error(init.signal!.reason));
        },
      });
      return new Response(body, { status: 200, headers: { 'x-browser-ms-used': '40' } });
    };
    const client = browserRunClient({
      accountId: ACCOUNT,
      token: TOKEN,
      fetch: fetchTrickle,
      requestTimeoutMs: 30,
    });
    expect(await client.content('https://site.example/', 'rendered')).toMatchObject({
      ok: false,
      reason: 'timed_out',
    });
  });

  it('times a request out after the wait cap plus a margin by default', () => {
    expect(REQUEST_TIMEOUT_MS).toBe(RENDER_TIMEOUT_MS + 30_000);
  });

  it.each([
    [422, 'page_failed'],
    [400, 'api_error'],
    [401, 'api_error'],
    [500, 'api_error'],
  ])('fails as %s → %s', async (status, reason) => {
    const { client } = clientWith(async () =>
      reply(status, { success: false }, { 'x-browser-ms-used': '700' }),
    );
    expect(await client.content('https://site.example/', 'rendered')).toEqual({
      ok: false,
      reason,
      retryAfterMs: null,
      browserMs: 700,
    });
  });

  it.each([
    ['success false', { success: false, result: '<p>x</p>' }],
    ['a result that is not a string', { success: true, result: { content: '<p>x</p>' } }],
    ['no JSON at all', 'not json'],
  ])('is bad_reply on %s', async (_name, body) => {
    const { client } = clientWith(async () => reply(200, body, { 'x-browser-ms-used': '10' }));
    const r = await client.content('https://site.example/', 'rendered');
    expect(r).toMatchObject({ ok: false, reason: 'bad_reply', browserMs: 10 });
  });

  it('is network_error when the request itself fails, and says nothing of the token', async () => {
    const { client } = clientWith(async () => {
      throw new Error(`socket hang up (${TOKEN})`);
    });
    const r = await client.content('https://site.example/', 'rendered');
    expect(r).toEqual({
      ok: false,
      reason: 'network_error',
      retryAfterMs: null,
      browserMs: REQUEST_TIMEOUT_MS,
    });
    expect(JSON.stringify(r)).not.toContain(TOKEN);
  });

  it('stops reading at the size cap and is oversize', async () => {
    let pulled = 0;
    let cancelled = false;
    const chunk = new Uint8Array(1024 * 1024).fill(0x61);
    const body = new ReadableStream<Uint8Array>({
      pull(c) {
        pulled += chunk.length;
        c.enqueue(chunk);
      },
      cancel() {
        cancelled = true;
      },
    });
    const { client } = clientWith(
      async () => new Response(body, { status: 200, headers: { 'x-browser-ms-used': '50' } }),
    );
    const r = await client.content('https://site.example/', 'rendered');
    expect(r).toMatchObject({ ok: false, reason: 'oversize', browserMs: 50 });
    expect(cancelled).toBe(true);
    expect(pulled).toBeLessThanOrEqual(MAX_REPLY_BYTES + 2 * chunk.length);
  });
});

describe('the client from the environment', () => {
  it('is built only when both the account and the token are set', () => {
    expect(clientFromEnv({})).toBeNull();
    expect(clientFromEnv({ CLOUDFLARE_ACCOUNT_ID: ACCOUNT })).toBeNull();
    expect(clientFromEnv({ CLOUDFLARE_BROWSER_RENDERING_TOKEN: TOKEN })).toBeNull();
    expect(
      clientFromEnv({ CLOUDFLARE_ACCOUNT_ID: ' ', CLOUDFLARE_BROWSER_RENDERING_TOKEN: TOKEN }),
    ).toBeNull();
    expect(
      clientFromEnv({ CLOUDFLARE_ACCOUNT_ID: ACCOUNT, CLOUDFLARE_BROWSER_RENDERING_TOKEN: TOKEN }),
    ).not.toBeNull();
  });
});
