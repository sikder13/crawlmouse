import { afterEach, describe, expect, it, vi } from 'vitest';
import { GET, POST } from './route';

const seen = () => {
  const f = vi.fn(async (_url: string, _init: RequestInit) => new Response('{}', { status: 200 }));
  vi.stubGlobal('fetch', f);
  return f;
};
afterEach(() => vi.unstubAllGlobals());

const SIGNED_IN = {
  cookie: 'sb-project-auth-token=session; crawlmouse_anon=capability',
  referer: 'https://crawlmouse.com/audit/0b9d3c52-7c1e-4f0a-9a44-1f2e3d4c5b6a/overview',
};

describe('/ingest', () => {
  it('a signed-in browser’s cookie and page address do not reach PostHog', async () => {
    for (const [handler, init] of [
      [POST, { method: 'POST', body: '{}', headers: SIGNED_IN }],
      [GET, { headers: SIGNED_IN }],
    ] as const) {
      const f = seen();
      const res = await handler(new Request('https://crawlmouse.com/ingest/e/?ip=0', init));
      expect(res.status).toBe(200);
      const [url, sent] = f.mock.calls[0]!;
      expect(url).toBe('https://us.i.posthog.com/e/?ip=0');
      const headers = new Headers(sent.headers);
      expect(headers.has('cookie')).toBe(false);
      expect(headers.has('referer')).toBe(false);
    }
  });
});
