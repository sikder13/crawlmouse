/**
 * POST /api/account/email/confirm hands the request's own `Cookie` header to the ports it builds, so
 * the event its confirm sends obeys the request's consent (D9; CC-27b review, item 4). The confirm
 * itself is replaced by one that sends that event; the sender is the real `captureServerEvent` with
 * its network send replaced by a recorder.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { newToken } from '@/lib/v2/account/tokens';

const h = vi.hoisted(() => ({ sent: [] as unknown[] }));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({
  supabaseServer: async () => ({
    auth: {
      getUser: async () => ({ data: { user: null }, error: null }),
      getClaims: async () => ({ data: null }),
    },
  }),
}));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({}) }));
vi.mock('@/lib/analytics-server', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/analytics-server')>();
  return {
    ...real,
    captureServerEvent: (
      cookie: string | null,
      event: Parameters<typeof real.captureServerEvent>[1],
    ) =>
      real.captureServerEvent(cookie, event, async (payload) => {
        h.sent.push(payload);
      }),
  };
});
vi.mock('@/lib/v2/account/email-change', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/v2/account/email-change')>();
  return {
    ...real,
    confirmEmailChange: async (ports: { capture: (...a: unknown[]) => Promise<void> }) => {
      await ports.capture('account_email_changed', 'a0000000-0000-4000-8000-000000000001', {
        tier: 'free',
      });
      return { ok: true };
    },
  };
});

import { POST } from './route';

const post = (consent: string) =>
  POST(
    new Request('https://crawlmouse.com/api/account/email/confirm', {
      method: 'POST',
      headers: {
        origin: 'https://crawlmouse.com',
        'content-type': 'application/x-www-form-urlencoded',
        cookie: `cm_link_email=${newToken()}; cm_consent=${consent}`,
      },
      body: '',
    }),
  );

beforeEach(() => {
  h.sent.length = 0;
  vi.stubEnv('V2_CHECKS_PUBLIC', '1');
});

describe('POST /api/account/email/confirm and consent', () => {
  it('sends nothing when the request’s consent cookie says denied', async () => {
    await post('denied');
    expect(h.sent).toEqual([]);
  });

  it('sends the event when it says granted', async () => {
    await post('granted');
    expect(h.sent).toHaveLength(1);
  });
});
