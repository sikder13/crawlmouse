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
  it('sends the event keyed by the account, with no person profile and no location', async () => {
    const send = vi.fn<SendCapture>(async () => undefined);
    await captureFor(req('other=1'), send)('site_added', 'acc-1', { n: 1 });
    expect(send).toHaveBeenCalledWith({
      event: 'site_added',
      distinct_id: 'account:acc-1',
      properties: { n: 1, $process_person_profile: false, $geoip_disable: true },
    });
  });

  it.each([
    ['granted in a consent region', 'cm_consent_required=1; cm_consent=granted', true],
    ['no decision in a consent region', 'cm_consent_required=1', false],
    ['denied outside one', 'cm_consent=denied', false],
    ['no decision outside one', '', true],
  ])('%s: sent = %s', async (_name, cookie, sent) => {
    const send = vi.fn<SendCapture>(async () => undefined);
    await captureFor(req(cookie), send)('fix_marked_done', 'acc-1', { type: 'robots' });
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
