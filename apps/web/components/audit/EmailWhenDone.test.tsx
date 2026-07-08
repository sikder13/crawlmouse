import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('@/lib/analytics', () => ({ track: () => {} }));

import { EmailWhenDone } from './EmailWhenDone';
import { submitNotifyRequest } from '@/lib/notify-submit';

// SPEC 04 §2 — the calm email-me-when-done escape valve. The submit logic is unit-tested via
// lib/notify-submit (house pattern); the component render is pinned statically.

describe('submitNotifyRequest', () => {
  it('posts to the notify route and fires email-captured with source=wait on acceptance', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    const trackImpl = vi.fn();
    const result = await submitNotifyRequest('aud-1', 'me@example.com', fetchImpl as unknown as typeof fetch, trackImpl);
    expect(result).toBe('saved');
    expect(fetchImpl).toHaveBeenCalledWith('/api/audits/aud-1/notify', expect.objectContaining({ method: 'POST' }));
    expect(JSON.parse((fetchImpl.mock.calls[0] as unknown as [string, { body: string }])[1].body)).toEqual({ email: 'me@example.com' });
    expect(trackImpl).toHaveBeenCalledWith('email-captured', { source: 'wait' });
  });

  it('returns error on rejection (429/409/503) and fires NO event', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ error: 'rate_limited' }), { status: 429 }));
    const trackImpl = vi.fn();
    const result = await submitNotifyRequest('aud-1', 'me@example.com', fetchImpl as unknown as typeof fetch, trackImpl);
    expect(result).toBe('error');
    expect(trackImpl).not.toHaveBeenCalled();
  });

  it('returns error on a network failure without throwing', async () => {
    const fetchImpl = vi.fn(async () => { throw new Error('offline'); });
    await expect(
      submitNotifyRequest('aud-1', 'me@example.com', fetchImpl as unknown as typeof fetch, vi.fn()),
    ).resolves.toBe('error');
  });
});

describe('EmailWhenDone (render)', () => {
  it('renders the calm valve: an email input, the offer copy, and a submit button', () => {
    const html = renderToStaticMarkup(<EmailWhenDone auditId="aud-1" />);
    expect(html).toContain('type="email"');
    expect(html).toMatch(/email you when it.s done/i);
    expect(html).toMatch(/email me/i);
  });
});
