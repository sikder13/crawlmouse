import { describe, expect, it, vi } from 'vitest';
import { FUNNEL_EVENTS } from '../../analytics-events';
import { AGENCY_EVENTS, agencyCaptureFor, agencyCaptureWithoutRequest } from './events';

const ACCOUNT = '0b1f6c1e-5a55-4d6e-9d2c-3f1c1b7a9e10';

function request(cookie?: string): Request {
  return new Request('https://crawlmouse.com/api/seats', {
    method: 'POST',
    headers: cookie ? { cookie } : {},
  });
}

describe('the agency events', () => {
  it('are funnel events, each once', () => {
    expect(AGENCY_EVENTS.filter((e) => !(FUNNEL_EVENTS as readonly string[]).includes(e))).toEqual(
      [],
    );
    expect(new Set(AGENCY_EVENTS).size).toBe(AGENCY_EVENTS.length);
  });

  it('are sent keyed by the account, with the properties given and nothing of the request', async () => {
    const send = vi.fn(async () => undefined);
    await agencyCaptureWithoutRequest(send)('seat_invited', ACCOUNT, {
      role: 'developer',
      scoped: true,
    });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]).toEqual([
      {
        event: 'seat_invited',
        distinct_id: `account:${ACCOUNT}`,
        properties: {
          role: 'developer',
          scoped: true,
          $process_person_profile: false,
          $geoip_disable: true,
        },
      },
    ]);
  });

  it.each([
    ['granted in a consent region', 'cm_consent_required=1; cm_consent=granted', 1],
    ['no decision in a consent region', 'cm_consent_required=1', 0],
    ['denied', 'cm_consent=denied', 0],
    ['no cookie at all', undefined, 1],
  ])('a request’s capture follows the visitor’s consent: %s', async (_name, cookie, sends) => {
    const send = vi.fn(async () => undefined);
    await agencyCaptureFor(request(cookie), send)('seats_bought', ACCOUNT, { seats: 1, sites: 0 });
    expect(send).toHaveBeenCalledTimes(sends);
  });
});
