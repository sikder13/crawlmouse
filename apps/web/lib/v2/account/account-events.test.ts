import { describe, expect, it, vi } from 'vitest';
import { captureServerEvent, type CaptureBody } from '../../analytics-server';
import { accountCapture } from './account-events';

const ACCOUNT = '00000000-0000-4000-8000-000000000001';

/** The real sender over a recording transport, so the consent rule and the shape are its own. */
function recorder() {
  const sent: CaptureBody[] = [];
  const capture: typeof captureServerEvent = (cookie, event) =>
    captureServerEvent(cookie, event, async (body) => {
      sent.push(body);
    });
  return { sent, capture };
}

describe('the account events', () => {
  it('sends with the account as the distinct id and no person profile', async () => {
    const { sent, capture } = recorder();
    await accountCapture('cm_consent=granted', capture)('account_restored', ACCOUNT, {
      tier: 'pro',
    });
    expect(sent).toEqual([
      {
        event: 'account_restored',
        distinct_id: `account:${ACCOUNT}`,
        properties: { tier: 'pro', $process_person_profile: false, $geoip_disable: true },
      },
    ]);
  });

  it('sends nothing when the visitor declined', async () => {
    const { sent, capture } = recorder();
    await accountCapture('cm_consent=denied', capture)('account_deletion_requested', ACCOUNT, {
      tier: 'free',
    });
    expect(sent).toEqual([]);
  });

  it('sends the purge’s counts with no request', async () => {
    const { sent, capture } = recorder();
    const send = vi.fn(capture);
    await accountCapture(null, send)('account_purged', ACCOUNT, {
      counts: { 'accounts deleted': 1 },
    });
    expect(send).toHaveBeenCalledWith(null, expect.objectContaining({ event: 'account_purged' }));
    expect(sent[0]!.properties).toEqual({
      counts: { 'accounts deleted': 1 },
      $process_person_profile: false,
      $geoip_disable: true,
    });
  });
});
