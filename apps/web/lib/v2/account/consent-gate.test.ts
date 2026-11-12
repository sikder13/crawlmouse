/**
 * D9's consent gate on the account routes' events (CC-27b review, item 4): each port factory a route
 * builds, given the request's `Cookie` header with `cm_consent=denied`, sends nothing; given
 * `cm_consent=granted` it sends, so the case can fail. The sender is the real `captureServerEvent`
 * with its network send replaced by a recorder.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ sent: [] as unknown[] }));

vi.mock('server-only', () => ({}));
vi.mock('../../analytics-server', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../analytics-server')>();
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

import type { SupabaseClient } from '@supabase/supabase-js';
import { accountCapture } from './account-events';
import { routeDeletionPorts } from './deletion-ports';
import { emailChangePorts } from './email-change-ports';

const ACCOUNT = 'a0000000-0000-4000-8000-000000000001';
const DENIED = 'cm_consent=denied';
const GRANTED = 'cm_consent=granted';
const sb = {} as SupabaseClient;

beforeEach(() => {
  h.sent.length = 0;
});

describe.each([
  ['accountCapture', (cookie: string) => accountCapture(cookie)],
  ['routeDeletionPorts', (cookie: string) => routeDeletionPorts(sb, cookie).capture],
  ['emailChangePorts', (cookie: string) => emailChangePorts(sb, cookie).capture],
])('%s', (_name, captureFor) => {
  it('sends nothing for a request whose consent cookie says denied', async () => {
    await captureFor(DENIED)('account_deletion_requested', ACCOUNT, { tier: 'free' });
    expect(h.sent).toEqual([]);
  });

  it('sends the event, keyed by the account, when it says granted', async () => {
    await captureFor(GRANTED)('account_deletion_requested', ACCOUNT, { tier: 'free' });
    expect(h.sent).toHaveLength(1);
    expect(h.sent[0]).toMatchObject({
      event: 'account_deletion_requested',
      distinct_id: `account:${ACCOUNT}`,
    });
  });
});
