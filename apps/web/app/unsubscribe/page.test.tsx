import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { signUnsubscribe } from '@/lib/v2/mail/unsubscribe-token';

vi.mock('server-only', () => ({}));
// Anything that could change a seat: the page must reach none of it.
const rpc = vi.fn();
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({ rpc, from: rpc }) }));
// The request's cookies, as next/headers gives them to the page.
let jar: Record<string, string> = {};
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (name in jar ? { name, value: jar[name] } : undefined),
  }),
}));

const SECRET = 'k'.repeat(40);
const SEAT = '11111111-2222-4333-8444-555555555555';

async function render(query: Record<string, string>) {
  const { default: Page } = await import('./page');
  return renderToStaticMarkup(await Page({ searchParams: Promise.resolve(query) }));
}

beforeEach(() => {
  vi.stubEnv('V2_CHECKS_PUBLIC', '1');
  vi.stubEnv('EMAIL_LINK_SECRET', SECRET);
  rpc.mockClear();
  jar = {};
});
afterEach(() => vi.unstubAllEnvs());

describe('GET /unsubscribe (D7): shows the choice, changes nothing', () => {
  it('a valid link asks, with a POST form carrying the token, and changes nothing', async () => {
    const t = signUnsubscribe(SECRET, SEAT, 'alerts', new Date());
    const out = await render({ t });
    expect(out).toContain('Stop alert emails to this address?');
    expect(out).toContain('<form action="/api/unsubscribe" method="post">');
    expect(out).toContain(`<input type="hidden" name="t" value="${t}"/>`);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('says what was done when the POST’s cookie says so, and why a link cannot be used', async () => {
    jar = { cm_unsubscribed: 'summary' };
    expect(await render({})).toContain('The weekly summary is no longer emailed');
    jar = {};
    expect(await render({ t: 'nope' })).toContain('not one we can read');
    const old = signUnsubscribe(SECRET, SEAT, 'alerts', new Date(Date.now() - 91 * 86_400_000));
    expect(await render({ t: old })).toContain('has expired');
    expect(await render({ t: 'nope' })).not.toContain('<form');
    expect(rpc).not.toHaveBeenCalled();
  });

  it('a crafted link cannot make it say done: ?done= is not read, and a cookie names a kind or nothing', async () => {
    for (const done of ['alerts', 'summary']) {
      const out = await render({ done });
      expect(out).not.toContain('Done.');
      expect(out).toContain('not one we can read');
    }
    jar = { cm_unsubscribed: 'everything' };
    expect(await render({})).not.toContain('Done.');
    jar = { cm_unsubscribed: 'alerts' };
    expect(await render({})).toContain('Done. Alerts are no longer emailed');
  });

  it('is a 404 with V2_CHECKS_PUBLIC off', async () => {
    vi.stubEnv('V2_CHECKS_PUBLIC', '');
    await expect(render({})).rejects.toMatchObject({
      digest: expect.stringMatching(/404|NOT_FOUND/),
    });
  });
});
