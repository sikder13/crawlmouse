import { describe, expect, it } from 'vitest';
import { captureServerEvent, type CaptureBody } from '../../analytics-server';
import { CONSENT_DECISION_COOKIE } from '../../consent';
import { pricingCapture } from './events';

const ACCOUNT = 'a0000000-0000-4000-8000-00000000000a';

function recorder() {
  const sent: CaptureBody[] = [];
  const capture: typeof captureServerEvent = (cookie, event) =>
    captureServerEvent(cookie, event, async (body) => {
      sent.push(body);
    });
  return { sent, capture };
}

describe('pricingCapture', () => {
  it('sends pricing_viewed for an account, by its id, with no person profile', async () => {
    const r = recorder();
    await pricingCapture(null, r.capture)('pricing_viewed', ACCOUNT, {
      interval: 'year',
      signedIn: true,
    });
    expect(r.sent).toEqual([
      {
        event: 'pricing_viewed',
        distinct_id: `account:${ACCOUNT}`,
        properties: {
          interval: 'year',
          signedIn: true,
          $process_person_profile: false,
          $geoip_disable: true,
        },
      },
    ]);
  });

  it('a signed-out view gets a fresh random id each time', async () => {
    const r = recorder();
    const send = pricingCapture(null, r.capture);
    await send('pricing_viewed', null, { interval: 'month', signedIn: false });
    await send('pricing_viewed', null, { interval: 'month', signedIn: false });
    const [a, b] = r.sent.map((s) => s.distinct_id);
    expect(a).toMatch(/^anon:[0-9a-f-]{36}$/);
    expect(b).toMatch(/^anon:[0-9a-f-]{36}$/);
    expect(a).not.toBe(b);
  });

  it('sends nothing when the visitor denied consent', async () => {
    const r = recorder();
    await pricingCapture(`${CONSENT_DECISION_COOKIE}=denied`, r.capture)('plan_chosen', ACCOUNT, {
      plan: 'agency',
      interval: 'month',
    });
    expect(r.sent).toEqual([]);
  });

  it('sends when the visitor granted it', async () => {
    const r = recorder();
    await pricingCapture(`${CONSENT_DECISION_COOKIE}=granted`, r.capture)(
      'trial_started',
      ACCOUNT,
      {
        kind: 'agency',
        variant: 'card_required',
        stage: 'checkout_opened',
      },
    );
    expect(r.sent.map((s) => [s.event, s.properties.stage])).toEqual([
      ['trial_started', 'checkout_opened'],
    ]);
  });
});
