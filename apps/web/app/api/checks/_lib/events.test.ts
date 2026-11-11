import { describe, expect, it } from 'vitest';
import { FUNNEL_EVENTS } from '../../../../lib/analytics-events';
import { checkRef } from '../../../../lib/v2/pipeline/public';
import type { CaptureBody } from '../../../../lib/analytics-server';
import { capturePublicEvent } from './events';

const CHECK = '7b1f6c1e-8a53-4c0e-9d3a-2f6f1d0e4b11';
const request = (cookie?: string) =>
  new Request('https://crawlmouse.com/api/checks', {
    method: 'POST',
    headers: {
      ...(cookie ? { cookie } : {}),
      'x-forwarded-for': '203.0.113.9',
      host: 'crawlmouse.com',
    },
  });

function recorder() {
  const sent: CaptureBody[] = [];
  return { sent, send: async (body: CaptureBody) => void sent.push(body) };
}

describe('capturePublicEvent', () => {
  it('sends the event under the check ref, with no person profile', async () => {
    const r = recorder();
    await capturePublicEvent(request(), 'check_started', CHECK, { trigger: 'first_audit' }, r.send);
    expect(r.sent).toEqual([
      {
        event: 'check_started',
        distinct_id: `check:${checkRef(CHECK)}`,
        properties: {
          trigger: 'first_audit',
          check_ref: checkRef(CHECK),
          $process_person_profile: false,
          $geoip_disable: true,
        },
      },
    ]);
  });

  it('puts neither the check id nor a request header value in what it sends', async () => {
    const r = recorder();
    await capturePublicEvent(
      request('ph=abc'),
      'check_finished',
      CHECK,
      { trigger: 'first_audit', status: 'finished', pages: 12, durationMs: 90_000 },
      r.send,
    );
    const body = JSON.stringify(r.sent);
    for (const absent of [CHECK, '203.0.113.9', 'crawlmouse.com', 'ph=abc']) {
      expect(body).not.toContain(absent);
    }
  });

  it('sends nothing where analytics needs prior consent', async () => {
    const r = recorder();
    await capturePublicEvent(
      request('a=1; cm_consent_required=1'),
      'check_started',
      CHECK,
      { trigger: 'first_audit' },
      r.send,
    );
    expect(r.sent).toEqual([]);
  });

  it('sends nothing for a visitor who declined analytics', async () => {
    const r = recorder();
    await capturePublicEvent(
      request('cm_consent=denied'),
      'check_started',
      CHECK,
      { trigger: 'first_audit' },
      r.send,
    );
    expect(r.sent).toEqual([]);
  });

  it('uses names the catalogue holds', () => {
    expect(FUNNEL_EVENTS).toContain('check_started');
    expect(FUNNEL_EVENTS).toContain('check_finished');
  });
});
