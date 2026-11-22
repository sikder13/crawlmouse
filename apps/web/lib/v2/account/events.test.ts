import { describe, expect, it, vi } from 'vitest';
import { FUNNEL_EVENTS } from '../../analytics-events';
import type { SendCapture } from '../../analytics-server';
import { captureFor, checkStarted, SERVER_EVENTS } from './events';

const req = (cookie?: string) =>
  new Request('https://crawlmouse.com/api/sites', {
    method: 'POST',
    headers: cookie === undefined ? {} : { cookie },
  });

const CHECK = '0f8fad5b-d9cb-469f-a165-70867728950e';

describe('captureFor', () => {
  it('sends the event keyed by the person who acted, with the account, no person profile and no location', async () => {
    const send = vi.fn<SendCapture>(async () => undefined);
    await captureFor(req('other=1'), send)(
      'site_added',
      { accountId: 'acc-1', userId: 'u-1' },
      { n: 1 },
    );
    expect(send).toHaveBeenCalledWith({
      event: 'site_added',
      distinct_id: 'u-1',
      properties: {
        n: 1,
        account_id: 'acc-1',
        $process_person_profile: false,
        $geoip_disable: true,
      },
    });
  });

  it('an event no person caused is keyed by the account', async () => {
    const send = vi.fn<SendCapture>(async () => undefined);
    await captureFor(req(), send)('site_added', { accountId: 'acc-1' }, { n: 1 });
    expect(send.mock.calls[0]![0].distinct_id).toBe('account:acc-1');
  });

  it.each([
    ['granted in a consent region', 'cm_consent_required=1; cm_consent=granted', true],
    ['no decision in a consent region', 'cm_consent_required=1', false],
    ['denied outside one', 'cm_consent=denied', false],
    ['no decision outside one', '', true],
  ])('%s: sent = %s', async (_name, cookie, sent) => {
    const send = vi.fn<SendCapture>(async () => undefined);
    await captureFor(req(cookie), send)(
      'fix_marked_done',
      { accountId: 'acc-1', userId: 'u-1' },
      {
        type: 'robots',
      },
    );
    expect(send).toHaveBeenCalledTimes(sent ? 1 : 0);
  });

  it('check_started names the check by its reference, never its id', () => {
    const p = checkStarted('manual', CHECK);
    expect(p.trigger).toBe('manual');
    expect(p.check_ref).not.toContain(CHECK);
    expect(p.check_ref).toBe(checkStarted('fix_recheck', CHECK).check_ref);
    expect(JSON.stringify(p)).not.toContain(CHECK);
  });

  it('every server event is in the funnel catalogue', () => {
    for (const e of SERVER_EVENTS) expect(FUNNEL_EVENTS).toContain(e);
  });
});

describe('captureFor, the browser’s bot rule (F-050)', () => {
  it('sends nothing for a headless browser’s request', async () => {
    const send = vi.fn(async () => undefined);
    const headless = new Request('https://crawlmouse.com/api/sites', {
      method: 'POST',
      headers: {
        'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) HeadlessChrome/131.0.0.0 Safari/537.36',
      },
    });
    await captureFor(headless, send)('site_added', { accountId: 'acc-1' }, { n: 1 });
    expect(send).not.toHaveBeenCalled();
  });
});
