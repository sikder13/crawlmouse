import * as Sentry from '@sentry/nextjs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_SINKS, type Refusal } from '../../lib/security/refusal-event';

// The Sentry half of security.refused, through the installed SDK's own event pipeline. In the
// middleware, Sentry's wrapper puts the request on the isolation scope (URL, every header) and names
// the transaction after the path; an event captured there carries both unless the sink drops them.
// The path holds the audit id, a capability, and the headers hold the visitor's geo and referrer.

const CAPABILITY = '6f1c2a8e-0000-4000-8000-0000000c0ffe';
const sent: Sentry.ErrorEvent[] = [];
/** Every envelope the transport is handed: headers and items, as they would go on the wire. */
const envelopes: unknown[] = [];

beforeAll(() => {
  Sentry.init({
    dsn: 'https://k@o0.ingest.sentry.invalid/0',
    defaultIntegrations: Sentry.getDefaultIntegrations({}),
    tracesSampleRate: 1,
    beforeSend: (event) => {
      sent.push(event);
      return event;
    },
    // Nothing leaves the test: the transport keeps what it is given.
    transport: () => ({
      send: async (envelope: unknown) => {
        envelopes.push(envelope);
        return {};
      },
      flush: async () => true,
    }),
  });
});
afterAll(() => Sentry.close());

const REFUSAL: Refusal = {
  reason: 'cross_site',
  route: 'api/audits/[id]/cancel',
  class: 'public',
  method: 'POST',
  status: 403,
};

describe('security.refused in Sentry carries the refusal and nothing of the request', () => {
  it('no URL, header, IP, user or path-bearing transaction name reaches the event', async () => {
    await Sentry.withIsolationScope(async (isolation) => {
      isolation.setSDKProcessingMetadata({
        normalizedRequest: {
          url: `https://crawlmouse.com/api/audits/${CAPABILITY}/cancel?x=1`,
          method: 'POST',
          headers: {
            referer: `https://crawlmouse.com/audit/${CAPABILITY}`,
            'x-vercel-ip-city': 'Paris',
            'x-forwarded-for': '203.0.113.9',
          },
          query_string: 'x=1',
        },
      });
      isolation.setUser({ ip_address: '203.0.113.9' });
      Sentry.getCurrentScope().setTransactionName(`POST /api/audits/${CAPABILITY}/cancel`);
      Sentry.addBreadcrumb({
        category: 'fetch',
        data: { url: `https://crawlmouse.com/api/audits/${CAPABILITY}` },
      });
      // Inside a span named after the path, as an SDK's request span can be.
      Sentry.startSpan({ name: `middleware POST /api/audits/${CAPABILITY}/cancel` }, () =>
        DEFAULT_SINKS.sentry(REFUSAL),
      );
    });
    await Sentry.flush(2000);

    expect(sent).toHaveLength(1);
    const event = sent[0]!;
    expect(event.message).toBe('security.refused');
    expect(event.tags).toMatchObject({
      reason: 'cross_site',
      route: 'api/audits/[id]/cancel',
      status: '403',
    });
    const text = JSON.stringify(event);
    for (const leak of [CAPABILITY, 'Paris', '203.0.113.9', 'referer', 'x=1']) {
      expect(text, leak).not.toContain(leak);
    }
    // The envelope as sent: its headers (the trace context) and every item, the span's included.
    const refusalEnvelopes = envelopes.filter((e) =>
      JSON.stringify(e).includes('security.refused'),
    );
    expect(refusalEnvelopes).toHaveLength(1);
    expect(JSON.stringify(refusalEnvelopes[0])).not.toContain(CAPABILITY);
  });
});
