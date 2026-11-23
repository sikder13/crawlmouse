import { describe, expect, it, vi } from 'vitest';
import { FUNNEL_EVENTS } from '../../../../lib/analytics-events';
import { checkRef } from '../../../../lib/v2/pipeline/public';
import type { CaptureBody } from '../../../../lib/analytics-server';
import type { Subject } from '../../../../lib/v2/ops/internal-marker';
import { capturePublicEvent } from './events';

const CHECK = '7b1f6c1e-8a53-4c0e-9d3a-2f6f1d0e4b11';
const ACCOUNT = 'a0000000-0000-4000-8000-000000000001';
const ANON = { accountId: null, userId: null };
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
    await capturePublicEvent(request(), 'check_started', CHECK, { trigger: 'first_audit' }, ANON, {
      send: r.send,
    });
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
      ANON,
      { send: r.send },
    );
    const body = JSON.stringify(r.sent);
    for (const absent of [CHECK, '203.0.113.9', 'crawlmouse.com', 'ph=abc']) {
      expect(body).not.toContain(absent);
    }
  });

  it('is marked internal when the account it names is internal, and asks of no account it is not given', async () => {
    const r = recorder();
    const asked: Subject[] = [];
    const lookup = async (s: Subject) => {
      asked.push(s);
      return s.id === ACCOUNT;
    };
    const finished = { trigger: 'manual', status: 'failed', pages: 0, durationMs: 1 } as const;
    await capturePublicEvent(
      request(),
      'check_finished',
      CHECK,
      finished,
      { accountId: ACCOUNT, userId: null },
      {
        send: r.send,
        lookup,
      },
    );
    await capturePublicEvent(request(), 'check_finished', CHECK, finished, ANON, {
      send: r.send,
      lookup,
    });
    expect(asked).toEqual([{ kind: 'account', id: ACCOUNT }]);
    expect(r.sent.map((b) => b.properties.internal)).toEqual([true, undefined]);
  });

  it('sends nothing where analytics needs prior consent', async () => {
    const r = recorder();
    await capturePublicEvent(
      request('a=1; cm_consent_required=1'),
      'check_started',
      CHECK,
      { trigger: 'first_audit' },
      ANON,
      { send: r.send },
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
      ANON,
      { send: r.send },
    );
    expect(r.sent).toEqual([]);
  });

  it('is keyed by the signed-in visitor, else the browser’s PostHog id, else the check ref', async () => {
    vi.stubEnv('NEXT_PUBLIC_POSTHOG_KEY', 'phc_k');
    const ph = `ph_phc_k_posthog=${encodeURIComponent(JSON.stringify({ distinct_id: 'dev-5' }))}`;
    const r = recorder();
    const started = { trigger: 'first_audit' } as const;
    const user = 'b0000000-0000-4000-8000-000000000005';
    await capturePublicEvent(
      request(ph),
      'check_started',
      CHECK,
      started,
      { accountId: null, userId: user },
      { send: r.send },
    );
    await capturePublicEvent(request(ph), 'check_started', CHECK, started, ANON, { send: r.send });
    await capturePublicEvent(request(), 'check_started', CHECK, started, ANON, { send: r.send });
    expect(r.sent.map((b) => b.distinct_id)).toEqual([user, 'dev-5', `check:${checkRef(CHECK)}`]);
    vi.unstubAllEnvs();
  });

  it('uses names the catalogue holds', () => {
    expect(FUNNEL_EVENTS).toContain('check_started');
    expect(FUNNEL_EVENTS).toContain('check_finished');
  });
});

describe('capturePublicEvent, the browser’s bot rule (F-050)', () => {
  const asBrowser = (userAgent: string) =>
    new Request('https://crawlmouse.com/api/checks', {
      method: 'POST',
      headers: { 'user-agent': userAgent },
    });

  it('a headless browser’s check sends no event; a person’s does', async () => {
    const send = vi.fn(async () => undefined);
    const lookup = async () => false;
    const visitor = { accountId: null, userId: null };
    const check = '0b9d3c52-7c1e-4f0a-9a44-1f2e3d4c5b6a';
    await capturePublicEvent(
      asBrowser('Mozilla/5.0 (X11; Linux x86_64) HeadlessChrome/131.0.0.0 Safari/537.36'),
      'check_started',
      check,
      { trigger: 'first_audit' },
      visitor,
      { send, lookup },
    );
    expect(send).not.toHaveBeenCalled();
    await capturePublicEvent(
      asBrowser('Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36'),
      'check_started',
      check,
      { trigger: 'first_audit' },
      visitor,
      { send, lookup },
    );
    expect(send).toHaveBeenCalledTimes(1);
  });
});
