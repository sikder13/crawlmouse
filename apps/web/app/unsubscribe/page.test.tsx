import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { signUnsubscribe } from '@/lib/v2/mail/unsubscribe-token';

vi.mock('server-only', () => ({}));
// Anything that could change a seat: the page must reach none of it.
const rpc = vi.fn();
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({ rpc, from: rpc }) }));

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

  it('says what was done, and why a link cannot be used', async () => {
    expect(await render({ done: 'summary' })).toContain('The weekly summary is no longer emailed');
    expect(await render({ t: 'nope' })).toContain('not one we can read');
    const old = signUnsubscribe(SECRET, SEAT, 'alerts', new Date(Date.now() - 91 * 86_400_000));
    expect(await render({ t: old })).toContain('has expired');
    expect(await render({ t: 'nope' })).not.toContain('<form');
    expect(rpc).not.toHaveBeenCalled();
  });

  it('is a 404 with V2_CHECKS_PUBLIC off', async () => {
    vi.stubEnv('V2_CHECKS_PUBLIC', '');
    await expect(render({})).rejects.toMatchObject({
      digest: expect.stringMatching(/404|NOT_FOUND/),
    });
  });
});
