import { describe, expect, it, vi } from 'vitest';
import { captureServerEvent, type CaptureBody } from '../../analytics-server';
import { CONSENT_DECISION_COOKIE } from '../../consent';
import { pricingCapture } from './events';

const ACCOUNT = 'a0000000-0000-4000-8000-00000000000a';
const USER = 'b0000000-0000-4000-8000-00000000000b';
const WHO = { userId: USER, accountId: ACCOUNT };

function recorder() {
  const sent: CaptureBody[] = [];
  const capture: typeof captureServerEvent = (cookie, event) =>
    captureServerEvent(cookie, event, async (body) => {
      sent.push(body);
    });
  return { sent, capture };
}

describe('pricingCapture', () => {
  it('sends pricing_viewed keyed by the person, with their account, and no person profile', async () => {
    const r = recorder();
    await pricingCapture(null, r.capture)(
      'pricing_viewed',
      { userId: USER, accountId: ACCOUNT },
      { interval: 'year', signedIn: true },
    );
    expect(r.sent).toEqual([
      {
        event: 'pricing_viewed',
        distinct_id: USER,
        properties: {
          interval: 'year',
          signedIn: true,
          account_id: ACCOUNT,
          $process_person_profile: false,
          $geoip_disable: true,
        },
      },
    ]);
  });

  it('a signed-out view is keyed by the browser’s PostHog id when its consented cookie has one', async () => {
    vi.stubEnv('NEXT_PUBLIC_POSTHOG_KEY', 'phc_k');
    const ph = `ph_phc_k_posthog=${encodeURIComponent(JSON.stringify({ distinct_id: 'dev-3' }))}`;
    const r = recorder();
    await pricingCapture(ph, r.capture)('pricing_viewed', null, {
      interval: 'month',
      signedIn: false,
    });
    expect(r.sent.map((s) => [s.distinct_id, s.properties.account_id])).toEqual([
      ['dev-3', undefined],
    ]);
    vi.unstubAllEnvs();
  });

  it('a signed-out view without one gets a fresh random id each time', async () => {
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
    await pricingCapture(`${CONSENT_DECISION_COOKIE}=denied`, r.capture)('plan_chosen', WHO, {
      plan: 'agency',
      interval: 'month',
    });
    expect(r.sent).toEqual([]);
  });

  it('sends when the visitor granted it', async () => {
    const r = recorder();
    await pricingCapture(`${CONSENT_DECISION_COOKIE}=granted`, r.capture)('trial_started', WHO, {
      kind: 'agency',
      variant: 'card_required',
      stage: 'checkout_opened',
    });
    expect(r.sent.map((s) => [s.event, s.properties.stage])).toEqual([
      ['trial_started', 'checkout_opened'],
    ]);
  });
});
