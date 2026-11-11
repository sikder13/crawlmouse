/**
 * D9's consent gate at every account route that sends an event (CC-27b fix round 2, item 1). Each
 * route hands its own request's `Cookie` header to the ports it builds, so a `cm_consent=denied`
 * request sends nothing and a granted one sends its event. The acts behind the routes are replaced by
 * ones that send that event through the ports they are given; the sender is the real
 * `captureServerEvent` with its network send replaced by a recorder. A route that passed no cookie
 * would send on the denied request too.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { newToken } from '@/lib/v2/account/tokens';

const h = vi.hoisted(() => {
  const sent: { event: string }[] = [];
  /** A query chain that answers `data` when awaited, whatever filters are put on it. */
  const chain = (data: unknown): unknown =>
    new Proxy(() => undefined, {
      get: (_t, prop) =>
        prop === 'then'
          ? (resolve: (v: unknown) => unknown) => resolve({ data, error: null })
          : () => chain(data),
    });
  type Capturing = { capture: (e: string, a: string, p: unknown) => Promise<void> };
  /** An act that sends `event` through the ports it is handed, and succeeds. */
  const sends = (event: string) => async (ports: Capturing) => {
    await ports.capture(event, 'a0000000-0000-4000-8000-000000000001', { tier: 'free' });
    return { ok: true };
  };
  return { sent, chain, sends };
});

vi.mock('server-only', () => ({}));
vi.mock('@/lib/analytics-server', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/analytics-server')>();
  return {
    ...real,
    captureServerEvent: (
      cookie: string | null,
      event: Parameters<typeof real.captureServerEvent>[1],
    ) =>
      real.captureServerEvent(cookie, event, async (payload) => {
        h.sent.push(payload as { event: string });
      }),
  };
});

vi.mock('@/lib/supabase/server', () => ({
  supabaseServer: async () => ({
    auth: {
      getUser: async () => ({ data: { user: { id: 'u1', email: 'old@example.com' } } }),
      getClaims: async () => ({ data: null }),
    },
    rpc: async (fn: string) => ({ data: fn === 'member_role' ? 'owner' : null, error: null }),
    from: () => h.chain([{ account_id: 'a0000000-0000-4000-8000-000000000001' }]),
  }),
}));
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({ from: () => h.chain({ users: { email: 'old@example.com' } }) }),
}));
vi.mock('@/lib/v2/account/viewer', () => ({
  loadViewer: async () => ({
    kind: 'viewer',
    viewer: { account: { id: 'a0000000-0000-4000-8000-000000000001' } },
  }),
}));

vi.mock('@/lib/v2/account/deletion', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  requestAccountDeletion: h.sends('account_deletion_requested'),
  confirmDeletion: h.sends('account_deletion_confirmed'),
  restoreAccount: h.sends('account_restored'),
}));
vi.mock('@/lib/v2/account/email-change', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  requestEmailChange: h.sends('account_email_change_requested'),
  confirmEmailChange: h.sends('account_email_changed'),
}));

import * as account from './route';
import * as deleteConfirm from './delete/confirm/route';
import * as restore from './restore/route';
import * as email from './email/route';
import * as emailConfirm from './email/confirm/route';

const ORIGIN = 'https://crawlmouse.com';
const json = (url: string, method: string, body: unknown, cookie: string) =>
  new Request(`${ORIGIN}${url}`, {
    method,
    headers: { origin: ORIGIN, 'content-type': 'application/json', cookie },
    body: JSON.stringify(body),
  });
const form = (url: string, cookie: string) =>
  new Request(`${ORIGIN}${url}`, {
    method: 'POST',
    headers: { origin: ORIGIN, 'content-type': 'application/x-www-form-urlencoded', cookie },
    body: '',
  });

const ROUTES: [string, (consent: string) => Promise<Response>][] = [
  [
    'DELETE /api/account (the deletion request)',
    (c) => account.DELETE(json('/api/account', 'DELETE', { hostname: 'shop.example' }, c)),
  ],
  [
    'PATCH /api/account (an owner’s changed address)',
    (c) => account.PATCH(json('/api/account', 'PATCH', { newEmail: 'new@example.com' }, c)),
  ],
  [
    'POST /api/account/email',
    (c) => email.POST(json('/api/account/email', 'POST', { newEmail: 'new@example.com' }, c)),
  ],
  [
    'POST /api/account/email/confirm',
    (c) =>
      emailConfirm.POST(form('/api/account/email/confirm', `cm_link_email=${newToken()}; ${c}`)),
  ],
  [
    'POST /api/account/delete/confirm',
    (c) =>
      deleteConfirm.POST(form('/api/account/delete/confirm', `cm_link_delete=${newToken()}; ${c}`)),
  ],
  [
    'POST /api/account/restore',
    (c) => restore.POST(form('/api/account/restore', `cm_link_restore=${newToken()}; ${c}`)),
  ],
];

beforeEach(() => {
  h.sent.length = 0;
  vi.stubEnv('V2_CHECKS_PUBLIC', '1');
});

describe.each(ROUTES)('%s', (_name, call) => {
  it('sends nothing for a request whose consent cookie says denied', async () => {
    const res = await call('cm_consent=denied');
    expect(res.status).toBeLessThan(400);
    expect(h.sent).toEqual([]);
  });

  it('sends its event when the cookie says granted', async () => {
    await call('cm_consent=granted');
    expect(h.sent).toHaveLength(1);
  });
});
