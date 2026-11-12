import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { signUnsubscribe } from '@/lib/v2/mail/unsubscribe-token';

vi.mock('server-only', () => ({}));
const rpc = vi.fn(async () => ({ data: true, error: null }));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({ rpc }) }));
const capture = vi.fn(async () => undefined);
vi.mock('@/lib/analytics-server', () => ({ captureServerEvent: capture }));

const SECRET = 'k'.repeat(40);
const SEAT = '11111111-2222-4333-8444-555555555555';
const URL_BASE = 'https://crawlmouse.com/api/unsubscribe';

const token = (kind: 'alerts' | 'summary' = 'alerts', now = new Date()) =>
  signUnsubscribe(SECRET, SEAT, kind, now);

const oneClick = (t: string, init: RequestInit = {}) =>
  new Request(`${URL_BASE}?t=${t}`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: 'List-Unsubscribe=One-Click',
    ...init,
  });
const form = (t: string) =>
  new Request(URL_BASE, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      origin: 'https://crawlmouse.com',
    },
    body: new URLSearchParams({ t }).toString(),
  });

async function post(req: Request) {
  const { POST } = await import('./route');
  return POST(req);
}

beforeEach(() => {
  vi.stubEnv('V2_CHECKS_PUBLIC', '1');
  vi.stubEnv('EMAIL_LINK_SECRET', SECRET);
  rpc.mockClear();
  capture.mockClear();
});
afterEach(() => vi.unstubAllEnvs());

describe('POST /api/unsubscribe (D7)', () => {
  it('a mail client’s one-click, from no page of ours, turns off the token’s kind for its seat', async () => {
    const res = await post(oneClick(token('alerts')));
    expect(res.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith('unsubscribe_seat', { p_seat: SEAT, p_kind: 'alerts' });
    expect(capture).toHaveBeenCalledWith(null, {
      event: 'unsubscribed',
      distinctId: `seat:${SEAT}`,
      properties: { kind: 'alerts' },
    });
  });

  it('takes a multipart one-click body too (RFC 8058 prefers it)', async () => {
    const fd = new FormData();
    fd.set('List-Unsubscribe', 'One-Click');
    const res = await post(
      new Request(`${URL_BASE}?t=${token('summary')}`, { method: 'POST', body: fd }),
    );
    expect(res.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith('unsubscribe_seat', { p_seat: SEAT, p_kind: 'summary' });
  });

  it('the page’s form goes back to its own link with a done cookie naming that seat and kind', async () => {
    const res = await post(form(token('summary')));
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe(
      `https://crawlmouse.com/unsubscribe?t=${encodeURIComponent(token('summary'))}`,
    );
    expect(res.headers.get('set-cookie')).toBe(
      `cm_unsubscribed=summary.${SEAT}; Path=/unsubscribe; Max-Age=120; HttpOnly; Secure; SameSite=Lax`,
    );
    expect(rpc).toHaveBeenCalledWith('unsubscribe_seat', { p_seat: SEAT, p_kind: 'summary' });
  });

  it.each([
    ['a forged signature', () => `${token().split('.')[0]}.${'A'.repeat(43)}`, 'invalid'],
    [
      'a token for another seat, re-signed with another key',
      () => signUnsubscribe('x'.repeat(40), SEAT, 'alerts', new Date()),
      'invalid',
    ],
    ['an expired token', () => token('alerts', new Date(Date.now() - 91 * 86_400_000)), 'expired'],
    ['no token', () => '', 'invalid'],
  ])('changes nothing for %s', async (_, make, code) => {
    const t = make();
    const click = await post(oneClick(t));
    expect(click.status).toBe(400);
    const back = await post(form(t));
    expect(back.headers.get('location')).toBe(`https://crawlmouse.com/unsubscribe?error=${code}`);
    expect(back.headers.get('set-cookie')).toBeNull();
    expect(rpc).not.toHaveBeenCalled();
    expect(capture).not.toHaveBeenCalled();
  });

  it('refuses a body past its bound, unread, and changes nothing', async () => {
    const big = `List-Unsubscribe=One-Click&pad=${'x'.repeat(5000)}`;
    const declared = await post(oneClick(token(), { body: big }));
    expect(declared.status).toBe(413);
    const streamed = new Request(`${URL_BASE}?t=${token()}`, {
      method: 'POST',
      body: new ReadableStream({
        start(c) {
          c.enqueue(new TextEncoder().encode(big));
          c.close();
        },
      }),
      // @ts-expect-error Node's fetch needs this for a stream body.
      duplex: 'half',
    });
    expect((await post(streamed)).status).toBe(413);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('with no EMAIL_LINK_SECRET, verifies nothing and changes nothing', async () => {
    vi.stubEnv('EMAIL_LINK_SECRET', '');
    expect((await post(oneClick(token()))).status).toBe(503);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('is a 404 with V2_CHECKS_PUBLIC off, changing nothing', async () => {
    vi.stubEnv('V2_CHECKS_PUBLIC', '');
    expect((await post(oneClick(token()))).status).toBe(404);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('exports POST only: a GET of the one-click URL changes nothing', async () => {
    const mod = (await import('./route')) as Record<string, unknown>;
    expect(Object.keys(mod).filter((k) => /^[A-Z]+$/.test(k))).toEqual(['POST']);
  });
});
