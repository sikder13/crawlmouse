import { describe, expect, it, vi } from 'vitest';
import {
  BROWSER_RUN,
  browserRunClient,
  clientFromEnv,
  MAX_REPLY_BYTES,
  RENDER_TIMEOUT_MS,
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

  it('differs on the static side only by refusing scripts', () => {
    const rendered = renderRequestBody('https://site.example/', 'rendered');
    const staticSide = renderRequestBody('https://site.example/', 'static');
    expect(staticSide.rejectResourceTypes).toEqual([...rendered.rejectResourceTypes, 'script']);
    expect({ ...staticSide, rejectResourceTypes: null }).toEqual({
      ...rendered,
      rejectResourceTypes: null,
    });
  });

  it('pins the viewport and the wait', () => {
    expect(RENDER_VIEWPORT).toEqual({ width: 1366, height: 768 });
    expect(RENDER_TIMEOUT_MS).toBe(15_000);
  });

  it('sends patterns Browser Run can read back into the same regular expressions', () => {
    for (const p of renderRequestBody('https://site.example/', 'rendered').rejectRequestPattern) {
      expect(p.startsWith('/') && p.endsWith('/')).toBe(true);
      expect(() => new RegExp(p.slice(1, -1))).not.toThrow();
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

  it('counts a render whose browser time is not reported at the wait cap, never at zero', async () => {
    const { client } = clientWith(async () => reply(200, { success: true, result: '<p>x</p>' }));
    const r = await client.content('https://site.example/', 'rendered');
    expect(r.browserMs).toBe(RENDER_TIMEOUT_MS);
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
      browserMs: RENDER_TIMEOUT_MS,
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
