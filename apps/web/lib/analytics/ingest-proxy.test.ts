import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { proxyIngest } from './ingest-proxy';

const CHECK = '0b9d3c52-7c1e-4f0a-9a44-1f2e3d4c5b6a';

function upstream(
  response = new Response('{}', { headers: { 'content-type': 'application/json' } }),
) {
  return vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => response);
}
const sentUrl = (f: ReturnType<typeof upstream>) => String(f.mock.calls[0]![0]);
const sentHeaders = (f: ReturnType<typeof upstream>) =>
  Object.fromEntries(new Headers(f.mock.calls[0]![1]!.headers).entries());

const post = (path: string, headers: Record<string, string> = {}, body: BodyInit = '{}') =>
  new Request(`https://crawlmouse.com${path}`, { method: 'POST', headers, body });

describe('what the proxy sends to PostHog', () => {
  it('forwards only the headers on its list: no cookie, no page address, no credential', async () => {
    const f = upstream();
    await proxyIngest(
      post('/ingest/e/?ip=0', {
        cookie: 'sb-project-auth-token=secret; crawlmouse_anon=capability; ph_x=1',
        referer: `https://crawlmouse.com/audit/${CHECK}/overview`,
        origin: 'https://crawlmouse.com',
        authorization: 'Bearer secret',
        'x-vercel-oidc-token': 'secret',
        'x-custom': 'secret',
        'content-type': 'text/plain',
        'content-encoding': 'gzip',
        accept: '*/*',
        'user-agent': 'Mozilla/5.0',
        'x-forwarded-for': '203.0.113.9',
      }),
      f,
    );
    expect(sentHeaders(f)).toEqual({
      accept: '*/*',
      'content-encoding': 'gzip',
      'content-type': 'text/plain',
      'user-agent': 'Mozilla/5.0',
      'x-forwarded-for': '203.0.113.9',
    });
    expect(JSON.stringify(f.mock.calls)).not.toContain('secret');
    expect(JSON.stringify(f.mock.calls)).not.toContain(CHECK);
  });

  it('sends the body byte for byte', async () => {
    const bytes = new Uint8Array([0x1f, 0x8b, 0x08, 0x00, 0xff, 0x00, 0x80]);
    const f = upstream();
    await proxyIngest(post('/ingest/e/?compression=gzip-js', {}, bytes), f);
    const sent = f.mock.calls[0]![1]!.body as ArrayBuffer;
    expect([...new Uint8Array(sent)]).toEqual([...bytes]);
  });

  it.each([
    ['/ingest/e/?ip=0&ver=1', 'https://us.i.posthog.com/e/?ip=0&ver=1'],
    ['/ingest/flags/?v=2', 'https://us.i.posthog.com/flags/?v=2'],
    ['/ingest/static/array.js', 'https://us-assets.i.posthog.com/static/array.js'],
    ['/ingest/array/key/config.js', 'https://us-assets.i.posthog.com/array/key/config.js'],
  ])('%s goes where the rewrite sent it', async (path, target) => {
    const f = upstream();
    await proxyIngest(new Request(`https://crawlmouse.com${path}`), f);
    expect(sentUrl(f)).toBe(target);
  });

  it.each([
    '/ingest//evil.example/x',
    '/ingest/@evil.example/x',
    '/ingest/%2F%2Fevil.example/x',
    '/ingest/..//evil.example/x',
    '/ingest/static/..//evil.example/x',
    '/ingest/\\evil.example/x',
  ])('%s cannot leave PostHog’s hosts', async (path) => {
    const f = upstream();
    await proxyIngest(new Request(`https://crawlmouse.com${path}`), f);
    for (const [url] of f.mock.calls) {
      expect(['us.i.posthog.com', 'us-assets.i.posthog.com']).toContain(new URL(String(url)).host);
    }
  });

  it('does not follow a redirect', async () => {
    const f = upstream();
    await proxyIngest(post('/ingest/e/'), f);
    expect(f.mock.calls[0]![1]!.redirect).toBe('manual');
  });
});

describe('what the proxy returns', () => {
  it('keeps the type and caching, and drops a cookie or a redirect target', async () => {
    const f = upstream(
      new Response('x', {
        status: 200,
        headers: {
          'content-type': 'application/javascript',
          'cache-control': 'public, max-age=3600',
          etag: '"v1"',
          'set-cookie': 'upstream=1',
          location: 'https://evil.example/',
          'content-encoding': 'gzip',
          'x-upstream': 'detail',
        },
      }),
    );
    const res = await proxyIngest(new Request('https://crawlmouse.com/ingest/static/array.js'), f);
    expect(Object.fromEntries(res.headers.entries())).toEqual({
      'content-type': 'application/javascript',
      'cache-control': 'public, max-age=3600',
      etag: '"v1"',
    });
    expect(await res.text()).toBe('x');
  });

  it('keeps PostHog’s status', async () => {
    const res = await proxyIngest(
      post('/ingest/e/'),
      upstream(new Response('no', { status: 429 })),
    );
    expect(res.status).toBe(429);
  });

  it('a failed call answers 502 and says nothing of why', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const f = vi.fn(async () => {
      throw new Error('upstream detail');
    });
    const res = await proxyIngest(post('/ingest/e/'), f);
    expect(res.status).toBe(502);
    expect(await res.text()).toBe('');
    expect(JSON.stringify(logged.mock.calls)).not.toContain('upstream detail');
    logged.mockRestore();
  });
});

describe('the route replaces the rewrites', () => {
  it('next.config sends nothing under /ingest to PostHog itself', () => {
    const config = readFileSync(join(__dirname, '../../next.config.mjs'), 'utf8');
    expect(config).not.toMatch(/source:\s*'\/ingest/);
    expect(config).not.toContain('i.posthog.com');
  });
});
