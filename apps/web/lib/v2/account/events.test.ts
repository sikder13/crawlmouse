import { describe, expect, it, vi } from 'vitest';
import { FUNNEL_EVENTS } from '../../analytics-events';
import { captureFor, SERVER_EVENTS, type Capture } from './events';

const req = (cookie?: string) =>
  new Request('https://crawlmouse.com/api/sites', {
    method: 'POST',
    headers: cookie === undefined ? {} : { cookie },
  });

describe('captureFor', () => {
  it('sends the event, keyed by the account', async () => {
    const send = vi.fn<Capture>(async () => undefined);
    await captureFor(req('other=1'), send)('site_added', 'acc-1', { n: 1 });
    expect(send).toHaveBeenCalledWith('site_added', 'acc-1', { n: 1 });
  });

  it('sends nothing from a region that needs prior consent', async () => {
    const send = vi.fn<Capture>(async () => undefined);
    await captureFor(req('a=b; cm_consent_required=1'), send)('site_added', 'acc-1', { n: 1 });
    expect(send).not.toHaveBeenCalled();
  });

  it('a failed send does not fail the action', async () => {
    const send: Capture = async () => {
      throw new Error('network');
    };
    await expect(
      captureFor(req(), send)('fix_marked_done', 'acc-1', { type: 'robots_blocks_crawler' }),
    ).resolves.toBeUndefined();
  });

  it('every server event is in the funnel catalogue', () => {
    for (const e of SERVER_EVENTS) expect(FUNNEL_EVENTS).toContain(e);
  });
});
